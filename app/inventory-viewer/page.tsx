"use client";

import React, { useState, useEffect } from "react";
import TransportationRentPanel from "@/components/TransportationRentPanel";
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

interface Party {
  id: string;
  name: string;
}

interface Product {
  id: string;
  product_name: string;
  party_id: string;
}

interface InventoryLog {
  id: string;
  action_type: "IN" | "OUT";
  party_name: string;
  product_name?: string;
  component_type: string;
  quantity: number;
  remarks: string;
  created_at: string;
}

interface StockBalance {
  id: string;
  party_id?: string;
  party_name: string;
  product_id?: string;
  product_name?: string;
  component_type: string;
  quantity: number;
}

interface ProductBomCapacity {
  component_type: string;
  ml_capacity: number | null;
  capacity_unit: "ML" | "GM" | null;
  products?: {
    product_name: string;
    parties?: { name: string }[] | null;
  }[] | null;
}

export default function WarehouseStaffPortal() {
  const [activeTab, setActiveTab] = useState<"balance" | "stock_in" | "stock_out" | "transportation_rent">("balance");

  // Master Data
  const [partiesList, setPartiesList] = useState<Party[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);
  
  // Inventory Data
  const [inOutLogs, setInOutLogs] = useState<InventoryLog[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalance[]>([]);
  const [productBomCapacities, setProductBomCapacities] = useState<ProductBomCapacity[]>([]);

  // Tab 1: Balance Filters
  const [balPartyId, setBalPartyId] = useState("");
  const [balProductId, setBalProductId] = useState("");

  // Tab 2: Stock IN Filters & Date Range
  const [inPartyId, setInPartyId] = useState("");
  const [inProductId, setInProductId] = useState("");
  const [inStartDate, setInStartDate] = useState("");
  const [inEndDate, setInEndDate] = useState("");

  // Tab 3: Stock OUT Filters & Date Range
  const [outPartyId, setOutPartyId] = useState("");
  const [outProductId, setOutProductId] = useState("");
  const [outStartDate, setOutStartDate] = useState("");
  const [outEndDate, setOutEndDate] = useState("");

  useEffect(() => {
    fetchWarehouseData();
  }, []);

  const fetchWarehouseData = async () => {
    try {
      const { data: partyData } = await supabase.from("parties").select("*").order("name");
      if (partyData) setPartiesList(partyData);

      const { data: prodData } = await supabase.from("products").select("*").order("product_name");
      if (prodData) setProductsList(prodData);

      const { data: logData } = await supabase.from("inventory_logs").select("*").order("created_at", { ascending: false });
      if (logData) setInOutLogs(logData);

      const { data: stockData } = await supabase.from("inventory").select("*");
      if (stockData) setStockBalances(stockData);

      const { data: bomData, error: bomError } = await supabase
        .from("product_bom")
        .select("component_type, ml_capacity, capacity_unit, products(product_name, parties(name))");
      if (bomError) throw bomError;
      if (bomData) setProductBomCapacities(bomData);
    } catch (e) {
      console.error(e);
    }
  };

  const filteredProductsForBal = productsList.filter((p) => p.party_id === balPartyId);
  const filteredProductsForIn = productsList.filter((p) => p.party_id === inPartyId);
  const filteredProductsForOut = productsList.filter((p) => p.party_id === outPartyId);
  const formatStockInComponent = (log: InventoryLog) => {
    const componentType = log.component_type.trim().toLowerCase();
    if (!["bottle", "tube", "jar"].includes(componentType)) return log.component_type.toUpperCase();

    const matchingBom = productBomCapacities.find(
      (bom) =>
        bom.component_type.trim().toLowerCase() === componentType &&
        bom.products?.some(
          (product) =>
            product.product_name.toLowerCase() === log.product_name?.toLowerCase() &&
            product.parties?.some((party) => party.name.toLowerCase() === log.party_name.toLowerCase())
        )
    );
    if (!matchingBom?.ml_capacity || (matchingBom.capacity_unit || "ML") !== "ML") {
      return log.component_type.toUpperCase();
    }

    return `${log.component_type.toUpperCase()} (${matchingBom.ml_capacity} ML)`;
  };

  // Export Utilities
  const exportExcel = (data: any[], fileName: string) => {
    const exportData = data.map((row) =>
      typeof row.component_type === "string"
        ? { ...row, component_type: row.component_type.toUpperCase() }
        : row
    );
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    XLSX.writeFile(workbook, `${fileName}_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const exportPDFWithLogo = async (title: string, headers: string[], body: any[][]) => {
    const doc = new jsPDF();
    const loadImage = (url: string): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = url;
        img.onload = () => resolve(img);
        img.onerror = () => reject("Logo image not found");
      });
    };

    try {
      const logoImg = await loadImage(COMPANY_DETAILS.logoPath);
      doc.addImage(logoImg, "PNG", 14, 10, 25, 25);
    } catch (e) {
      console.warn("Logo load failed.");
    }

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(COMPANY_DETAILS.name, 45, 16);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(COMPANY_DETAILS.address, 45, 22);
    doc.text(COMPANY_DETAILS.contact, 45, 27);
    doc.setLineWidth(0.5);
    doc.line(14, 38, 196, 38);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(title.toUpperCase(), 14, 46);

    autoTable(doc, {
      startY: 52,
      head: [headers],
      body: body,
      theme: "grid",
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 8 },
    });

    doc.save(`${title.toLowerCase().replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`);
  };

  // Filtered lists
  const filteredStockBalances = stockBalances.filter((s) => {
    if (balPartyId && s.party_id !== balPartyId) return false;
    if (balProductId && s.product_id !== balProductId) return false;
    return true;
  });

  const filteredStockInLogs = inOutLogs.filter((l) => {
    if (l.action_type !== "IN") return false;
    const matchedParty = partiesList.find((p) => p.name.toLowerCase() === l.party_name?.toLowerCase());
    const matchedProd = productsList.find((p) => p.product_name?.toLowerCase() === l.product_name?.toLowerCase());
    if (inPartyId && matchedParty?.id !== inPartyId) return false;
    if (inProductId && matchedProd?.id !== inProductId) return false;
    if (l.created_at) {
      const itemDate = new Date(l.created_at).toISOString().split("T")[0];
      if (inStartDate && itemDate < inStartDate) return false;
      if (inEndDate && itemDate > inEndDate) return false;
    }
    return true;
  });

  const filteredStockOutLogs = inOutLogs.filter((l) => {
    if (l.action_type !== "OUT") return false;
    const matchedParty = partiesList.find((p) => p.name.toLowerCase() === l.party_name?.toLowerCase());
    const matchedProd = productsList.find((p) => p.product_name?.toLowerCase() === l.product_name?.toLowerCase());
    if (outPartyId && matchedParty?.id !== outPartyId) return false;
    if (outProductId && matchedProd?.id !== outProductId) return false;
    if (l.created_at) {
      const itemDate = new Date(l.created_at).toISOString().split("T")[0];
      if (outStartDate && itemDate < outStartDate) return false;
      if (outEndDate && itemDate > outEndDate) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 p-3 sm:p-6 font-sans space-y-6 uppercase">
      <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 max-w-7xl mx-auto">
        <div>
          <span className="text-[10px] sm:text-xs font-semibold text-emerald-400 uppercase tracking-wider">
            WAREHOUSE STAFF INVENTORY PORTAL
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1">Stock Balance, IN & OUT Viewer</h1>
        </div>
        <button
          onClick={fetchWarehouseData}
          className="w-full sm:w-auto px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 text-center"
        >
          🔄 Refresh Data
        </button>
      </div>

      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        {/* Navigation Tabs */}
        <div className="flex gap-2 border-b border-slate-800 pb-3 overflow-x-auto scrollbar-thin">
          <button
            onClick={() => setActiveTab("balance")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${
              activeTab === "balance" ? "bg-emerald-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            🏢 Inventory Balance
          </button>
          <button
            onClick={() => setActiveTab("stock_in")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${
              activeTab === "stock_in" ? "bg-emerald-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            📥 Stock IN History
          </button>
          <button
            onClick={() => setActiveTab("stock_out")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${
              activeTab === "stock_out" ? "bg-emerald-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            📤 Stock OUT History
          </button>
          <button
            onClick={() => setActiveTab("transportation_rent")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${
              activeTab === "transportation_rent" ? "bg-emerald-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            🚚 Transportation Rent (View)
          </button>
        </div>

        {/* TAB 1: INVENTORY BALANCE */}
        {activeTab === "balance" && (
          <div className="space-y-4">
            <div className="bg-[#121827] border border-slate-800 p-3 sm:p-4 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Filter by Party</label>
                <select
                  value={balPartyId}
                  onChange={(e) => {
                    setBalPartyId(e.target.value);
                    setBalProductId("");
                  }}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                >
                  <option value="">-- All Parties --</option>
                  {partiesList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Filter by Product</label>
                <select
                  value={balProductId}
                  onChange={(e) => setBalProductId(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                  disabled={!balPartyId}
                >
                  <option value="">-- All Products --</option>
                  {filteredProductsForBal.map((prod) => (
                    <option key={prod.id} value={prod.id}>{prod.product_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h2 className="text-sm sm:text-md font-bold text-white">Current Inventory Stock Balance</h2>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => exportExcel(filteredStockBalances, "Inventory_Balance")}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() =>
                      exportPDFWithLogo(
                        "Warehouse Inventory Stock Balance",
                        ["Party Name", "Product Name", "Component Type", "Available Quantity"],
                        filteredStockBalances.map((s) => [s.party_name, s.product_name || "General", s.component_type.toUpperCase(), `${s.quantity} Pcs`])
                      )
                    }
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    PDF
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="inline-block min-w-full align-middle px-4 sm:px-0">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold">
                      <tr>
                        <th className="p-3">Party Name</th>
                        <th className="p-3">Product Name</th>
                        <th className="p-3">Component Type</th>
                        <th className="p-3 text-amber-400">Available Quantity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredStockBalances.map((stk) => (
                        <tr key={stk.id} className="hover:bg-slate-800/50">
                          <td className="p-3 font-bold text-white">{stk.party_name}</td>
                          <td className="p-3 text-emerald-400">{stk.product_name || "General"}</td>
                          <td className="p-3 uppercase text-indigo-300">{stk.component_type}</td>
                          <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">{stk.quantity} Pcs</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: STOCK IN HISTORY */}
        {activeTab === "stock_in" && (
          <div className="space-y-6">
            {/* Stock IN Filters */}
            <div className="bg-[#121827] border border-slate-800 p-3 sm:p-4 rounded-xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Filter by Party</label>
                <select
                  value={inPartyId}
                  onChange={(e) => {
                    setInPartyId(e.target.value);
                    setInProductId("");
                  }}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                >
                  <option value="">-- All Parties --</option>
                  {partiesList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Filter by Product</label>
                <select
                  value={inProductId}
                  onChange={(e) => setInProductId(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                  disabled={!inPartyId}
                >
                  <option value="">-- All Products --</option>
                  {filteredProductsForIn.map((prod) => (
                    <option key={prod.id} value={prod.id}>{prod.product_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">From Date</label>
                <input
                  type="date"
                  value={inStartDate}
                  onChange={(e) => setInStartDate(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">To Date</label>
                <input
                  type="date"
                  value={inEndDate}
                  onChange={(e) => setInEndDate(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
                />
              </div>
            </div>

            {/* Stock IN History Table */}
            <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h2 className="text-sm sm:text-md font-bold text-white">Stock IN History Log</h2>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => exportExcel(filteredStockInLogs, "Stock_IN_History")}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() =>
                      exportPDFWithLogo(
                        "Warehouse Stock IN Log",
                        ["Party", "Product", "Component", "Quantity", "Remarks", "Timestamp"],
                        filteredStockInLogs.map((l) => [l.party_name, l.product_name || "N/A", formatStockInComponent(l), `${l.quantity} Pcs`, l.remarks, new Date(l.created_at).toLocaleString()])
                      )
                    }
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    PDF
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="inline-block min-w-full align-middle px-4 sm:px-0">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold">
                      <tr>
                        <th className="p-3">Party & Product</th>
                        <th className="p-3">Component</th>
                        <th className="p-3 text-emerald-400">Quantity IN</th>
                        <th className="p-3">Remarks</th>
                        <th className="p-3">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredStockInLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-800/50">
                          <td className="p-3">
                            <div className="font-bold text-white">{log.party_name}</div>
                            <div className="text-[10px] text-emerald-400">{log.product_name || "N/A"}</div>
                          </td>
                          <td className="p-3 text-indigo-300">{formatStockInComponent(log)}</td>
                          <td className="p-3 font-mono font-bold text-emerald-300 whitespace-nowrap">{log.quantity} Pcs</td>
                          <td className="p-3 text-slate-400">{log.remarks}</td>
                          <td className="p-3 text-slate-400 whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: STOCK OUT HISTORY */}
        {activeTab === "stock_out" && (
          <div className="space-y-4">
            <div className="bg-[#121827] border border-slate-800 p-3 sm:p-4 rounded-xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Filter by Party</label>
                <select
                  value={outPartyId}
                  onChange={(e) => {
                    setOutPartyId(e.target.value);
                    setOutProductId("");
                  }}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                >
                  <option value="">-- All Parties --</option>
                  {partiesList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Filter by Product</label>
                <select
                  value={outProductId}
                  onChange={(e) => setOutProductId(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                  disabled={!outPartyId}
                >
                  <option value="">-- All Products --</option>
                  {filteredProductsForOut.map((prod) => (
                    <option key={prod.id} value={prod.id}>{prod.product_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">From Date</label>
                <input
                  type="date"
                  value={outStartDate}
                  onChange={(e) => setOutStartDate(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">To Date</label>
                <input
                  type="date"
                  value={outEndDate}
                  onChange={(e) => setOutEndDate(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
                />
              </div>
            </div>

            <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h2 className="text-sm sm:text-md font-bold text-white">Stock OUT History Log</h2>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => exportExcel(filteredStockOutLogs, "Stock_OUT_History")}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() =>
                      exportPDFWithLogo(
                        "Warehouse Stock OUT Log",
                        ["Party", "Product", "Component", "Quantity", "Remarks", "Timestamp"],
                        filteredStockOutLogs.map((l) => [l.party_name, l.product_name || "N/A", l.component_type.toUpperCase(), `${l.quantity} Pcs`, l.remarks, new Date(l.created_at).toLocaleString()])
                      )
                    }
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    PDF
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="inline-block min-w-full align-middle px-4 sm:px-0">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold">
                      <tr>
                        <th className="p-3">Party & Product</th>
                        <th className="p-3">Component</th>
                        <th className="p-3 text-amber-400">Quantity OUT</th>
                        <th className="p-3">Remarks</th>
                        <th className="p-3">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredStockOutLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-800/50">
                          <td className="p-3">
                            <div className="font-bold text-white">{log.party_name}</div>
                            <div className="text-[10px] text-emerald-400">{log.product_name || "N/A"}</div>
                          </td>
                          <td className="p-3 uppercase text-indigo-300">{log.component_type}</td>
                          <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">{log.quantity} Pcs</td>
                          <td className="p-3 text-slate-400">{log.remarks}</td>
                          <td className="p-3 text-slate-400 whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === "transportation_rent" && <TransportationRentPanel mode="viewer" />}
      </div>
    </div>
  );
}