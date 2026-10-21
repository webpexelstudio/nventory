"use client";

import React, { useState, useEffect } from "react";
import TransportationRentPanel from "@/components/TransportationRentPanel";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  product_id: string;
  component_type: string;
  ml_capacity: number | null;
  capacity_unit: "ML" | "GM" | null;
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
  const [warehouseDataError, setWarehouseDataError] = useState<string | null>(null);

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
    setWarehouseDataError(null);
    try {
      const { data: partyData, error: partyError } = await supabase.from("parties").select("*").order("name");
      if (partyError) throw new Error(`Parties: ${partyError.message} (${partyError.code})`);
      setPartiesList(partyData ?? []);

      const { data: prodData, error: productsError } = await supabase.from("products").select("*").order("product_name");
      if (productsError) throw new Error(`Products: ${productsError.message} (${productsError.code})`);
      setProductsList(prodData ?? []);

      const { data: logData, error: logsError } = await supabase.from("inventory_logs").select("*").order("created_at", { ascending: false });
      if (logsError) throw new Error(`Inventory logs: ${logsError.message} (${logsError.code})`);
      setInOutLogs(logData ?? []);

      const { data: stockData, error: stockError } = await supabase.from("inventory").select("*");
      if (stockError) throw new Error(`Inventory balances: ${stockError.message} (${stockError.code})`);
      setStockBalances(stockData ?? []);

      const { data: bomData, error: bomError } = await supabase
        .from("product_bom")
        .select("product_id, component_type, ml_capacity, capacity_unit");
      if (bomError) throw new Error(`Product BOM: ${bomError.message} (${bomError.code})`);
      setProductBomCapacities(bomData ?? []);
    } catch (error) {
      setWarehouseDataError(error instanceof Error ? error.message : String(error));
    }
  };
  const getProductId = (partyName?: string, productName?: string) => {
    if (!partyName || !productName) return undefined;
    const party = partiesList.find((item) => item.name.toLowerCase() === partyName.toLowerCase());
    return productsList.find((item) =>
      item.product_name.toLowerCase() === productName.toLowerCase() &&
      (!party || item.party_id === party.id)
    )?.id;
  };
  const filteredProductsForBal = productsList.filter((p) => p.party_id === balPartyId);
  const filteredProductsForIn = productsList.filter((p) => p.party_id === inPartyId);
  const filteredProductsForOut = productsList.filter((p) => p.party_id === outPartyId);
  const formatStockInComponent = (log: InventoryLog) => {
    const componentType = log.component_type.trim().toLowerCase();
    if (!["bottle", "tube", "jar"].includes(componentType)) return log.component_type.toUpperCase();

    const matchingBom = productBomCapacities.find(
      (bom) => {
        if (bom.component_type.trim().toLowerCase() !== componentType) return false;
        return bom.product_id === getProductId(log.party_name, log.product_name);
      }
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
    const partyKey = Object.keys(exportData[0] ?? {}).find((key) =>
      ["party", "party name", "party_name"].includes(key.toLowerCase().replace(/_/g, " ").trim())
    );
    const partyNames = Array.from(new Set(
      exportData.map((row) => String(partyKey ? row[partyKey] ?? "" : "").trim()).filter(Boolean)
    ));
    const partyHeading = partyNames.length === 1 ? partyNames[0] : partyNames.length > 1 ? "Multiple Parties" : "All Parties";
    const worksheet = XLSX.utils.aoa_to_sheet([[partyHeading], [fileName]]);
    XLSX.utils.sheet_add_json(worksheet, exportData, { origin: "A4" });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
    XLSX.writeFile(workbook, `${fileName}_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const exportPDF = (title: string, headers: string[], body: any[][]) => {
    const doc = new jsPDF();
    const partyColumn = headers.findIndex((header) =>
      ["party", "party name"].includes(header.toLowerCase().trim())
    );
    const partyNames = partyColumn < 0 ? [] : Array.from(new Set(
      body.map((row) => String(row[partyColumn] ?? "").trim()).filter(Boolean)
    ));
    const partyHeading = partyNames.length === 1 ? partyNames[0] : partyNames.length > 1 ? "Multiple Parties" : "All Parties";
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(partyHeading, 14, 16);
    doc.setFontSize(12);
    doc.text(title.toUpperCase(), 14, 24);
    doc.setLineWidth(0.5);
    doc.line(14, 29, pageWidth - 14, 29);

    autoTable(doc, {
      startY: 34,
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
  const getStockBalanceCapacity = (stock: StockBalance) => {
    const componentType = stock.component_type.trim().toLowerCase();
    const matchingBom = productBomCapacities.find((bom) => {
      return bom.component_type.trim().toLowerCase() === componentType &&
        bom.product_id === getProductId(stock.party_name, stock.product_name);
    });
    return matchingBom?.ml_capacity == null
      ? "—"
      : `${matchingBom.ml_capacity} ${matchingBom.capacity_unit || "ML"}`;
  };
  const getStockBalanceExportRows = () =>
    filteredStockBalances.map((stock) => ({
      "Party Name": stock.party_name || "General",
      "Product Name": stock.product_name || "General",
      "Component Type": stock.component_type.toUpperCase(),
      "ML / GM": getStockBalanceCapacity(stock),
      "Qty": stock.quantity,
    }));
  const getStockLogExportRows = (logs: InventoryLog[]) =>
    logs.map((log) => ({
      "Party Name": log.party_name,
      "Product Name": log.product_name || "N/A",
      "Component": formatStockInComponent(log),
      "Quantity": `${log.quantity} Pcs`,
      "Remarks": log.remarks,
      "Timestamp": new Date(log.created_at).toLocaleString(),
    }));

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
        {warehouseDataError && (
          <p role="alert" className="rounded-lg border border-rose-700/50 bg-rose-950/40 p-3 text-sm text-rose-300 normal-case">
            Inventory data could not be loaded: {warehouseDataError}
          </p>
        )}
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
                    onClick={() => exportExcel(getStockBalanceExportRows(), "Inventory_Balance")}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() =>
                      exportPDF(
                        "Warehouse Inventory Stock Balance",
                        ["Party Name", "Product Name", "Component Type", "ML / GM", "Qty"],
                        filteredStockBalances.map((stock) => [
                          stock.party_name || "General",
                          stock.product_name || "General",
                          stock.component_type.toUpperCase(),
                          getStockBalanceCapacity(stock),
                          stock.quantity,
                        ])
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
                    onClick={() => exportExcel(getStockLogExportRows(filteredStockInLogs), "Stock_IN_History")}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() =>
                      exportPDF(
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
                    onClick={() => exportExcel(getStockLogExportRows(filteredStockOutLogs), "Stock_OUT_History")}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() =>
                      exportPDF(
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