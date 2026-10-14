"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface ClientSession {
  party_id: string;
  party_name: string;
  client_code: string;
}

interface InventoryLog {
  id: string;
  action_type: "IN" | "OUT";
  party_name: string;
  product_name?: string;
  component_type: string;
  quantity: number;
  remarks?: string;
  created_at: string;
}

interface StockBalance {
  id: string;
  party_name: string;
  product_name?: string;
  component_type: string;
  quantity: number;
}

export default function ClientPortalPage() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [loginCode, setLoginCode] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<"in" | "out" | "balance">("in");
  const [loading, setLoading] = useState(false);
  const [inLogs, setInLogs] = useState<InventoryLog[]>([]);
  const [outLogs, setOutLogs] = useState<InventoryLog[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);

  const [productOptions, setProductOptions] = useState<string[]>([]);

  const [inFilterProduct, setInFilterProduct] = useState("");
  const [inFilterStartDate, setInFilterStartDate] = useState("");
  const [inFilterEndDate, setInFilterEndDate] = useState("");

  const [outFilterProduct, setOutFilterProduct] = useState("");
  const [outFilterStartDate, setOutFilterStartDate] = useState("");
  const [outFilterEndDate, setOutFilterEndDate] = useState("");

  const [balanceFilterProduct, setBalanceFilterProduct] = useState("");

  useEffect(() => {
    const savedSession = localStorage.getItem("client_portal_session");
    if (savedSession) {
      try {
        setSession(JSON.parse(savedSession));
      } catch (e) {
        localStorage.removeItem("client_portal_session");
      }
    }
  }, []);

  useEffect(() => {
    if (session?.party_id && session.party_name) {
      fetchClientInventoryData(session.party_id, session.party_name);
    }
  }, [session]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const username = loginCode.trim();
      const portalPin = loginPassword.trim();

      if (!username || !portalPin) {
        setAuthError("برائے مہربانی پورٹل Username اور PIN داخل کریں۔");
        setAuthLoading(false);
        return;
      }

      let matchedParty: any = null;

      const { data: accessData, error: accessError } = await supabase
        .from("party_access")
        .select("*")
        .eq("username", username)
        .eq("access_pin", portalPin)
        .maybeSingle();

      if (accessError) {
        console.error("party_access lookup failed:", accessError);
      }

      if (accessData) {
        if (accessData.is_active === false) {
          setAuthError("یہ کلائنٹ پورٹل فی الحال غیر فعال ہے۔");
          setAuthLoading(false);
          return;
        }

        const { data: partyData, error: partyError } = await supabase
          .from("parties")
          .select("*")
          .eq("id", accessData.party_id)
          .maybeSingle();

        if (partyError) {
          console.error("party lookup failed:", partyError);
        }

        matchedParty = partyData;
      }

      if (!matchedParty) {
        const { data, error } = await supabase.from("parties").select("*");

        if (error || !data || data.length === 0) {
          setAuthError("ڈیٹا بیس میں کوئی پارٹی/کلائنٹ نہیں ملا!");
          setAuthLoading(false);
          return;
        }

        const inputVal = username.toLowerCase();
        matchedParty = data.find(
          (p: any) =>
            (p.code && p.code.toLowerCase() === inputVal) ||
            p.name.toLowerCase() === inputVal ||
            p.id.toLowerCase() === inputVal
        );
      }

      if (!matchedParty) {
        setAuthError(`کلائنٹ '${username}' نہیں ملا۔ برائے مہربانی صحیح Username یا PIN درج کریں۔`);
        setAuthLoading(false);
        return;
      }

      const clientSessionData: ClientSession = {
        party_id: matchedParty.id,
        party_name: matchedParty.name,
        client_code: matchedParty.code || username,
      };

      setSession(clientSessionData);
      localStorage.setItem("client_portal_session", JSON.stringify(clientSessionData));
    } catch (err: any) {
      setAuthError("لاگ ان ایرر: " + err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem("client_portal_session");
    setLoginCode("");
    setLoginPassword("");
  };

  const fetchClientInventoryData = async (partyId: string, partyName: string) => {
    setLoading(true);
    try {
      const { data: inData } = await supabase
        .from("inventory_logs")
        .select("*")
        .eq("action_type", "IN")
        .ilike("party_name", partyName)
        .order("created_at", { ascending: false });

      if (inData) setInLogs(inData);

      const { data: outData } = await supabase
        .from("inventory_logs")
        .select("*")
        .eq("action_type", "OUT")
        .ilike("party_name", partyName)
        .order("created_at", { ascending: false });

      if (outData) setOutLogs(outData);

      const { data: balData } = await supabase
        .from("inventory")
        .select("*")
        .eq("party_id", partyId);

      if (balData) setBalances(balData);

      const { data: productData } = await supabase
        .from("products")
        .select("product_name")
        .eq("party_id", partyId)
        .order("product_name");

      const uniqueProducts = Array.from(
        new Set([
          ...(productData || []).map((item: any) => item.product_name).filter(Boolean),
          ...(inData || []).map((item: any) => item.product_name).filter(Boolean),
          ...(outData || []).map((item: any) => item.product_name).filter(Boolean),
          ...(balData || []).map((item: any) => item.product_name).filter(Boolean),
        ])
      ) as string[];

      setProductOptions(uniqueProducts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center p-4 font-sans text-slate-100">
        <div className="bg-[#121827] border border-slate-800 rounded-2xl p-6 sm:p-8 w-full max-w-md shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">
              CLIENT PORTAL ACCESS
            </span>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white">Nigehban Warehouse Tracking Login</h1>
            <p className="text-xs text-slate-400"> Enter your Portal Username and PIN  </p>
          </div>

          {authError && (
            <div className="bg-rose-950/80 border border-rose-800 p-3 rounded-xl text-xs text-rose-300 text-center font-medium">
              ⚠️ {authError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Portal Username</label>
              <input
                type="text"
                value={loginCode}
                onChange={(e) => setLoginCode(e.target.value)}
                placeholder="e.g. mexitech_user"
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl p-3 text-xs text-white focus:border-blue-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Portal PIN</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-xl p-3 text-xs text-white focus:border-blue-500 outline-none"
                required
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-lg"
            >
              {authLoading ? "Verifying..." : "Login to Client Portal"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const applyFilters = (items: any[], productFilter: string, startDate: string, endDate: string) => {
    return items.filter((item) => {
      if (productFilter && item.product_name && !item.product_name.toLowerCase().includes(productFilter.toLowerCase())) {
        return false;
      }
      if (item.created_at) {
        const itemDate = new Date(item.created_at).toISOString().split("T")[0];
        if (startDate && itemDate < startDate) return false;
        if (endDate && itemDate > endDate) return false;
      }
      return true;
    });
  };

  const filteredIn = applyFilters(inLogs, inFilterProduct, inFilterStartDate, inFilterEndDate);
  const filteredOut = applyFilters(outLogs, outFilterProduct, outFilterStartDate, outFilterEndDate);
  const filteredBal = balances.filter((b) =>
    balanceFilterProduct ? b.product_name?.toLowerCase().includes(balanceFilterProduct.toLowerCase()) : true
  );

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 p-3 sm:p-6 font-sans space-y-6">
      <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 max-w-7xl mx-auto">
        <div>
          <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
            CLIENT PORTAL — {session.party_name}
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1">
            Nigehban Warehouse & Inventory Tracking
          </h1>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={() => fetchClientInventoryData(session.party_id, session.party_name)}
            className="flex-1 sm:flex-none px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-md"
          >
            🔄 Refresh Data
          </button>
          <button
            onClick={handleLogout}
            className="px-3 py-2 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white rounded-xl text-xs font-bold border border-rose-500/30 transition"
          >
            🚪 Logout
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex gap-2 border-b border-slate-800 pb-3">
          <button
            onClick={() => setActiveTab("in")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === "in" ? "bg-emerald-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            📥 Warehouse IN
          </button>
          <button
            onClick={() => setActiveTab("out")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === "out" ? "bg-amber-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            📤 Warehouse OUT
          </button>
          <button
            onClick={() => setActiveTab("balance")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === "balance" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            🏢 Stock Balance
          </button>
        </div>

        {activeTab === "in" && (
          <div className="bg-[#121827] border border-slate-800 p-3 sm:p-4 rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Filter by Product Name</label>
              <select
                value={inFilterProduct}
                onChange={(e) => setInFilterProduct(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
              >
                <option value="">All Products</option>
                {productOptions.map((product) => (
                  <option key={product} value={product}>
                    {product}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">From Date</label>
              <input
                type="date"
                value={inFilterStartDate}
                onChange={(e) => setInFilterStartDate(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">To Date</label>
              <input
                type="date"
                value={inFilterEndDate}
                onChange={(e) => setInFilterEndDate(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
              />
            </div>
          </div>
        )}

        {activeTab === "out" && (
          <div className="bg-[#121827] border border-slate-800 p-3 sm:p-4 rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Filter by Product Name</label>
              <select
                value={outFilterProduct}
                onChange={(e) => setOutFilterProduct(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
              >
                <option value="">All Products</option>
                {productOptions.map((product) => (
                  <option key={product} value={product}>
                    {product}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">From Date</label>
              <input
                type="date"
                value={outFilterStartDate}
                onChange={(e) => setOutFilterStartDate(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">To Date</label>
              <input
                type="date"
                value={outFilterEndDate}
                onChange={(e) => setOutFilterEndDate(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
              />
            </div>
          </div>
        )}

        {activeTab === "balance" && (
          <div className="bg-[#121827] border border-slate-800 p-3 sm:p-4 rounded-xl grid grid-cols-1 sm:grid-cols-1 gap-3 max-w-md">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Filter by Product Name</label>
              <select
                value={balanceFilterProduct}
                onChange={(e) => setBalanceFilterProduct(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
              >
                <option value="">All Products</option>
                {productOptions.map((product) => (
                  <option key={product} value={product}>
                    {product}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-4">
          <h2 className="text-xs sm:text-sm font-bold text-emerald-400 uppercase tracking-wider">
            {activeTab === "in" && "WAREHOUSE IN RECORDS"}
            {activeTab === "out" && "WAREHOUSE OUT RECORDS"}
            {activeTab === "balance" && "CURRENT STOCK BALANCE"}
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold">
                <tr>
                  <th className="p-3">Product Name</th>
                  <th className="p-3">Item / Component Name</th>
                  <th className="p-3">Quantity</th>
                  {activeTab !== "balance" && <th className="p-3">Remarks</th>}
                  {activeTab !== "balance" && <th className="p-3">Date & Time</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {activeTab === "in" &&
                  (filteredIn.length > 0 ? (
                    filteredIn.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-800/50">
                        <td className="p-3 font-bold text-white">{row.product_name || "N/A"}</td>
                        <td className="p-3 capitalize text-indigo-300">{row.component_type}</td>
                        <td className="p-3 font-mono font-bold text-emerald-400">+{row.quantity} Pcs</td>
                        <td className="p-3 text-slate-300">{row.remarks || "—"}</td>
                        <td className="p-3 text-slate-400">{new Date(row.created_at).toLocaleString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500">
                        No IN record found
                      </td>
                    </tr>
                  ))}

                {activeTab === "out" &&
                  (filteredOut.length > 0 ? (
                    filteredOut.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-800/50">
                        <td className="p-3 font-bold text-white">{row.product_name || "N/A"}</td>
                        <td className="p-3 capitalize text-indigo-300">{row.component_type}</td>
                        <td className="p-3 font-mono font-bold text-amber-400">-{row.quantity} Pcs</td>
                        <td className="p-3 text-slate-300">{row.remarks || "—"}</td>
                        <td className="p-3 text-slate-400">{new Date(row.created_at).toLocaleString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500">
                        No OUT record found
                      </td>
                    </tr>
                  ))}

                {activeTab === "balance" &&
                  (filteredBal.length > 0 ? (
                    filteredBal.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-800/50">
                        <td className="p-3 font-bold text-white">{row.product_name || "N/A"}</td>
                        <td className="p-3 capitalize text-indigo-300">{row.component_type}</td>
                        <td className="p-3 font-mono font-bold text-blue-400">{row.quantity || 0} Pcs</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-slate-500">
                        Out of stock
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}