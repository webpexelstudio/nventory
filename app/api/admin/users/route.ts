import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { z } from "zod";

export const runtime = "nodejs";

const userRoleSchema = z.enum(["admin", "warehouse", "inventory_viewer", "filling", "client"]);
const uuidSchema = z.string().uuid();
const createUserSchema = z.object({
  email: z.email().trim(),
  password: z.string().min(8).max(72),
  role: userRoleSchema,
  party_id: uuidSchema.nullable(),
});
const updateUserSchema = z.object({
  user_id: uuidSchema,
  email: z.email().trim(),
  password: z.union([z.string().min(8).max(72), z.literal("")]),
  role: userRoleSchema,
  party_id: uuidSchema.nullable(),
  is_active: z.boolean(),
});

type AppRole = z.infer<typeof userRoleSchema>;

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

function isEnabled(user: User) {
  return !user.banned_until || Date.parse(user.banned_until) <= Date.now();
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Server Supabase URL and SUPABASE_SERVICE_ROLE_KEY must be configured.");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function authorizeAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { response: jsonError("Supabase URL and anon key must be configured.", 500) } as const;
  }

  const cookieStore = await cookies();
  const userClient = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return { response: jsonError("Sign in is required.", 401) } as const;
  }

  const { data: profile, error: profileError } = await userClient
    .from("user_profiles")
    .select("role, is_active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return { response: jsonError(`Could not verify administrator role: ${profileError.message}`, 500) } as const;
  }
  if (profile?.role !== "admin" || !profile.is_active) {
    return { response: jsonError("Administrator access is required.", 403) } as const;
  }

  try {
    return { actor: userData.user, admin: createAdminClient() } as const;
  } catch (error) {
    return { response: jsonError(error instanceof Error ? error.message : String(error), 500) } as const;
  }
}

function validateParty(role: AppRole, partyId: string | null) {
  return role !== "client" || partyId !== null;
}

