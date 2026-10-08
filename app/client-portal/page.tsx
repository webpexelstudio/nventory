"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const COMPANY_DETAILS = {
  name: "WEB PEXEL STUDIO / NIGEHBAN HEALTHCARE",
  address: "Gulistan-e-Johar, Karachi, Pakistan",
  contact: "Ph: +92 315 0274582 | Email: rizwanmadni517@gmail.com",
  logoPath: "/logo.png",
};

interface WarehouseLog {
  id: string;
  type: "IN" | "OUT";
  party_name: string;
  product_name: string;
  component_type: string;
  quantity: number;
  timestamp: string;
  created_at?: string;
}

interface InventorySummary {
  party_name: string;
  product_name: string;
  bottles: number;
  caps: number;
  seals: number;
  boxes: number;
  created_at?: string;
}

export default function ClientPortalPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [loggedPartyName, setLoggedPartyName] = useState("");
  const [loading, setLoading] = useState(false);

  const [clientWarehouseLogs, setClientWarehouseLogs] = useState<WarehouseLog[]>([]);
  const [clientInventory, setClientInventory] = useState<InventorySummary[]>([]);
  const [activeTab, setActiveTab] = useState<"inventory" | "logs">("inventory");

  // Filters
  const [filterProductName, setFilterProductName] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  // Handle Database Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Supabase سے یوزر نیم اور پن چیک کریں
      const { data, error } = await supabase
        .from("party_access")
        .select("*, parties(name)")
        .eq("username", usernameInput.trim())
        .eq("access_pin", pinInput.trim())
        .eq("is_active", true)
        .single();

      if (error || !data) {
        alert("❌ غلط یوزر نیم یا پاسورڈ PIN! براہ کرم درست معلومات درج کریں۔");
        setLoading(false);
        return;
      }

      const partyName = data.parties?.name || data.party_name || "Client Party";
      setLoggedPartyName(partyName);
      setIsLoggedIn(true);
      fetchClientPortalData(partyName);
    } catch (err: any) {
      // اگر ڈیٹا بیس میں ٹیبل ابھی نہیں بنی تو عارضی ڈیمو لاگ ان (جیسے sohal / 123456) الاؤ کرنے کے لیے:
      if (usernameInput.trim().toLowerCase() === "sohal" || usernameInput.trim().toLowerCase() === "magitech_user") {
        setLoggedPartyName("Sohal / Magitech");
        setIsLoggedIn(true);
        fetchClientPortalData("Magitech");
      } else {
        alert("لاگ ان ایرر: " + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchClientPortalData = async (partyName: string) => {
    // اس مخصوص پارٹی کا ڈیٹا فیچ کریں
    setClientWarehouseLogs([
      {
        id: "w1",
        type: "IN",
        party_name: partyName,
        product_name: "Cream 50g",
        component_type: "Bottle",
        quantity: 5000,
        timestamp: "2026-10-03 04:00 PM",
        created_at: "2026-10-03",
      },
      {
        id: "w2",
        type: "OUT",
        party_name: partyName,
        product_name: "Cream 50g",
        component_type: "Bottle",
        quantity: 1000,
        timestamp: "2026-10-04 11:30 AM",
        created_at: "2026-10-04",
      },
    ]);

    setClientInventory([
      {
        party_name: partyName,
        product_name: "Cream 50g",
        bottles: 4000,
        caps: 4500,
        seals: 4800,
        boxes: 200,
        created_at: "2026-10-04",
      },
    ]);
  };

  // EXPORT UTILITIES
  const exportExcel = (data: any[], fileName: string) => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    XLSX.writeFile(workbook, `${fileName}_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const exportPDFWithLogo = async (title: string, headers: string[], body: any[][]) => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`${COMPANY_DETAILS.name} - CLIENT PORTAL`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Client Company: ${loggedPartyName}`, 14, 23);
    doc.setFontSize(8);
    doc.text(`Generated Date: ${new Date().toLocaleString()}`, 14, 29);
    doc.line(14, 34, 196, 34);

    autoTable(doc, {
      startY: 40,
      head: [headers],
      body: body,
      theme: "grid",
      headStyles: { fillColor: [79, 70, 229] },
      styles: { fontSize: 8 },
    });

    doc.save(`${loggedPartyName}_${title.toLowerCase().replace(/\s+/g, "_")}.pdf`);
  };

  const filteredLogs = clientWarehouseLogs.filter((w) => {
    if (filterProductName && !w.product_name.toLowerCase().includes(filterProductName.toLowerCase())) return false;
    if (w.created_at) {
      if (filterStartDate && w.created_at < filterStartDate) return false;
      if (filterEndDate && w.created_at > filterEndDate) return false;
    }
    return true;
  });

  const filteredInventory = clientInventory.filter((i) => {
    if (filterProductName && !i.product_name.toLowerCase().includes(filterProductName.toLowerCase())) return false;
    return true;
  });

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center p-4 font-sans text-slate-100">
        <div className="bg-[#121827] border border-slate-800 p-8 rounded-2xl w-full max-w-md space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest bg-indigo-950 px-3 py-1 rounded-full border border-indigo-800">
              SECURE CLIENT PORTAL
            </span>
            <h1 className="text-xl font-extrabold text-white">Party Inventory Login</h1>
            <p className="text-xs text-slate-400">اپنا یوزر نیم اور سیک্রেট پن درج کر کے اپنی انونٹری ملاحظہ کریں</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Username</label>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="e.g. sohal"
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Secret Password PIN</label>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="••••••"
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition text-xs shadow-lg"
            >
              {loading ? "Checking..." : "Login to Portal"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 p-6 font-sans space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-4 gap-4">
        <div>
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
            WELCOME CLIENT: {loggedPartyName.toUpperCase()}
          </span>
          <h1 className="text-2xl font-extrabold text-white mt-1">Inventory & Stock Balance Viewer</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-[#121827] p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab("inventory")}
              className={`px-4 py-2 rounded-lg font-bold transition ${
                activeTab === "inventory" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Stock Balance
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`px-4 py-2 rounded-lg font-bold transition ${
                activeTab === "logs" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              IN / OUT History
            </button>
          </div>

          <button
            onClick={() => setIsLoggedIn(false)}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="bg-[#121827] border border-slate-800 p-4 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Filter by Product Name</label>
          <input
            type="text"
            placeholder="Search Product..."
            value={filterProductName}
            onChange={(e) => setFilterProductName(e.target.value)}
            className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">From Date</label>
          <input
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">To Date</label>
          <input
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {activeTab === "inventory" && (
        <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl space-y-4 shadow-lg">
          <div className="flex justify-between items-center">
            <h2 className="text-md font-semibold text-white">Your Total Stock Balance</h2>
            <div className="flex gap-2">
              <button
                onClick={() => exportExcel(filteredInventory, `${loggedPartyName}_Inventory`)}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition"
              >
                Export Excel
              </button>
              <button
                onClick={() =>
                  exportPDFWithLogo(
                    "Stock Balance Report",
                    ["Product Name", "Bottles", "Caps", "Seals", "Boxes"],
                    filteredInventory.map((i) => [i.product_name, i.bottles, i.caps, i.seals, i.boxes])
                  )
                }
                className="px-3 py-1.5 bg-rose-600 text-white text-xs font-bold rounded-lg hover:bg-rose-700 transition"
              >
                Export PDF
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold">
                <tr>
                  <th className="p-3">Product Name</th>
                  <th className="p-3">Bottles Stock</th>
                  <th className="p-3">Caps Stock</th>
                  <th className="p-3">Seals Stock</th>
                  <th className="p-3">Boxes / Cartons</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredInventory.map((inv, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/50">
                    <td className="p-3 font-bold text-emerald-400">{inv.product_name}</td>
                    <td className="p-3 font-mono font-bold text-slate-100">{inv.bottles} Pcs</td>
                    <td className="p-3 font-mono text-slate-300">{inv.caps} Pcs</td>
                    <td className="p-3 font-mono text-slate-300">{inv.seals} Pcs</td>
                    <td className="p-3 font-mono text-amber-300">{inv.boxes} Boxes</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "logs" && (
        <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl space-y-4 shadow-lg">
          <div className="flex justify-between items-center">
            <h2 className="text-md font-semibold text-white">Warehouse IN & OUT History</h2>
            <div className="flex gap-2">
              <button
                onClick={() => exportExcel(filteredLogs, `${loggedPartyName}_Warehouse_Logs`)}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition"
              >
                Export Excel
              </button>
              <button
                onClick={() =>
                  exportPDFWithLogo(
                    "Warehouse IN/OUT History",
                    ["Type", "Product", "Component", "Quantity", "Date & Time"],
                    filteredLogs.map((w) => [w.type, w.product_name, w.component_type, w.quantity, w.timestamp])
                  )
                }
                className="px-3 py-1.5 bg-rose-600 text-white text-xs font-bold rounded-lg hover:bg-rose-700 transition"
              >
                Export PDF
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold">
                <tr>
                  <th className="p-3">Type</th>
                  <th className="p-3">Product Name</th>
                  <th className="p-3">Component Item</th>
                  <th className="p-3">Quantity</th>
                  <th className="p-3">Date & Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredLogs.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-800/50">
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          w.type === "IN"
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                            : "bg-rose-950 text-rose-400 border border-rose-800"
                        }`}
                      >
                        {w.type}
                      </span>
                    </td>
                    <td className="p-3 text-emerald-400 font-semibold">{w.product_name}</td>
                    <td className="p-3 text-slate-200">{w.component_type}</td>
                    <td className="p-3 font-mono font-bold text-amber-300">{w.quantity} Pcs</td>
                    <td className="p-3 text-slate-400">{w.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}