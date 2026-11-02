"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type AppRole = "admin" | "warehouse" | "inventory_viewer" | "filling" | "client";

export interface UserProfile {
  user_id: string;
  role: AppRole;
  party_id: string | null;
  is_active: boolean;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const routePermissions: Record<string, AppRole[]> = {
  "/admin": ["admin"],
  "/warehouse-issues": ["admin", "warehouse"],
  "/inventory-viewer": ["admin", "warehouse", "inventory_viewer"],
  "/transportation-rent": ["admin"],
  "/filling": ["admin", "filling", "warehouse"],
  "/filling-returns": ["admin", "filling", "warehouse", "client"],
  "/production-sheet": ["admin", "filling"],
  "/client-portal": ["client"],
};

const roleHome: Record<AppRole, string> = {
  admin: "/admin",
  warehouse: "/warehouse-issues",
  inventory_viewer: "/inventory-viewer",
  filling: "/filling",
  client: "/client-portal",
};

function isAllowed(pathname: string, role: AppRole) {
  const route = Object.keys(routePermissions).find(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`)
  );
  return route ? routePermissions[route].includes(role) : true;
}

export function useAppAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAppAuth must be used inside AuthGate.");
  }
  return context;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const profileRequestId = useRef(0);

  const loadProfile = useCallback(async (userId: string) => {
    const requestId = ++profileRequestId.current;
    setProfileLoading(true);
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id, role, party_id, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    if (requestId !== profileRequestId.current) return;
    setProfileLoading(false);
    if (error) {
      setProfileError(`Could not load your account role: ${error.message}`);
      setProfile(null);
      return;
    }

    setProfileError("");
    setProfile(data as UserProfile | null);
  }, []);

  useEffect(() => {
    let active = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      profileRequestId.current += 1;
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setProfile(null);
      setProfileError("");
      setProfileLoading(Boolean(currentUser));
      setReady(true);

      if (currentUser) {
        queueMicrotask(() => {
          if (active) void loadProfile(currentUser.id);
        });
      }
    });

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error && error.name !== "AuthSessionMissingError") {
        setProfileError(`Could not verify your session: ${error.message}`);
      }
      setUser(data.user);
      setProfileLoading(Boolean(data.user));
      setReady(true);
      if (data.user) void loadProfile(data.user.id);
    });

    return () => {
      active = false;
      profileRequestId.current += 1;
      authListener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  useEffect(() => {
    if (!profile) return;
    if (pathname === "/") {
      router.replace(roleHome[profile.role]);
      return;
    }
    if (!isAllowed(pathname, profile.role)) {
      router.replace(roleHome[profile.role]);
    }
  }, [pathname, profile, router]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
    setUser(null);
  }, []);

  const submitLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) setLoginError(error.message);
    setSubmitting(false);
  };

  const contextValue = useMemo(() => ({ user, profile, signOut }), [user, profile, signOut]);

  if (!ready) {
    return <div className="min-h-screen bg-[#0b0f19]" aria-label="Loading account" />;
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0f19] p-4 text-slate-100">
        <form
          onSubmit={submitLogin}
          className="w-full max-w-md space-y-5 rounded-2xl border border-slate-800 bg-[#121827] p-7 shadow-2xl"
        >
          <div className="space-y-2 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-400">Nigehban Inventory</p>
            <h1 className="text-2xl font-extrabold">Sign in</h1>
            <p className="text-sm text-slate-400">Use the email and password provided for your account.</p>
          </div>
          {(profileError || loginError) && (
            <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">
              {loginError || profileError}
            </p>
          )}
          <label className="block space-y-1 text-sm text-slate-300">
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#0b0f19] px-3 py-2 text-white"
            />
          </label>
          <label className="block space-y-1 text-sm text-slate-300">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#0b0f19] px-3 py-2 text-white"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  if (profileLoading) {
    return <div className="min-h-screen bg-[#0b0f19]" aria-label="Loading account role" />;
  }

  if (profileError || !profile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0f19] p-4 text-slate-100">
        <div className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-[#121827] p-7">
          <h1 className="text-xl font-bold">Account role not configured</h1>
          <p role="alert" className="text-sm text-rose-300">
            {profileError || "An administrator must assign a role to this account before you can use the app."}
          </p>
          <button onClick={() => void signOut()} className="rounded-lg bg-slate-700 px-4 py-2 font-semibold">
            Sign out
          </button>
        </div>
      </main>
    );
  }

  if (!profile.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0f19] p-4 text-slate-100">
        <div className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-[#121827] p-7">
          <h1 className="text-xl font-bold">Account disabled</h1>
          <p role="alert" className="text-sm text-rose-300">
            An administrator has disabled this account. Contact your administrator if you need access restored.
          </p>
          <button onClick={() => void signOut()} className="rounded-lg bg-slate-700 px-4 py-2 font-semibold">
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <AuthContext.Provider value={contextValue}>
      <div className="fixed right-4 top-4 z-[60]">
        <button
          onClick={() => void signOut().catch((error: unknown) =>
            setProfileError(error instanceof Error ? error.message : String(error))
          )}
          className="rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-slate-200 shadow-lg"
        >
          Sign out
        </button>
      </div>
      {pathname === "/" ? null : isAllowed(pathname, profile.role) ? children : null}
    </AuthContext.Provider>
  );
}
