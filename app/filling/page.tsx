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
  code?: string;
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

interface BomComponentRequirement {
  component_type: string;
  qty_per_unit: number;
  available_stock: number;
}

interface FillingRequest {
  id: string;
  batch_no: string;
  req_code?: string;
  mfg_date: string;
  exp_date: string;
  retail_price: number;
  party_id?: string;
  product_id?: string;
  party_name: string;
  product_name: string;
  pcs_requested: number;
  required_date: string;
  total_weight_kg?: number;
  actual_dispatched_weight_kg?: number;
  requested_at?: string;
  dispatched_at?: string;
  received_at?: string;
  status: "PENDING_WAREHOUSE" | "DISPATCHED_BY_WAREHOUSE" | "RECEIVED_BY_FILLING_INCHARGE" | "RECEIVED_AND_VERIFIED";
  created_at?: string;
  components?: ComponentWeightItem[];
}

export default function FillingInchargePage() {
  const [partiesList, setPartiesList] = useState<Party[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [fillingRequests, setFillingRequests] = useState<FillingRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const [batchNo, setBatchNo] = useState<string>(`BATCH-${Math.floor(1000 + Math.random() * 9000)}`);
  const [mfgDate, setMfgDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [expDate, setExpDate] = useState<string>("");
  const [retailPrice, setRetailPrice] = useState<string>("");

  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [pcsRequested, setPcsRequested] = useState<string>("");
  const [requiredDate, setRequiredDate] = useState<string>(new Date().toISOString().split("T")[0]);

  const [productBomPreview, setProductBomPreview] = useState<BomComponentRequirement[]>([]);
  const [stockErrorMsg, setStockErrorMsg] = useState<string | null>(null);
  const [maxPossiblePcs, setMaxPossiblePcs] = useState<number | null>(null);
  const [selectedRequestForModal, setSelectedRequestForModal] = useState<FillingRequest | null>(null);

  const [filterPartyName, setFilterPartyName] = useState("");
  const [filterProductName, setFilterProductName] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  useEffect(() => {
    fetchLiveSupabaseData();
  }, []);

  const fetchLiveSupabaseData = async () => {
    setLoading(true);
    try {
      const { data: partyData } = await supabase.from("parties").select("*");
      if (partyData) setPartiesList(partyData);

      const { data: prodData } = await supabase.from("products").select("*");
      if (prodData) setProductsList(prodData);

      const { data: reqData, error: reqErr } = await supabase
        .from("filling_requests")
        .select("*");

      if (reqErr) {
        console.warn("Filling Requests fetch error:", reqErr.message);
      }

      if (reqData) {
        setFillingRequests(reqData as FillingRequest[]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleProductSelection = async (prodId: string) => {
    setSelectedProductId(prodId);
    setStockErrorMsg(null);
    setPcsRequested("");
    setProductBomPreview([]);

    if (!prodId) return;

    try {
      const { data: bomData } = await supabase
        .from("product_bom")
        .select("*")
        .eq("product_id", prodId);

      const { data: invData } = await supabase
        .from("inventory")
        .select("*");

      if (bomData && bomData.length > 0) {
        const previewList: BomComponentRequirement[] = bomData.map((item: any) => {
          const compType = item.component_type || item.component_name || "Component";
          const matchedInv = invData?.find(
            (inv: any) => inv.component_type?.toLowerCase() === compType.toLowerCase() && inv.party_id === selectedPartyId
          );
          return {
            component_type: compType,
            qty_per_unit: item.qty_per_unit || item.quantity || 1,
            available_stock: matchedInv ? matchedInv.quantity : 5000,
          };
        });
        setProductBomPreview(previewList);
      } else {
        setProductBomPreview([
          { component_type: "bottle", qty_per_unit: 1, available_stock: 4000 },
          { component_type: "cap", qty_per_unit: 1, available_stock: 2500 },
          { component_type: "nozzle", qty_per_unit: 1, available_stock: 6000 },
          { component_type: "seal", qty_per_unit: 1, available_stock: 3000 },
          { component_type: "carton", qty_per_unit: 0.1, available_stock: 500 },
        ]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleQuantityChange = (qtyVal: string) => {
    setPcsRequested(qtyVal);
    setStockErrorMsg(null);
    setMaxPossiblePcs(null);

    const qty = parseInt(qtyVal);
    if (!qtyVal || isNaN(qty) || productBomPreview.length === 0) return;

    const shortages: string[] = [];
    let minAllowed = qty;

    productBomPreview.forEach((comp) => {
      const requiredTotal = qty * comp.qty_per_unit;
      if (comp.available_stock < requiredTotal) {
        const diff = requiredTotal - comp.available_stock;
        shortages.push(`${diff} Pcs ${comp.component_type}s kam hain`);
        const possibleForThisComp = Math.floor(comp.available_stock / comp.qty_per_unit);
        if (possibleForThisComp < minAllowed) {
          minAllowed = possibleForThisComp;
        }
      }
    });

    if (shortages.length > 0) {
      setMaxPossiblePcs(minAllowed);
      setStockErrorMsg(
        `Aap abhi maximum ${minAllowed} Pcs ka order laga sakte hain! (${shortages.join(", ")})`
      );
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyId || !selectedProductId || !pcsRequested || !batchNo || !expDate || !retailPrice) {
      return alert("Please fill all required fields including Batch No, Expiry Date, and Retail Price.");
    }

    if (stockErrorMsg) {
      return alert(`Order Cannot Be Processed!\n\n${stockErrorMsg}`);
    }

    setLoading(true);
    try {
      const partyObj = partiesList.find((p) => p.id === selectedPartyId);
      const prodObj = productsList.find((p) => p.id === selectedProductId);
      const qty = parseInt(pcsRequested) || 0;

      const generatedComponents: ComponentWeightItem[] = productBomPreview.map((comp) => ({
        component_type: comp.component_type,
        pcs_requested: qty * comp.qty_per_unit,
        weight_10_pcs_grams: 122,
        theoretical_weight_kg: (qty * comp.qty_per_unit * 1.22) / 1000,
      }));

      const totalWeight = generatedComponents.reduce((sum, c) => sum + c.theoretical_weight_kg, 0);

      const payload: any = {
        batch_no: batchNo,
        req_code: batchNo,
        mfg_date: mfgDate,
        exp_date: expDate,
        retail_price: parseFloat(retailPrice) || 0,
        party_id: selectedPartyId,
        product_id: selectedProductId,
        party_name: partyObj?.name || "N/A",
        product_name: prodObj?.product_name || "N/A",
        pcs_requested: qty,
        required_date: requiredDate,
        total_weight_kg: totalWeight,
        requested_at: new Date().toLocaleString(),
        status: "PENDING_WAREHOUSE",
        components: generatedComponents,
      };

      let res = await supabase.from("filling_requests").insert([payload]);

      if (res.error && res.error.message?.includes("components")) {
        delete payload.components;
        res = await supabase.from("filling_requests").insert([payload]);
      }

      if (res.error) throw res.error;

      alert(`Filling Requisition (Batch: ${batchNo}) Saved Successfully!`);

      fetchLiveSupabaseData();

      setSelectedPartyId("");
      setSelectedProductId("");
      setPcsRequested("");
      setRetailPrice("");
      setExpDate("");
      setStockErrorMsg(null);
      setProductBomPreview([]);
      setBatchNo(`BATCH-${Math.floor(1000 + Math.random() * 9000)}`);
    } catch (err: any) {
      alert("Database Save Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReceived = async (reqId: string) => {
    if (!confirm("Kya aapne Warehouse se aaya hua poora material weight verify karke receive kar liya hai?")) return;

    setLoading(true);
    try {
      const receiveTimestamp = new Date().toLocaleString();

      const { error } = await supabase
        .from("filling_requests")
        .update({
          status: "RECEIVED_BY_FILLING_INCHARGE",
          received_at: receiveTimestamp,
        })
        .eq("id", reqId);

      if (error) throw error;

      alert("Material Received & Verified Successfully!");
      fetchLiveSupabaseData();
    } catch (err: any) {
      alert("Update Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = (data: any[], fileName: string) => {
    const worksheet = XLSX.utils.json_to_sheet(data);
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
      headStyles: { fillColor: [217, 119, 6] },
      styles: { fontSize: 8 },
    });

    doc.save(`${title.toLowerCase().replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`);
  };

  const filterRecord = (createdAt?: string, pName?: string, prName?: string) => {
    if (filterPartyName && pName && !pName.toLowerCase().includes(filterPartyName.toLowerCase())) return false;
    if (filterProductName && prName && !prName.toLowerCase().includes(filterProductName.toLowerCase())) return false;
    if (createdAt) {
      const itemDate = new Date(createdAt).toISOString().split("T")[0];
      if (filterStartDate && itemDate < filterStartDate) return false;
      if (filterEndDate && itemDate > filterEndDate) return false;
    }
    return true;
  };

  const filteredProductsForSelect = productsList.filter((p) => p.party_id === selectedPartyId);
  const filteredRequestsList = fillingRequests.filter((r) =>
    filterRecord(r.created_at || r.requested_at, r.party_name, r.product_name)
  );

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 p-3 sm:p-6 font-sans space-y-6">
      <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 max-w-7xl mx-auto">
        <div>
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
            FILLING & PACKAGING INCHARGE PORTAL
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1">Material Requisition & Weight Verification</h1>
        </div>
        <button
          onClick={fetchLiveSupabaseData}
          className="w-full sm:w-auto px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 text-center"
        >
          🔄 Refresh Live Supabase Data
        </button>
      </div>

      <div className="max-w-7xl mx-auto space-y-6">
        <div className="bg-[#121827] border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-6">
          <h2 className="text-sm sm:text-md font-bold text-slate-200 flex items-center gap-2">
            <span className="bg-amber-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0">
              1
            </span>
            Create Material Requisition PO (Batch & Pricing Details)
          </h2>

          <form onSubmit={handleCreateRequest} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Batch Number</label>
                <input
                  type="text"
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-purple-400 font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Manufacturing Date</label>
                <input
                  type="date"
                  value={mfgDate}
                  onChange={(e) => setMfgDate(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-amber-400 block mb-1">Retail Price (PKR)</label>
                <input
                  type="number"
                  step="0.01"
                  value={retailPrice}
                  onChange={(e) => setRetailPrice(e.target.value)}
                  placeholder="e.g. 450"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Select Party / Company</label>
                <select
                  value={selectedPartyId}
                  onChange={(e) => {
                    setSelectedPartyId(e.target.value);
                    setSelectedProductId("");
                    setProductBomPreview([]);
                  }}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                  required
                >
                  <option value="">-- Select Party --</option>
                  {partiesList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Select Product</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => handleProductSelection(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                  required
                  disabled={!selectedPartyId}
                >
                  <option value="">-- Select Product --</option>
                  {filteredProductsForSelect.map((prod) => (
                    <option key={prod.id} value={prod.id}>
                      {prod.product_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-amber-400 block mb-1">Quantity Requested (Pcs)</label>
                <input
                  type="number"
                  value={pcsRequested}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                  placeholder="e.g. 3000"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                  required
                  disabled={!selectedProductId}
                />
              </div>

              <div>
                <label className="text-xs text-indigo-400 block mb-1">Required Date</label>
                <input
                  type="date"
                  value={requiredDate}
                  onChange={(e) => setRequiredDate(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                  required
                />
              </div>
            </div>

            {productBomPreview.length > 0 && (
              <div className="bg-[#0b0f19] border border-slate-800 p-4 rounded-xl space-y-2">
                <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider block">
                  📋 Admin BOM & Current Inventory Stock Status (Per Set Preview):
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                  {productBomPreview.map((comp, idx) => (
                    <div key={idx} className="bg-[#121827] border border-slate-800/80 p-2.5 rounded-lg text-center">
                      <div className="text-[10px] text-slate-400 capitalize">{comp.component_type}</div>
                      <div className="text-xs font-mono font-bold text-white mt-0.5">
                        {pcsRequested ? parseInt(pcsRequested || "0") * comp.qty_per_unit : 0} Pcs
                      </div>
                      <div className="text-[9px] text-emerald-400 mt-1">
                        Stock: {comp.available_stock} Pcs
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stockErrorMsg && (
              <div className="bg-rose-950/80 border border-rose-800 p-4 rounded-xl text-rose-300 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 animate-pulse">
                <div className="font-semibold flex items-center gap-2">
                  <span>⚠️ Inventory Warning:</span>
                  <span>{stockErrorMsg}</span>
                </div>
                {maxPossiblePcs && (
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(maxPossiblePcs.toString())}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-[10px] shrink-0"
                  >
                    Set Max Available ({maxPossiblePcs} Pcs)
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-lg"
            >
              {loading ? "Saving to Supabase..." : "Send Material Requisition Order To Warehouse"}
            </button>
          </form>
        </div>

        <div className="bg-[#121827] border border-slate-800 p-3 sm:p-4 rounded-xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Filter by Party</label>
            <input
              type="text"
              placeholder="Search Party..."
              value={filterPartyName}
              onChange={(e) => setFilterPartyName(e.target.value)}
              className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Filter by Product</label>
            <input
              type="text"
              placeholder="Search Product..."
              value={filterProductName}
              onChange={(e) => setFilterProductName(e.target.value)}
              className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">From Date</label>
            <input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">To Date</label>
            <input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
            />
          </div>
        </div>

        <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <h2 className="text-sm sm:text-md font-bold text-white">Filling Requests Workflow & Verification Log</h2>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => exportExcel(filteredRequestsList, "Filling_Requests_Log")}
                className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
              >
                Excel
              </button>
              <button
                onClick={() => {
                  exportPDFWithLogo(
                    "Filling Incharge Material Requisition Log",
                    ["Batch No", "Mfg/Exp", "Retail Price", "Party", "Product", "Pcs"],
                    filteredRequestsList.map((f) => [
                      f.batch_no || f.req_code || "N/A",
                      `Mfg: ${f.mfg_date || "N/A"}\nExp: ${f.exp_date || "N/A"}`,
                      `Rs. ${f.retail_price || 0}`,
                      f.party_name,
                      f.product_name,
                      f.pcs_requested,
                    ])
                  );
                }}
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
                    <th className="p-3">Pcs</th>
                    <th className="p-3 text-indigo-400">Target Wt</th>
                    <th className="p-3 text-amber-400">Scale Wt</th>
                    <th className="p-3">Dates</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredRequestsList.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-800/50">
                      <td className="p-3 whitespace-nowrap">
                        <div className="font-mono text-purple-400 font-bold">{req.batch_no || req.req_code || "N/A"}</div>
                        <div className="text-[10px] text-amber-300 font-bold mt-0.5">Rs. {req.retail_price || 0}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-white">{req.party_name}</div>
                        <div className="text-[10px] text-emerald-400">{req.product_name}</div>
                      </td>
                      <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">{req.pcs_requested} Pcs</td>
                      <td className="p-3 font-mono font-bold text-indigo-300 whitespace-nowrap">
                        {(req.total_weight_kg || 0).toFixed(2)} Kg
                      </td>
                      <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">
                        {req.actual_dispatched_weight_kg
                          ? `${req.actual_dispatched_weight_kg.toFixed(2)} Kg`
                          : "Pending"}
                      </td>
                      <td className="p-3 text-slate-300 text-[10px] space-y-0.5 whitespace-nowrap">
                        <div>Req: {req.required_date}</div>
                        <div className="text-emerald-400">Mfg: {req.mfg_date}</div>
                        <div className="text-rose-400">Exp: {req.exp_date}</div>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <div className="mb-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block ${
                              req.status === "RECEIVED_BY_FILLING_INCHARGE"
                                ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                                : req.status === "DISPATCHED_BY_WAREHOUSE"
                                ? "bg-blue-950 text-blue-400 border border-blue-800"
                                : "bg-amber-950 text-amber-400 border border-amber-800"
                            }`}
                          >
                            {req.status}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-right space-y-2 whitespace-nowrap">
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
                          ⚖️ Weights View
                        </button>

                        {req.status === "DISPATCHED_BY_WAREHOUSE" && (
                          <button
                            onClick={() => handleConfirmReceived(req.id)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition block ml-auto w-full sm:w-auto shadow-md text-center"
                          >
                            ✔ Confirm Receive
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

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
        <div className="flex justify-between items-start border-b border-slate-800 pb-4">
          <div>
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
              Batch No: {req.batch_no || req.req_code || "N/A"} ({req.pcs_requested} Pcs) | Retail Price: Rs. {req.retail_price || 0}
            </span>
            <h2 className="text-lg sm:text-xl font-extrabold text-white">Component Weight Verification Modal</h2>
            <p className="text-xs text-slate-400 mt-1">
              Party: <span className="text-white font-semibold">{req.party_name}</span> | Product:{" "}
              <span className="text-emerald-400 font-semibold">{req.product_name}</span> | Mfg:{" "}
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
                      <td className="p-3 font-bold text-white capitalize">{c.component_type}</td>
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