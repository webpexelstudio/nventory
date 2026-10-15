"use client";

import React, { useState, useEffect } from "react";
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

interface ComponentWeightItem {
  component_type: string;
  pcs_requested: number;
  weight_10_pcs_grams: number;
  theoretical_weight_kg: number;
  actual_issued_weight_kg?: number;
}

interface FillingRequest {
  id: string;
  batch_no: string;
  req_code?: string;
  mfg_date: string;
  exp_date: string;
  retail_price: number;
  pack_size?: number | null;
  pack_unit?: "ML" | "GM" | string | null;
  room_number?: number | null;
  party_id?: string;
  product_id?: string;
  party_name: string;
  product_name: string;
  pcs_requested: number;
  required_date: string;
  total_weight_kg?: number;
  actual_dispatched_weight_kg?: number;
  status: "PENDING_WAREHOUSE" | "DISPATCHED_BY_WAREHOUSE" | "RECEIVED_BY_FILLING_INCHARGE" | "RECEIVED_AND_VERIFIED";
  requested_at?: string;
  dispatched_at?: string;
  received_at?: string;
  components?: ComponentWeightItem[];
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

export default function WarehousePortalPage() {
  const [activeTab, setActiveTab] = useState<"requests" | "stock_in" | "stock_out" | "balance">("requests");
  const [loading, setLoading] = useState(false);

  // Master Data from DB
  const [partiesList, setPartiesList] = useState<Party[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);
  
  // Warehouse Data
  const [requestsList, setRequestsList] = useState<FillingRequest[]>([]);
  const [inOutLogs, setInOutLogs] = useState<InventoryLog[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalance[]>([]);
  const [productBomCapacities, setProductBomCapacities] = useState<ProductBomCapacity[]>([]);

  // 100% Dynamic Component Types from Database BOM
  const [dynamicComponentTypes, setDynamicComponentTypes] = useState<string[]>([
    "bottle",
    "cap",
    "nozzle",
    "seal",
    "carton",
    "inner"
  ]);

  // Dispatch Modal State & Weight Verification Modal State
  const [dispatchModalReq, setDispatchModalReq] = useState<FillingRequest | null>(null);
  const [dispatchWeights, setDispatchWeights] = useState<{ [key: string]: string }>({});
  const [selectedRequestForModal, setSelectedRequestForModal] = useState<FillingRequest | null>(null);

  // Stock IN Form State
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [componentType, setComponentType] = useState("bottle");
  const [qtyPcs, setQtyPcs] = useState("");
  const [remarks, setRemarks] = useState("");

  // Stock OUT Manual Form State
  const [outPartyIdInput, setOutPartyIdInput] = useState("");
  const [outProductIdInput, setOutProductIdInput] = useState("");
  const [outComponentType, setOutComponentType] = useState("bottle");
  const [outQtyPcs, setOutQtyPcs] = useState("");
  const [outRemarks, setOutRemarks] = useState("");

  // INDEPENDENT FILTERS FOR EACH TAB
  const [reqPartyId, setReqPartyId] = useState("");
  const [reqProductId, setReqProductId] = useState("");
  const [reqStartDate, setReqStartDate] = useState("");
  const [reqEndDate, setReqEndDate] = useState("");

  const [inPartyId, setInPartyId] = useState("");
  const [inProductId, setInProductId] = useState("");
  const [inStartDate, setInStartDate] = useState("");
  const [inEndDate, setInEndDate] = useState("");

  const [outPartyId, setOutPartyId] = useState("");
  const [outProductId, setOutProductId] = useState("");
  const [outStartDate, setOutStartDate] = useState("");
  const [outEndDate, setOutEndDate] = useState("");

  const [balPartyId, setBalPartyId] = useState("");
  const [balProductId, setBalProductId] = useState("");

  useEffect(() => {
    fetchWarehouseAndMasterData();
  }, []);

  const fetchWarehouseAndMasterData = async () => {
    setLoading(true);
    try {
      const { data: partyData } = await supabase.from("parties").select("*").order("name");
      if (partyData) setPartiesList(partyData);

      const { data: prodData } = await supabase.from("products").select("*").order("product_name");
      if (prodData) setProductsList(prodData);

      const { data: reqData } = await supabase.from("filling_requests").select("*");
      if (reqData) setRequestsList(reqData as FillingRequest[]);

      const { data: logData } = await supabase.from("inventory_logs").select("*").order("created_at", { ascending: false });
      if (logData) setInOutLogs(logData);

      const { data: stockData } = await supabase.from("inventory").select("*");
      if (stockData) setStockBalances(stockData);

      // Fetch dynamic component types from product_bom table
      const { data: bomTypesData, error: bomTypesError } = await supabase
        .from("product_bom")
        .select("component_type, ml_capacity, capacity_unit, products(product_name, parties(name))");
      if (bomTypesError) throw bomTypesError;
      if (bomTypesData && bomTypesData.length > 0) {
        setProductBomCapacities(bomTypesData);
        const uniqueTypes = Array.from(new Set(bomTypesData.map((b: any) => b.component_type).filter(Boolean)));
        if (uniqueTypes.length > 0) {
          setDynamicComponentTypes(uniqueTypes as string[]);
          setComponentType(uniqueTypes[0] as string);
          setOutComponentType(uniqueTypes[0] as string);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filteredProductsForSelect = productsList.filter((p) => p.party_id === selectedPartyId);
  const filteredProductsForOutForm = productsList.filter((p) => p.party_id === outPartyIdInput);
  const filteredProductsForReq = productsList.filter((p) => p.party_id === reqPartyId);
  const filteredProductsForIn = productsList.filter((p) => p.party_id === inPartyId);
  const filteredProductsForOut = productsList.filter((p) => p.party_id === outPartyId);
  const filteredProductsForBal = productsList.filter((p) => p.party_id === balPartyId);

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

  const handleOpenDispatchModal = (req: FillingRequest) => {
    setDispatchModalReq(req);
    const initialWts: { [key: string]: string } = {};
    const comps = req.components || [
      { component_type: "bottle", theoretical_weight_kg: (req.pcs_requested * 12.2) / 1000 },
      { component_type: "cap", theoretical_weight_kg: (req.pcs_requested * 4.5) / 1000 },
      { component_type: "nozzle", theoretical_weight_kg: (req.pcs_requested * 1.5) / 1000 },
      { component_type: "seal", theoretical_weight_kg: (req.pcs_requested * 0.5) / 1000 },
    ];
    comps.forEach((c) => {
      initialWts[c.component_type] = c.theoretical_weight_kg ? c.theoretical_weight_kg.toFixed(2) : "0";
    });
    setDispatchWeights(initialWts);
  };

  const handleConfirmDispatch = async () => {
    if (!dispatchModalReq) return;

    setLoading(true);
    try {
      let totalDispatchedWeight = 0;
      const updatedComponents = (dispatchModalReq.components || []).map((c) => {
        const enteredWt = parseFloat(dispatchWeights[c.component_type]) || c.theoretical_weight_kg || 0;
        totalDispatchedWeight += enteredWt;
        return {
          ...c,
          actual_issued_weight_kg: enteredWt,
        };
      });

      const dispatchTimestamp = new Date().toLocaleString();

      const { error } = await supabase
        .from("filling_requests")
        .update({
          status: "DISPATCHED_BY_WAREHOUSE",
          actual_dispatched_weight_kg: totalDispatchedWeight,
          dispatched_at: dispatchTimestamp,
          components: updatedComponents,
        })
        .eq("id", dispatchModalReq.id);

      if (error) throw error;

      for (const comp of updatedComponents) {
        const outQty = comp.pcs_requested || dispatchModalReq.pcs_requested;

        await supabase.from("inventory_logs").insert([
          {
            action_type: "OUT",
            party_name: dispatchModalReq.party_name,
            product_name: dispatchModalReq.product_name,
            component_type: comp.component_type,
            quantity: outQty,
            remarks: `Dispatched for Batch: ${dispatchModalReq.batch_no || dispatchModalReq.req_code}`,
            created_at: new Date().toISOString(),
          },
        ]);

        const stockItem = stockBalances.find(
          (s) =>
            (s.party_id === dispatchModalReq.party_id || s.party_name?.toLowerCase() === dispatchModalReq.party_name?.toLowerCase()) &&
            s.component_type?.toLowerCase() === comp.component_type?.toLowerCase()
        );

        if (stockItem) {
          const newQty = Math.max(0, stockItem.quantity - outQty);
          await supabase.from("inventory").update({ quantity: newQty }).eq("id", stockItem.id);
        }
      }

      alert("Batch Dispatched Successfully and Stock OUT logged!");
      setDispatchModalReq(null);
      fetchWarehouseAndMasterData();
    } catch (err: any) {
      alert("Dispatch Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStockIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyId || !selectedProductId || !qtyPcs) {
      return alert("Please select Party, Product, and enter Quantity.");
    }

    setLoading(true);
    try {
      const partyObj = partiesList.find((p) => p.id === selectedPartyId);
      const prodObj = productsList.find((p) => p.id === selectedProductId);
      const qtyNum = parseInt(qtyPcs) || 0;

      const logPayload = {
        action_type: "IN",
        party_name: partyObj?.name || "N/A",
        product_name: prodObj?.product_name || "N/A",
        component_type: componentType,
        quantity: qtyNum,
        remarks: remarks || "Stock IN entry in Warehouse",
        created_at: new Date().toISOString(),
      };

      const { error: logErr } = await supabase.from("inventory_logs").insert([logPayload]);
      if (logErr) throw logErr;

      const existingStock = stockBalances.find(
        (s) =>
          (s.party_id === selectedPartyId || s.party_name?.toLowerCase() === partyObj?.name?.toLowerCase()) &&
          (s.product_id === selectedProductId || s.product_name?.toLowerCase() === prodObj?.product_name?.toLowerCase()) &&
          s.component_type?.toLowerCase() === componentType.toLowerCase()
      );

      if (existingStock) {
        const newQty = existingStock.quantity + qtyNum;
        await supabase.from("inventory").update({ quantity: newQty }).eq("id", existingStock.id);
      } else {
        await supabase.from("inventory").insert([
          {
            party_id: selectedPartyId,
            party_name: partyObj?.name || "N/A",
            product_id: selectedProductId,
            product_name: prodObj?.product_name || "N/A",
            component_type: componentType,
            quantity: qtyNum,
          },
        ]);
      }

      // Sync with inventory_summary table
      const { data: summaryData } = await supabase
        .from("inventory_summary")
        .select("*")
        .eq("party_id", selectedPartyId)
        .eq("product_id", selectedProductId)
        .single();

      if (summaryData) {
        const currentCompQty = summaryData[componentType] || 0;
        await supabase
          .from("inventory_summary")
          .update({ [componentType]: currentCompQty + qtyNum })
          .eq("id", summaryData.id);
      } else {
        await supabase.from("inventory_summary").insert([
          {
            party_id: selectedPartyId,
            party_name: partyObj?.name || "N/A",
            product_id: selectedProductId,
            product_name: prodObj?.product_name || "N/A",
            [componentType]: qtyNum,
          },
        ]);
      }

      alert("Stock IN recorded successfully & Synced with Filling Incharge!");
      setSelectedPartyId("");
      setSelectedProductId("");
      setQtyPcs("");
      setRemarks("");
      fetchWarehouseAndMasterData();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStockOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outPartyIdInput || !outProductIdInput || !outQtyPcs) {
      return alert("Please select Party, Product, and enter Quantity for Stock OUT.");
    }

    setLoading(true);
    try {
      const partyObj = partiesList.find((p) => p.id === outPartyIdInput);
      const prodObj = productsList.find((p) => p.id === outProductIdInput);
      const qtyNum = parseInt(outQtyPcs) || 0;

      const stockItem = stockBalances.find(
        (s) =>
          (s.party_id === outPartyIdInput || s.party_name?.toLowerCase() === partyObj?.name?.toLowerCase()) &&
          (s.product_id === outProductIdInput || s.product_name?.toLowerCase() === prodObj?.product_name?.toLowerCase()) &&
          s.component_type?.toLowerCase() === outComponentType.toLowerCase()
      );

      const availableQty = stockItem ? stockItem.quantity : 0;
      if (qtyNum > availableQty) {
        setLoading(false);
        return alert(`Stock Out Error: Available quantity (${availableQty} Pcs) is less than requested issue quantity (${qtyNum} Pcs).`);
      }

      const logPayload = {
        action_type: "OUT",
        party_name: partyObj?.name || "N/A",
        product_name: prodObj?.product_name || "N/A",
        component_type: outComponentType,
        quantity: qtyNum,
        remarks: outRemarks || "Manual Stock OUT entry from Warehouse",
        created_at: new Date().toISOString(),
      };

      const { error: logErr } = await supabase.from("inventory_logs").insert([logPayload]);
      if (logErr) throw logErr;

      const newQty = Math.max(0, availableQty - qtyNum);
      if (stockItem) {
        await supabase.from("inventory").update({ quantity: newQty }).eq("id", stockItem.id);
      }

      alert("Stock OUT recorded successfully & Balance updated!");
      setOutPartyIdInput("");
      setOutProductIdInput("");
      setOutQtyPcs("");
      setOutRemarks("");
      fetchWarehouseAndMasterData();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredRequests = requestsList.filter((r) => {
    if (reqPartyId && r.party_id !== reqPartyId) return false;
    if (reqProductId && r.product_id !== reqProductId) return false;
    if (r.required_date) {
      const itemDate = new Date(r.required_date).toISOString().split("T")[0];
      if (reqStartDate && itemDate < reqStartDate) return false;
      if (reqEndDate && itemDate > reqEndDate) return false;
    }
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

  const filteredStockBalances = stockBalances.filter((s) => {
    if (balPartyId && s.party_id !== balPartyId && s.party_name !== partiesList.find(p => p.id === balPartyId)?.name) return false;
    if (balProductId && s.product_id !== balProductId && s.product_name !== productsList.find(p => p.id === balProductId)?.product_name) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 p-3 sm:p-6 font-sans space-y-6 uppercase">
      <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 max-w-7xl mx-auto">
        <div>
          <span className="text-[10px] sm:text-xs font-semibold text-blue-400 uppercase tracking-wider">
            WAREHOUSE MANAGEMENT PORTAL
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1">Dispatches, Stock IN/OUT & Balance</h1>
        </div>
        <button
          onClick={fetchWarehouseAndMasterData}
          className="w-full sm:w-auto px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 text-center"
        >
          🔄 Refresh Warehouse Data
        </button>
      </div>

      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex gap-2 border-b border-slate-800 pb-3 overflow-x-auto scrollbar-thin">
          <button
            onClick={() => setActiveTab("requests")}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${
              activeTab === "requests" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            📦 Filling Requests ({requestsList.filter(r => r.status === "PENDING_WAREHOUSE").length})
          </button>
          <button
            onClick={() => setActiveTab("stock_in")}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${
              activeTab === "stock_in" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            📥 Stock IN Portal
          </button>
          <button
            onClick={() => setActiveTab("stock_out")}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${
              activeTab === "stock_out" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            📤 Stock OUT Portal & History
          </button>
          <button
            onClick={() => setActiveTab("balance")}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${
              activeTab === "balance" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
            }`}
          >
            🏢 Inventory Balance
          </button>
        </div>

        {activeTab === "requests" && (
          <div className="space-y-4">
            <div className="bg-[#121827] border border-slate-800 p-3 sm:p-4 rounded-xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Filter by Party</label>
                <select
                  value={reqPartyId}
                  onChange={(e) => {
                    setReqPartyId(e.target.value);
                    setReqProductId("");
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
                  value={reqProductId}
                  onChange={(e) => setReqProductId(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                  disabled={!reqPartyId}
                >
                  <option value="">-- All Products --</option>
                  {filteredProductsForReq.map((prod) => (
                    <option key={prod.id} value={prod.id}>{prod.product_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">From Date</label>
                <input
                  type="date"
                  value={reqStartDate}
                  onChange={(e) => setReqStartDate(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">To Date</label>
                <input
                  type="date"
                  value={reqEndDate}
                  onChange={(e) => setReqEndDate(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
                />
              </div>
            </div>

            <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h2 className="text-sm sm:text-md font-bold text-white">Filling Requests (Batch & Pricing Details)</h2>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => exportExcel(
                      filteredRequests.map(({ room_number, ...request }) => ({
                        ...request,
                        room: room_number ? `Room ${room_number}` : "N/A",
                      })),
                      "Filling_Requests_Dispatch"
                    )}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() =>
                      exportPDFWithLogo(
                        "Warehouse Filling Requests Log",
                        ["Batch No", "Mfg/Exp", "Price", "Party", "Product", "Pack Size", "Room", "Pcs", "Target Wt", "Scale Wt", "Dates", "Status"],
                        filteredRequests.map((f) => [
                          f.batch_no || f.req_code || "N/A",
                          `Mfg: ${f.mfg_date}\nExp: ${f.exp_date}`,
                          `Rs. ${f.retail_price || 0}`,
                          f.party_name,
                          f.product_name,
                          f.pack_size ? `${f.pack_size} ${f.pack_unit || "ML"}` : "N/A",
                          f.room_number ? `Room ${f.room_number}` : "N/A",
                          f.pcs_requested,
                          `${(f.total_weight_kg || 0).toFixed(2)} Kg`,
                          f.actual_dispatched_weight_kg ? `${f.actual_dispatched_weight_kg.toFixed(2)} Kg` : "Pending",
                          `Req: ${f.required_date || "-"}\nSent: ${f.requested_at ? new Date(f.requested_at).toLocaleDateString() : "-"}\nDisp: ${f.dispatched_at || "-"}\nRecv: ${f.received_at || "-"}`,
                          f.status,
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
                        <th className="p-3">Batch & Pricing</th>
                        <th className="p-3">Party & Product</th>
                        <th className="p-3">Pack Size</th>
                        <th className="p-3">Room</th>
                        <th className="p-3">Pcs</th>
                        <th className="p-3 text-indigo-400">Target Wt</th>
                        <th className="p-3 text-amber-400">Scale Wt</th>
                        <th className="p-3">All Dates & Status</th>
                        <th className="p-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {filteredRequests.map((req) => (
                        <tr key={req.id} className="hover:bg-slate-800/50">
                          <td className="p-3 whitespace-nowrap">
                            <div className="font-mono text-purple-400 font-bold">{req.batch_no || req.req_code}</div>
                            <div className="text-[10px] text-slate-400">Mfg: {req.mfg_date} | Exp: {req.exp_date}</div>
                            <div className="text-[10px] text-amber-300 font-bold">Rs. {req.retail_price || 0}</div>
                          </td>
                          <td className="p-3">
                            <div className="font-bold text-white">{req.party_name}</div>
                            <div className="text-[10px] text-emerald-400">{req.product_name}</div>
                          </td>
                          <td className="p-3 whitespace-nowrap font-mono font-bold text-cyan-300">
                            {req.pack_size ? `${req.pack_size} ${req.pack_unit || "ML"}` : "N/A"}
                          </td>
                          <td className="p-3 whitespace-nowrap font-bold text-cyan-300">
                            {req.room_number ? `Room ${req.room_number}` : "N/A"}
                          </td>
                          <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">{req.pcs_requested} Pcs</td>
                          <td className="p-3 font-mono font-bold text-indigo-300 whitespace-nowrap">
                            {(req.total_weight_kg || 0).toFixed(2)} Kg
                          </td>
                          <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">
                            {req.actual_dispatched_weight_kg ? `${req.actual_dispatched_weight_kg.toFixed(2)} Kg` : "Pending"}
                          </td>
                          <td className="p-3 text-[10px] space-y-1 min-w-[180px]">
                            <div className="text-slate-300">📅 <span className="font-semibold">Required:</span> {req.required_date || "N/A"}</div>
                            <div className="text-slate-400">📤 <span className="font-semibold">Request Sent:</span> {req.requested_at ? new Date(req.requested_at).toLocaleString() : "N/A"}</div>
                            <div className="text-slate-400">🚚 <span className="font-semibold">Warehouse Disp:</span> {req.dispatched_at || "Pending"}</div>
                            <div className="text-slate-400">📥 <span className="font-semibold">Filling Recv:</span> {req.received_at || "Pending"}</div>
                            <div className="pt-0.5">
                              <span
                                className={`px-2 py-0.5 rounded font-bold inline-block ${
                                  req.status === "RECEIVED_BY_FILLING_INCHARGE" || req.status === "RECEIVED_AND_VERIFIED"
                                    ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                                    : req.status === "DISPATCHED_BY_WAREHOUSE"
                                    ? "bg-blue-950 text-blue-400 border border-blue-800"
                                    : "bg-amber-950 text-amber-400 border border-amber-800"
                                }`}
                              >
                                {req.status === "RECEIVED_BY_FILLING_INCHARGE" ? "RECEIVED BY FILLING" : req.status}
                              </span>
                            </div>
                          </td>
                          <td className="p-3 text-right space-y-2 whitespace-nowrap">
                            {req.status === "PENDING_WAREHOUSE" && (
                              <button
                                onClick={() => handleOpenDispatchModal(req)}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-md block ml-auto w-full sm:w-auto"
                              >
                                ⚖ Dispatch
                              </button>
                            )}
                            <button
                              onClick={() => {
                                let fixedReq = req;
                                if (!fixedReq.components || fixedReq.components.length === 0) {
                                  const q = fixedReq.pcs_requested || 1000;
                                  fixedReq.components = [
                                    { component_type: "bottle", pcs_requested: q, weight_10_pcs_grams: 122, theoretical_weight_kg: (q * 12.2) / 1000 },
                                    { component_type: "cap", pcs_requested: q, weight_10_pcs_grams: 45, theoretical_weight_kg: (q * 4.5) / 1000 },
                                    { component_type: "nozzle", pcs_requested: q, weight_10_pcs_grams: 15, theoretical_weight_kg: (q * 1.5) / 1000 },
                                    { component_type: "seal", pcs_requested: q, weight_10_pcs_grams: 5, theoretical_weight_kg: (q * 0.5) / 1000 },
                                  ];
                                }
                                setSelectedRequestForModal(fixedReq);
                              }}
                              className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600 text-amber-300 hover:text-white rounded-lg text-xs font-bold border border-amber-500/30 transition block ml-auto w-full sm:w-auto text-center"
                            >
                              🔍 Weights View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 100% DYNAMIC COMPONENT TYPE DROPDOWN IN STOCK IN PORTAL */}
        {activeTab === "stock_in" && (
          <div className="space-y-6">
            <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-6">
              <h2 className="text-sm sm:text-md font-bold text-white">Stock IN Portal (Receive Material into Warehouse)</h2>
              <form onSubmit={handleSaveStockIn} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Select Party / Company</label>
                    <select
                      value={selectedPartyId}
                      onChange={(e) => {
                        setSelectedPartyId(e.target.value);
                        setSelectedProductId("");
                      }}
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                      required
                    >
                      <option value="">-- Select Party --</option>
                      {partiesList.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Select Product</label>
                    <select
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                      required
                      disabled={!selectedPartyId}
                    >
                      <option value="">-- Select Product --</option>
                      {filteredProductsForSelect.map((prod) => (
                        <option key={prod.id} value={prod.id}>{prod.product_name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Component Type (Live Dynamic from DB)</label>
                    <select
                      value={componentType}
                      onChange={(e) => setComponentType(e.target.value)}
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white uppercase"
                    >
                      {dynamicComponentTypes.map((type) => (
                        <option key={type} value={type}>
                          {type.replace("_", " ").toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-amber-400 block mb-1">Quantity Received (Pcs)</label>
                    <input
                      type="number"
                      value={qtyPcs}
                      onChange={(e) => setQtyPcs(e.target.value)}
                      placeholder="e.g. 5000"
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Remarks / Note</label>
                    <input
                      type="text"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Supplier details or batch info"
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-lg"
                >
                  {loading ? "Saving..." : "Confirm & Save Stock IN Entry"}
                </button>
              </form>
            </div>

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

        {activeTab === "stock_out" && (
          <div className="space-y-6">
            <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-6">
              <h2 className="text-sm sm:text-md font-bold text-white">Manual Stock OUT Form (Issue / Dispatch Material)</h2>
              <form onSubmit={handleSaveStockOut} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Select Party / Company</label>
                    <select
                      value={outPartyIdInput}
                      onChange={(e) => {
                        setOutPartyIdInput(e.target.value);
                        setOutProductIdInput("");
                      }}
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                      required
                    >
                      <option value="">-- Select Party --</option>
                      {partiesList.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Select Product</label>
                    <select
                      value={outProductIdInput}
                      onChange={(e) => setOutProductIdInput(e.target.value)}
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                      required
                      disabled={!outPartyIdInput}
                    >
                      <option value="">-- Select Product --</option>
                      {filteredProductsForOutForm.map((prod) => (
                        <option key={prod.id} value={prod.id}>{prod.product_name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Component Type</label>
                    <select
                      value={outComponentType}
                      onChange={(e) => setOutComponentType(e.target.value)}
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white uppercase"
                    >
                      {dynamicComponentTypes.map((type) => (
                        <option key={type} value={type}>{type.replace("_", " ").toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-amber-400 block mb-1">Issue Quantity (Pcs)</label>
                    <input
                      type="number"
                      value={outQtyPcs}
                      onChange={(e) => setOutQtyPcs(e.target.value)}
                      placeholder="e.g. 1000"
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Remarks / Purpose</label>
                    <input
                      type="text"
                      value={outRemarks}
                      onChange={(e) => setOutRemarks(e.target.value)}
                      placeholder="Reason for manual stock out / issue"
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-lg"
                >
                  {loading ? "Processing..." : "Confirm & Save Manual Stock OUT Entry"}
                </button>
              </form>
            </div>

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
                <h2 className="text-sm sm:text-md font-bold text-white">Complete Inventory Stock Balance</h2>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => exportExcel(filteredStockBalances, "Complete_Inventory_Balance")}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() =>
                      exportPDFWithLogo(
                        "Warehouse Inventory Stock Balance",
                        ["Party Name", "Product Name", "Component Type", "Available Quantity"],
                        filteredStockBalances.map((s) => [s.party_name || "General", s.product_name || "General", s.component_type.toUpperCase(), `${s.quantity || 0} Pcs`])
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
                          <td className="p-3 font-bold text-white">{stk.party_name || "General Party"}</td>
                          <td className="p-3 text-emerald-400">{stk.product_name || "General Product"}</td>
                          <td className="p-3 uppercase text-indigo-300">{stk.component_type}</td>
                          <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">{stk.quantity || 0} Pcs</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {dispatchModalReq && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 font-sans text-slate-100 overflow-y-auto">
          <div className="bg-[#121827] border border-slate-800 rounded-2xl w-full max-w-2xl p-4 sm:p-6 space-y-6 shadow-2xl my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-800 pb-4">
              <div>
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                  Batch No: {dispatchModalReq.batch_no || dispatchModalReq.req_code} ({dispatchModalReq.pcs_requested} Pcs)
                </span>
                <h2 className="text-base sm:text-lg font-extrabold text-white">Weighing Scale Component Input</h2>
              </div>
              <button onClick={() => setDispatchModalReq(null)} className="text-slate-400 hover:text-white font-bold text-lg p-1">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Har component ka actual weight (Kg) scale par tol kar yahan darj karein:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {(dispatchModalReq.components || [
                  { component_type: "bottle", theoretical_weight_kg: (dispatchModalReq.pcs_requested * 12.2) / 1000 },
                  { component_type: "cap", theoretical_weight_kg: (dispatchModalReq.pcs_requested * 4.5) / 1000 },
                  { component_type: "nozzle", theoretical_weight_kg: (dispatchModalReq.pcs_requested * 1.5) / 1000 },
                  { component_type: "seal", theoretical_weight_kg: (dispatchModalReq.pcs_requested * 0.5) / 1000 },
                ]).map((c, idx) => (
                  <div key={idx} className="bg-[#0b0f19] border border-slate-800 p-3 rounded-xl space-y-1">
                    <div className="flex justify-between text-xs font-bold text-white uppercase">
                      <span>{c.component_type.toUpperCase()}</span>
                      <span className="text-indigo-400 font-mono">Target: {(c.theoretical_weight_kg || 0).toFixed(2)} Kg</span>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={dispatchWeights[c.component_type] || ""}
                      onChange={(e) =>
                        setDispatchWeights({
                          ...dispatchWeights,
                          [c.component_type]: e.target.value,
                        })
                      }
                      placeholder="Enter scale weight in Kg"
                      className="w-full bg-[#121827] border border-slate-700 rounded-lg p-2.5 text-xs text-amber-300 font-mono font-bold"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-2">
              <button
                onClick={() => setDispatchModalReq(null)}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition text-center"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDispatch}
                disabled={loading}
                className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition shadow-lg text-center"
              >
                {loading ? "Processing..." : "Confirm & Dispatch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRequestForModal && (
        <WeightVerificationModal
          isOpen={!!selectedRequestForModal}
          onClose={() => setSelectedRequestForModal(null)}
          req={selectedRequestForModal}
        />
      )}
    </div>
  );
}

function WeightVerificationModal({
  isOpen,
  onClose,
  req,
}: {
  isOpen: boolean;
  onClose: () => void;
  req: FillingRequest;
}) {
  if (!isOpen) return null;

  const componentsList = req.components && req.components.length > 0 ? req.components : [
    { component_type: "bottle", pcs_requested: req.pcs_requested, weight_10_pcs_grams: 122, theoretical_weight_kg: (req.pcs_requested * 12.2) / 1000 },
    { component_type: "cap", pcs_requested: req.pcs_requested, weight_10_pcs_grams: 45, theoretical_weight_kg: (req.pcs_requested * 4.5) / 1000 },
    { component_type: "nozzle", pcs_requested: req.pcs_requested, weight_10_pcs_grams: 15, theoretical_weight_kg: (req.pcs_requested * 1.5) / 1000 },
    { component_type: "seal", pcs_requested: req.pcs_requested, weight_10_pcs_grams: 5, theoretical_weight_kg: (req.pcs_requested * 0.5) / 1000 },
  ];

  const totalTheoreticalKg = componentsList.reduce((sum, c) => sum + (c.theoretical_weight_kg || 0), 0);
  const totalActualKg = componentsList.reduce((sum, c) => sum + (c.actual_issued_weight_kg || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50 font-sans text-slate-100 overflow-y-auto">
      <div className="bg-[#121827] border border-slate-800 rounded-2xl w-full max-w-3xl p-4 sm:p-6 space-y-6 shadow-2xl my-auto max-h-[90vh] overflow-y-auto">
        <div className="files flex justify-between items-start border-b border-slate-800 pb-4">
          <div>
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
              Batch No: {req.batch_no || req.req_code || "N/A"} ({req.pcs_requested} Pcs) | Price: Rs. {req.retail_price || 0}
            </span>
            <h2 className="text-lg sm:text-xl font-extrabold text-white">Component Weight Verification Modal</h2>
            <p className="text-xs text-slate-400 mt-1">
              Party: <span className="text-white font-semibold">{req.party_name}</span> | Product:{" "}
              <span className="text-emerald-400 font-semibold">{req.product_name}</span>
              {req.pack_size ? <> | Pack: <span className="text-cyan-300 font-semibold">{req.pack_size} {req.pack_unit || "ML"}</span></> : null}
              {" "} | Room: <span className="text-cyan-300 font-semibold">{req.room_number ? `Room ${req.room_number}` : "N/A"}</span>
              {" "} | Mfg:{" "}
              <span className="text-indigo-300">{req.mfg_date}</span> | Exp: <span className="text-rose-300">{req.exp_date}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-lg p-1">
            ✕
          </button>
        </div>

        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <div className="inline-block min-w-full align-middle px-4 sm:px-0">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold">
                <tr>
                  <th className="p-3">Component Item</th>
                  <th className="p-3">10 Pcs Grams</th>
                  <th className="p-3 text-indigo-400">Target Wt (Kg)</th>
                  <th className="p-3 text-amber-400">Dispatched Wt (Kg)</th>
                  <th className="p-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {componentsList.map((c, idx) => {
                  const actual = c.actual_issued_weight_kg || 0;
                  const variance = actual - (c.theoretical_weight_kg || 0);

                  return (
                    <tr key={idx} className="hover:bg-slate-800/50">
                      <td className="p-3 font-bold text-white uppercase">{c.component_type}</td>
                      <td className="p-3 font-mono text-slate-400 whitespace-nowrap">{c.weight_10_pcs_grams || 0}g</td>
                      <td className="p-3 font-mono font-bold text-indigo-300 whitespace-nowrap">
                        {(c.theoretical_weight_kg || 0).toFixed(2)} Kg
                      </td>
                      <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">
                        {actual > 0 ? `${actual.toFixed(2)} Kg` : "Pending"}
                      </td>
                      <td className="p-3 text-right font-mono font-bold whitespace-nowrap">
                        {actual > 0 ? (
                          <span className={variance >= 0 ? "text-emerald-400" : "text-rose-400"}>
                            {variance >= 0 ? `+${variance.toFixed(2)}` : variance.toFixed(2)} Kg
                          </span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#0b0f19] border-t border-slate-800 font-bold text-white">
                <tr>
                  <td colSpan={2} className="p-3 text-right">
                    TOTAL WEIGHT:
                  </td>
                  <td className="p-3 font-mono text-indigo-400 whitespace-nowrap">{totalTheoreticalKg.toFixed(2)} Kg</td>
                  <td className="p-3 font-mono text-amber-400 whitespace-nowrap">{totalActualKg > 0 ? `${totalActualKg.toFixed(2)} Kg` : `${totalTheoreticalKg.toFixed(2)} Kg`}</td>
                  <td className="p-3 text-right font-mono text-emerald-400 whitespace-nowrap">
                    {totalActualKg > 0 ? `${(totalActualKg - totalTheoreticalKg).toFixed(2)} Kg` : "0.00 Kg"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition text-center"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}