export async function GET() {
  const auth = await authorizeAdmin();
  if ("response" in auth) return auth.response;

  const { data: profiles, error: profilesError } = await auth.admin
    .from("user_profiles")
    .select("user_id, role, party_id, is_active, created_at")
    .order("created_at", { ascending: false });
  if (profilesError) return jsonError(`Could not load app roles: ${profilesError.message}`, 500);

  const users = await Promise.all(
    (profiles ?? []).map(async (profile) => {
      const { data, error } = await auth.admin.auth.admin.getUserById(profile.user_id);
      if (error) throw new Error(`Could not load Auth user ${profile.user_id}: ${error.message}`);
      if (!data.user) throw new Error(`Auth user ${profile.user_id} was not found.`);
      return {
        ...profile,
        email: data.user.email ?? "",
        is_active: profile.is_active && isEnabled(data.user),
      };
    })
  ).catch((error: unknown) => error);

  if (users instanceof Error) return jsonError(users.message, 500);
  return Response.json({ users });
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin();
  if ("response" in auth) return auth.response;

  const body: unknown = await request.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(`Invalid account details: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`, 400);
  }
  if (!validateParty(parsed.data.role, parsed.data.party_id)) {
    return jsonError("Select a party for client accounts.", 400);
  }
  if (parsed.data.role !== "client" && parsed.data.party_id !== null) {
    return jsonError("Only client accounts can be linked to a party.", 400);
  }

  const { data: created, error: createError } = await auth.admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (createError) return jsonError(`Could not create Auth account: ${createError.message}`, 400);
  if (!created.user) return jsonError("Supabase did not return the created account.", 500);

  const { error: profileError } = await auth.admin.from("user_profiles").insert({
    user_id: created.user.id,
    role: parsed.data.role,
    party_id: parsed.data.party_id,
    is_active: true,
  });
  if (profileError) {
    const { error: rollbackError } = await auth.admin.auth.admin.deleteUser(created.user.id);
    const rollbackMessage = rollbackError
      ? ` The Auth account could not be rolled back: ${rollbackError.message}`
      : "";
    return jsonError(`Could not assign the app role: ${profileError.message}.${rollbackMessage}`, 500);
  }

  return Response.json({
    user: {
      user_id: created.user.id,
      email: created.user.email ?? parsed.data.email,
      role: parsed.data.role,
      party_id: parsed.data.party_id,
      is_active: true,
    },
  }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authorizeAdmin();
  if ("response" in auth) return auth.response;

  const body: unknown = await request.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(`Invalid account details: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`, 400);
  }
  if (!validateParty(parsed.data.role, parsed.data.party_id)) {
    return jsonError("Select a party for client accounts.", 400);
  }
  if (parsed.data.role !== "client" && parsed.data.party_id !== null) {
    return jsonError("Only client accounts can be linked to a party.", 400);
  }
  if (
    parsed.data.user_id === auth.actor.id &&
    (!parsed.data.is_active || parsed.data.role !== "admin")
  ) {
    return jsonError("You cannot disable or remove your own administrator access.", 400);
  }

  const { data: existingProfile, error: existingProfileError } = await auth.admin
    .from("user_profiles")
    .select("role, party_id, is_active")
    .eq("user_id", parsed.data.user_id)
    .maybeSingle();
  if (existingProfileError) {
    return jsonError(`Could not load current account role: ${existingProfileError.message}`, 500);
  }
  if (!existingProfile) return jsonError("App account was not found.", 404);

  const { data: existingUserData, error: existingUserError } =
    await auth.admin.auth.admin.getUserById(parsed.data.user_id);
  if (existingUserError || !existingUserData.user) {
    return jsonError(`Could not load Auth account: ${existingUserError?.message ?? "User not found."}`, 404);
  }

  const wasEnabledAdmin =
    existingProfile.role === "admin" &&
    existingProfile.is_active &&
    isEnabled(existingUserData.user);
  const willRemainEnabledAdmin = parsed.data.role === "admin" && parsed.data.is_active;
  if (wasEnabledAdmin && !willRemainEnabledAdmin) {
    const { data: otherAdmins, error: adminsError } = await auth.admin
      .from("user_profiles")
      .select("user_id, is_active")
      .eq("role", "admin")
      .eq("is_active", true)
      .neq("user_id", parsed.data.user_id);
    if (adminsError) return jsonError(`Could not verify remaining administrators: ${adminsError.message}`, 500);

    let anotherEnabledAdmin = false;
    for (const adminProfile of otherAdmins ?? []) {
      const { data: otherUser, error: otherUserError } =
        await auth.admin.auth.admin.getUserById(adminProfile.user_id);
      if (otherUserError) {
        return jsonError(`Could not verify administrator ${adminProfile.user_id}: ${otherUserError.message}`, 500);
      }
      if (otherUser.user && isEnabled(otherUser.user)) {
        anotherEnabledAdmin = true;
        break;
      }
    }
    if (!anotherEnabledAdmin) {
      return jsonError("Keep at least one enabled administrator account.", 400);
    }
  }

  const { error: profileUpdateError } = await auth.admin
    .from("user_profiles")
    .update({
      role: parsed.data.role,
      party_id: parsed.data.party_id,
      is_active: parsed.data.is_active,
    })
    .eq("user_id", parsed.data.user_id);
  if (profileUpdateError) {
    return jsonError(`Could not update app role: ${profileUpdateError.message}`, 500);
  }

  const authUpdate: {
    email?: string;
    email_confirm?: boolean;
    password?: string;
    ban_duration: string;
  } = {
    ban_duration: parsed.data.is_active ? "none" : "876000h",
  };
  if (parsed.data.email !== existingUserData.user.email) {
    authUpdate.email = parsed.data.email;
    authUpdate.email_confirm = true;
  }
  if (parsed.data.password) authUpdate.password = parsed.data.password;

  const { data: updatedUserData, error: authUpdateError } =
    await auth.admin.auth.admin.updateUserById(parsed.data.user_id, authUpdate);
  if (authUpdateError || !updatedUserData.user) {
    const { error: rollbackError } = await auth.admin
      .from("user_profiles")
      .update({
        role: existingProfile.role,
        party_id: existingProfile.party_id,
        is_active: existingProfile.is_active,
      })
      .eq("user_id", parsed.data.user_id);
    const rollbackMessage = rollbackError
      ? ` App role rollback also failed: ${rollbackError.message}`
      : "";
    return jsonError(
      `Could not update Auth account: ${authUpdateError?.message ?? "Updated user was not returned."}.${rollbackMessage}`,
      500
    );
  }

  return Response.json({
    user: {
      user_id: updatedUserData.user.id,
      email: updatedUserData.user.email ?? parsed.data.email,
      role: parsed.data.role,
      party_id: parsed.data.party_id,
      is_active: parsed.data.is_active && isEnabled(updatedUserData.user),
    },
  });
}
