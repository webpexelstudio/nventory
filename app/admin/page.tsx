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
  code: string;
  created_at?: string;
}

interface Product {
  id: string;
  product_name: string;
  party_id: string;
  created_at?: string;
  parties?: { id: string; name: string; code: string };
}

interface ProductBomView {
  id: string;
  product_id: string;
  component_type: string;
  ml_capacity: number;
  weight_10_pcs_grams: number;
  created_at?: string;
  products?: {
    id: string;
    product_name: string;
    parties?: { id: string; name: string; code: string };
  };
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<
    | "setup"
    | "parties"
    | "products"
    | "assembling"
    | "filling"
    | "warehouse"
    | "inventory"
    | "client_access"
  >("setup");
  const [loading, setLoading] = useState(false);

  const [partiesList, setPartiesList] = useState<Party[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [bomViewList, setBomViewList] = useState<ProductBomView[]>([]);
  const [fillingLogs, setFillingLogs] = useState<any[]>([]);
  const [warehouseLogs, setWarehouseLogs] = useState<any[]>([]);
  const [inventoryList, setInventoryList] = useState<any[]>([]);
  const [partyAccessList, setPartyAccessList] = useState<any[]>([]);

  // Admin View Party Live Portal State
  const [selectedPartyForView, setSelectedPartyForView] = useState("");
  const [partyWarehouseLogs, setPartyWarehouseLogs] = useState<any[]>([]);
  const [partyInventoryStock, setPartyInventoryStock] = useState<any[]>([]);

  // Filling Incharge Form States (100% Dynamic)
  const [fillingPartyId, setFillingPartyId] = useState("");
  const [fillingProductId, setFillingProductId] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [pcsRequested, setPcsRequested] = useState<number>(0);
  const [availableStockMap, setAvailableStockMap] = useState<{ [key: string]: number }>({});
  const [fillingComponents, setFillingComponents] = useState<any[]>([]);

  const [partyName, setPartyName] = useState("");
  const [partyCode, setPartyCode] = useState("");
  const [selectedPartyForProduct, setSelectedPartyForProduct] = useState("");
  const [productName, setProductName] = useState("");
  const [selectedPartyForBom, setSelectedPartyForBom] = useState("");
  const [selectedProductForBom, setSelectedProductForBom] = useState("");

  const [selectedPartyForPortal, setSelectedPartyForPortal] = useState("");
  const [portalUsername, setPortalUsername] = useState("");
  const [portalPin, setPortalPin] = useState("");

  const [componentTypes, setComponentTypes] = useState<string[]>([
    "bottle",
    "cap",
    "seal",
    "inner_plug",
    "sticker_label",
    "carton",
    "tube",
    "pump",
    "nozzle",
  ]);
  const [newTypeName, setNewTypeName] = useState("");
  const [showAddTypeModal, setShowAddTypeModal] = useState(false);

  const [assemblingRows, setAssemblingRows] = useState<any[]>([
    { component_type: "bottle", ml_capacity: "500", weight_10_pcs_grams: "122" },
  ]);

  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingBomItem, setEditingBomItem] = useState<ProductBomView | null>(null);
  const [selectedWeightLog, setSelectedWeightLog] = useState<any | null>(null);

  const [filterPartyName, setFilterPartyName] = useState("");
  const [filterProductName, setFilterProductName] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  useEffect(() => {
    fetchMasterData();
  }, []);

  useEffect(() => {
    if (selectedPartyForView) {
      fetchAdminPartyViewData(selectedPartyForView);
    } else {
      setPartyWarehouseLogs([]);
      setPartyInventoryStock([]);
    }
  }, [selectedPartyForView]);

  // 100% Dynamic Stock & BOM Fetching for Filling Incharge
  useEffect(() => {
    if (fillingPartyId && fillingProductId) {
      fetchAvailableStockAndBom(fillingPartyId, fillingProductId);
    } else {
      setAvailableStockMap({});
      setFillingComponents([]);
    }
  }, [fillingPartyId, fillingProductId]);

  const fetchAvailableStockAndBom = async (partyId: string, productId: string) => {
    try {
      // Fetch dynamic live stock from inventory_summary table for this party and product
      const { data: stockData } = await supabase
        .from("inventory_summary")
        .select("*")
        .eq("party_id", partyId)
        .eq("product_id", productId);

      const stockMap: { [key: string]: number } = {};
      if (stockData && stockData.length > 0) {
        stockData.forEach((item: any) => {
          // Assuming each row or columns store component quantities
          const compType = item.component_type || "bottle";
          stockMap[compType] = item.quantity || item.bottles || item.caps || item.seals || item.boxes || 0;
        });
      }
      setAvailableStockMap(stockMap);

      // Fetch dynamic BOM for this product
      const { data: bomData } = await supabase
        .from("product_bom")
        .select("*")
        .eq("product_id", productId);

      if (bomData && bomData.length > 0) {
        const comps = bomData.map((b: any) => ({
          component_type: b.component_type,
          weight_10_pcs_grams: b.weight_10_pcs_grams || 0,
          pcs_requested: 0,
          theoretical_weight_kg: 0,
        }));
        setFillingComponents(comps);
      } else {
        setFillingComponents([]);
      }
    } catch (err) {
      console.error("Error fetching stock and BOM:", err);
    }
  };

  const handleComponentQtyChange = (index: number, qty: number) => {
    const updated = [...fillingComponents];
    updated[index].pcs_requested = qty;
    const weightPerPc = updated[index].weight_10_pcs_grams / 10;
    updated[index].theoretical_weight_kg = (qty * weightPerPc) / 1000;
    setFillingComponents(updated);
  };

  const handleSaveFillingRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fillingPartyId || !fillingProductId || !batchNo || pcsRequested <= 0) {
      return alert("Please fill all required fields properly.");
    }

    setLoading(true);
    try {
      const selectedPartyObj = partiesList.find(p => p.id === fillingPartyId);
      const selectedProdObj = productsList.find(p => p.id === fillingProductId);

      const payload = {
        batch_no: batchNo,
        party_id: fillingPartyId,
        party_name: selectedPartyObj?.name || "",
        product_id: fillingProductId,
        product_name: selectedProdObj?.product_name || "",
        pcs_requested: pcsRequested,
        components: fillingComponents,
        status: "PENDING",
      };

      const { error } = await supabase.from("filling_requests").insert([payload]);
      if (error) throw error;

      alert("Filling Request Saved Successfully!");
      setBatchNo("");
      setPcsRequested(0);
      setFillingPartyId("");
      setFillingProductId("");
      setFillingComponents([]);
      fetchMasterData();
    } catch (err: any) {
      alert("Error saving filling request: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchMasterData = async () => {
    setLoading(true);
    try {
      const { data: partyData } = await supabase.from("parties").select("*").order("name");
      if (partyData) setPartiesList(partyData);

      const { data: prodData } = await supabase
        .from("products")
        .select("*, parties(id, name, code)")
        .order("product_name");
      if (prodData) setProductsList(prodData as any);

      const { data: bomData } = await supabase
        .from("product_bom")
        .select("*, products(id, product_name, parties(id, name, code))");
      if (bomData) {
        setBomViewList(bomData as any);
        const extractedTypes = Array.from(new Set(bomData.map((item: any) => item.component_type)));
        if (extractedTypes.length > 0) {
          setComponentTypes((prev) => Array.from(new Set([...prev, ...extractedTypes])));
        }
      }

      const { data: fillingData } = await supabase
        .from("filling_requests")
        .select("*, products(product_name, parties(name))")
        .order("created_at", { ascending: false });
      if (fillingData) setFillingLogs(fillingData);

      const { data: whData } = await supabase
        .from("warehouse_logs")
        .select("*, products(product_name), parties(name)")
        .order("created_at", { ascending: false });
      if (whData) setWarehouseLogs(whData);

      const { data: invData } = await supabase
        .from("inventory_summary")
        .select("*, products(product_name), parties(name)");
      if (invData) setInventoryList(invData);

      const { data: accessData } = await supabase
        .from("party_access")
        .select("*, parties(id, name)")
        .order("created_at", { ascending: false });
      if (accessData) setPartyAccessList(accessData);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdminPartyViewData = async (partyId: string) => {
    try {
      const { data: whData } = await supabase
        .from("warehouse_logs")
        .select("*, products(product_name)")
        .eq("party_id", partyId)
        .order("created_at", { ascending: false });
      if (whData) setPartyWarehouseLogs(whData);

      const { data: stockData } = await supabase
        .from("inventory_summary")
        .select("*, products(product_name)")
        .eq("party_id", partyId);
      if (stockData) setPartyInventoryStock(stockData);
    } catch (err) {
      console.error(err);
    }
  };

  const filterByDateAndText = (createdAt?: string, pName?: string, prName?: string) => {
    if (filterPartyName && pName && !pName.toLowerCase().includes(filterPartyName.toLowerCase())) return false;
    if (filterProductName && prName && !prName.toLowerCase().includes(filterProductName.toLowerCase())) return false;
    if (createdAt) {
      const itemDate = new Date(createdAt).toISOString().split("T")[0];
      if (filterStartDate && itemDate < filterStartDate) return false;
      if (filterEndDate && itemDate > filterEndDate) return false;
    }
    return true;
  };

  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName) return alert("Please enter Party Name");
    setLoading(true);
    try {
      const { error } = await supabase
        .from("parties")
        .insert([{ name: partyName, code: partyCode.toUpperCase() || `CODE-${Date.now()}` }]);
      if (error) throw error;
      alert(`Party "${partyName}" Saved Successfully!`);
      setPartyName("");
      setPartyCode("");
      fetchMasterData();
    } catch (err: any) {
      alert("Save Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingParty) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("parties")
        .update({ name: editingParty.name, code: editingParty.code.toUpperCase() })
        .eq("id", editingParty.id);
      if (error) throw error;
      alert("Party Info Updated!");
      setEditingParty(null);
      fetchMasterData();
    } catch (err: any) {
      alert("Update Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteParty = async (partyId: string, partyName: string) => {
    if (!confirm(`Kya aap "${partyName}" ko delete karna chahte hain?`)) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("parties").delete().eq("id", partyId);
      if (error) throw error;
      alert(`Party "${partyName}" Deleted!`);
      fetchMasterData();
    } catch (err: any) {
      alert("Delete Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyForProduct || !productName) {
      return alert("Please select Party and enter Product Name");
    }
    setLoading(true);
    try {
      const { error } = await supabase
        .from("products")
        .insert([{ product_name: productName, party_id: selectedPartyForProduct }]);
      if (error) throw error;
      alert(`Product "${productName}" Saved Successfully!`);
      setProductName("");
      setSelectedPartyForProduct("");
      fetchMasterData();
    } catch (err: any) {
      alert("Save Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("products")
        .update({ product_name: editingProduct.product_name, party_id: editingProduct.party_id })
        .eq("id", editingProduct.id);
      if (error) throw error;
      alert("Product Info Updated!");
      setEditingProduct(null);
      fetchMasterData();
    } catch (err: any) {
      alert("Update Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProduct = async (productId: string, productName: string) => {
    if (!confirm(`Kya aap product "${productName}" ko delete karna chahte hain?`)) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("products").delete().eq("id", productId);
      if (error) throw error;
      alert(`Product "${productName}" Deleted!`);
      fetchMasterData();
    } catch (err: any) {
      alert("Delete Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAssemblingRow = () => {
    setAssemblingRows([
      ...assemblingRows,
      { component_type: componentTypes[0] || "bottle", ml_capacity: "", weight_10_pcs_grams: "" },
    ]);
  };

  const handleRemoveAssemblingRow = (index: number) => {
    const list = [...assemblingRows];
    list.splice(index, 1);
    setAssemblingRows(list);
  };

  const handleRowChange = (index: number, field: string, value: string) => {
    const updated = [...assemblingRows];
    updated[index][field] = value;
    setAssemblingRows(updated);
  };

  const handleAddNewComponentType = () => {
    if (!newTypeName.trim()) return;
    const formatted = newTypeName.trim().toLowerCase().replace(/\s+/g, "_");
    if (!componentTypes.includes(formatted)) {
      setComponentTypes([...componentTypes, formatted]);
    }
    setNewTypeName("");
    setShowAddTypeModal(false);
  };

  const handleDeleteComponentTypeOption = (typeToRemove: string) => {
    if (confirm(`Remove component option "${typeToRemove}"?`)) {
      setComponentTypes(componentTypes.filter((t) => t !== typeToRemove));
    }
  };

  const handleSaveAssemblingRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyForBom || !selectedProductForBom) {
      return alert("Please select Company/Party and Product.");
    }
    setLoading(true);
    try {
      const payload = assemblingRows.map((row) => ({
        product_id: selectedProductForBom,
        component_type: row.component_type,
        ml_capacity: row.ml_capacity ? parseFloat(row.ml_capacity) : 0,
        weight_10_pcs_grams: row.weight_10_pcs_grams ? parseFloat(row.weight_10_pcs_grams) : 0,
      }));

      const { error } = await supabase.from("product_bom").insert(payload);
      if (error) throw error;

      alert("Assembling Setup Record Saved Successfully!");
      setSelectedPartyForBom("");
      setSelectedProductForBom("");
      setAssemblingRows([{ component_type: "bottle", ml_capacity: "500", weight_10_pcs_grams: "122" }]);
      fetchMasterData();
    } catch (err: any) {
      alert("Save Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateBomItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBomItem) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("product_bom")
        .update({
          component_type: editingBomItem.component_type,
          ml_capacity: editingBomItem.ml_capacity,
          weight_10_pcs_grams: editingBomItem.weight_10_pcs_grams,
        })
        .eq("id", editingBomItem.id);
      if (error) throw error;
      alert("Assembling Detail Updated!");
      setEditingBomItem(null);
      fetchMasterData();
    } catch (err: any) {
      alert("Update Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBomItem = async (bomId: string) => {
    if (!confirm("Delete this Assembling Component?")) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("product_bom").delete().eq("id", bomId);
      if (error) throw error;
      alert("Deleted Successfully!");
      fetchMasterData();
    } catch (err: any) {
      alert("Delete Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePartyPortalAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyForPortal || !portalUsername || !portalPin) {
      return alert("Please select Party, Username, and Password PIN.");
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("party_access").insert([
        {
          party_id: selectedPartyForPortal,
          username: portalUsername.trim(),
          access_pin: portalPin.trim(),
          is_active: true,
        },
      ]);

      if (error) throw error;

      alert(`Portal Access Created Successfully in Database for Username: ${portalUsername}`);
      setSelectedPartyForPortal("");
      setPortalUsername("");
      setPortalPin("");
      fetchMasterData();
    } catch (err: any) {
      alert("Error creating portal access: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePortalStatus = async (accessId: string, currentStatus: boolean) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from("party_access")
        .update({ is_active: !currentStatus })
        .eq("id", accessId);

      if (error) throw error;
      fetchMasterData();
    } catch (err: any) {
      alert("Error updating status: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveActualWeightsFromModal = async (updatedComponents: any[]) => {
    if (!selectedWeightLog) return;
    try {
      const { error } = await supabase
        .from("filling_requests")
        .update({ components: updatedComponents })
        .eq("id", selectedWeightLog.id);

      if (error) throw error;
      alert("Actual Dispatched Weights Saved Successfully to Database!");
      fetchMasterData();
    } catch (err: any) {
      alert("Error saving weights: " + err.message);
    }
  };

  const availableProductsForBom = productsList.filter((p) => p.party_id === selectedPartyForBom);
  const availableProductsForFilling = productsList.filter((p) => p.party_id === fillingPartyId);

  const filteredParties = partiesList.filter((p) => filterByDateAndText(p.created_at, p.name));
  const filteredProducts = productsList.filter((prod) =>
    filterByDateAndText(prod.created_at, prod.parties?.name, prod.product_name)
  );
  const filteredBomView = bomViewList.filter((b) =>
    filterByDateAndText(b.created_at, b.products?.parties?.name, b.products?.product_name)
  );
  const filteredFillingLogs = fillingLogs.filter((f) =>
    filterByDateAndText(f.created_at, f.party_name, f.product_name)
  );
  const filteredWarehouseLogs = warehouseLogs.filter((w) =>
    filterByDateAndText(w.created_at, w.parties?.name, w.products?.product_name)
  );
  const filteredInventoryList = inventoryList.filter((i) =>
    filterByDateAndText(i.created_at, i.parties?.name, i.products?.product_name)
  );

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 p-6 font-sans space-y-8">
      {/* Header & Tabs */}
      <div className="border-b border-slate-800 pb-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 max-w-7xl mx-auto">
        <div>
          <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-2">
            ADMIN CENTRAL DASHBOARD <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 font-bold">LIVE REALTIME</span>
          </span>
          <h1 className="text-2xl font-extrabold text-white mt-1">WMS Master & Monitoring Portal</h1>
        </div>

        <div className="flex flex-wrap gap-1.5 bg-[#121827] p-1.5 rounded-xl border border-slate-800 text-xs">
          <button onClick={() => setActiveTab("setup")} className={`px-3 py-2 rounded-lg font-bold transition ${activeTab === "setup" ? "bg-purple-700 text-white" : "text-slate-400 hover:text-white"}`}>+ Add Master</button>
          <button onClick={() => setActiveTab("parties")} className={`px-3 py-2 rounded-lg font-bold transition ${activeTab === "parties" ? "bg-purple-700 text-white" : "text-slate-400 hover:text-white"}`}>Parties ({partiesList.length})</button>
          <button onClick={() => setActiveTab("products")} className={`px-3 py-2 rounded-lg font-bold transition ${activeTab === "products" ? "bg-purple-700 text-white" : "text-slate-400 hover:text-white"}`}>Products ({productsList.length})</button>
          <button onClick={() => setActiveTab("assembling")} className={`px-3 py-2 rounded-lg font-bold transition ${activeTab === "assembling" ? "bg-purple-700 text-white" : "text-slate-400 hover:text-white"}`}>BOM Assembling</button>
          <button onClick={() => setActiveTab("filling")} className={`px-3 py-2 rounded-lg font-bold transition ${activeTab === "filling" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"}`}>Filling Log</button>
          <button onClick={() => setActiveTab("warehouse")} className={`px-3 py-2 rounded-lg font-bold transition ${activeTab === "warehouse" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}>Warehouse IN/OUT</button>
          <button onClick={() => setActiveTab("inventory")} className={`px-3 py-2 rounded-lg font-bold transition ${activeTab === "inventory" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"}`}>Total Inventory</button>
          <button onClick={() => setActiveTab("client_access")} className={`px-3 py-2 rounded-lg font-bold transition ${activeTab === "client_access" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>Client Portal Access</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto space-y-6">
        {activeTab === "setup" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg">
                <h2 className="text-md font-semibold text-slate-200 mb-4 flex items-center gap-2">
                  <span className="bg-purple-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">1</span> Setup Company / Party
                </h2>
                <form onSubmit={handleSaveParty} className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Company / Party Name</label>
                    <input type="text" value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="e.g. Nigehban Healthcare Ltd" className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200" required />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Party Unique Code</label>
                    <input type="text" value={partyCode} onChange={(e) => setPartyCode(e.target.value)} placeholder="E.G. NIGH-01" className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200" />
                  </div>
                  <button type="submit" disabled={loading} className="w-full bg-purple-700 hover:bg-purple-800 text-white font-medium py-2.5 rounded-lg text-sm mt-2">Save Party</button>
                </form>
              </div>

              <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg">
                <h2 className="text-md font-semibold text-slate-200 mb-4 flex items-center gap-2">
                  <span className="bg-emerald-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">2</span> Setup Party Product
                </h2>
                <form onSubmit={handleSaveProduct} className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Select Company / Party</label>
                    <select value={selectedPartyForProduct} onChange={(e) => setSelectedPartyForProduct(e.target.value)} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200" required>
                      <option value="">-- Select Party --</option>
                      {partiesList.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Product Name</label>
                    <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. gel" className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200" required />
                  </div>
                  <button type="submit" disabled={loading} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-medium py-2.5 rounded-lg text-sm mt-2">Save Product</button>
                </form>
              </div>
            </div>

            <form onSubmit={handleSaveAssemblingRecord} className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-md font-semibold text-slate-200 flex items-center gap-2">
                  <span className="bg-amber-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">3</span> Setup Product Assembling & Items (Gram Weight)
                </h2>
                <button type="button" onClick={() => setShowAddTypeModal(true)} className="text-xs bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 px-3 py-2 rounded-lg transition w-fit">+ Add Component Option</button>
              </div>

              <div className="bg-[#0b0f19] p-3 rounded-lg border border-slate-800 space-y-2">
                <span className="text-[11px] text-slate-400 font-semibold uppercase">Available Component Types:</span>
                <div className="flex flex-wrap gap-2">
                  {componentTypes.map((type) => (
                    <span key={type} className="bg-slate-800 text-amber-300 border border-slate-700 px-2.5 py-1 rounded-md text-xs flex items-center gap-2 capitalize">
                      {type.replace("_", " ")}
                      <button type="button" onClick={() => handleDeleteComponentTypeOption(type)} className="text-rose-400 hover:text-rose-200 font-bold ml-1">×</button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Select Company / Party</label>
                  <select value={selectedPartyForBom} onChange={(e) => { setSelectedPartyForBom(e.target.value); setSelectedProductForBom(""); }} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200" required>
                    <option value="">-- Select Party --</option>
                    {partiesList.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Select Product</label>
                  <select value={selectedProductForBom} onChange={(e) => setSelectedProductForBom(e.target.value)} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200" required disabled={!selectedPartyForBom}>
                    <option value="">-- Select Product --</option>
                    {availableProductsForBom.map((prod) => (<option key={prod.id} value={prod.id}>{prod.product_name}</option>))}
                  </select>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2">
                <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">ASSEMBLING COMPONENTS BREAKDOWN:</span>
                <button type="button" onClick={handleAddAssemblingRow} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg">+ Add Row</button>
              </div>

              <div className="space-y-3">
                {assemblingRows.map((row, index) => (
                  <div key={index} className="flex flex-col sm:flex-row items-center gap-3 bg-[#0b0f19] p-3 rounded-lg border border-slate-800 relative">
                    <button type="button" onClick={() => handleRemoveAssemblingRow(index)} className="absolute -top-2 -right-2 bg-rose-600 text-white w-6 h-6 rounded-full text-xs font-bold">✕</button>
                    <div className="flex-1 w-full">
                      <label className="block text-[10px] text-slate-500 mb-1">Component Type</label>
                      <select value={row.component_type} onChange={(e) => handleRowChange(index, "component_type", e.target.value)} className="w-full bg-[#121827] border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 capitalize" required>
                        {componentTypes.map((t) => (<option key={t} value={t}>{t.replace("_", " ")}</option>))}
                      </select>
                    </div>
                    <div className="flex-1 w-full">
                      <label className="block text-[10px] text-slate-500 mb-1">Fill Capacity (ML)</label>
                      <input type="number" step="0.01" value={row.ml_capacity} onChange={(e) => handleRowChange(index, "ml_capacity", e.target.value)} placeholder="e.g. 500" className="w-full bg-[#121827] border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200" />
                    </div>
                    <div className="flex-1 w-full">
                      <label className="block text-[10px] text-slate-500 mb-1">Weight for 10 Pcs (Grams)</label>
                      <input type="number" step="0.01" value={row.weight_10_pcs_grams} onChange={(e) => handleRowChange(index, "weight_10_pcs_grams", e.target.value)} placeholder="e.g. 122" className="w-full bg-[#121827] border border-amber-500/50 rounded-lg px-2 py-1.5 text-xs text-amber-400 font-mono" required />
                    </div>
                  </div>
                ))}
              </div>

              <button type="submit" disabled={loading} className="w-full bg-amber-600 hover:bg-amber-700 text-white font-medium py-3 rounded-lg text-sm shadow-lg mt-2">Save Assembling Setup</button>
            </form>
          </div>
        )}

        {activeTab === "parties" && (
          <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <h2 className="text-md font-semibold text-slate-200">Registered Parties</h2>
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] text-slate-400 uppercase sticky top-0">
                  <tr><th className="p-3">Code</th><th className="p-3">Name</th><th className="p-3 text-right">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredParties.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-800/50">
                      <td className="p-3 font-mono text-purple-400">{p.code}</td>
                      <td className="p-3 font-bold text-slate-200">{p.name}</td>
                      <td className="p-3 text-right">
                        <button onClick={() => setEditingParty(p)} className="text-blue-400 mr-3 px-2 py-1 bg-blue-900/30 rounded">Edit</button>
                        <button onClick={() => handleDeleteParty(p.id, p.name)} className="text-rose-400 px-2 py-1 bg-rose-900/30 rounded">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "products" && (
          <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <h2 className="text-md font-semibold text-slate-200">Registered Products</h2>
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] text-slate-400 uppercase sticky top-0">
                  <tr><th className="p-3">Party</th><th className="p-3">Product Name</th><th className="p-3 text-right">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredProducts.map((prod) => (
                    <tr key={prod.id} className="hover:bg-slate-800/50">
                      <td className="p-3 font-bold text-emerald-400">{prod.parties?.name}</td>
                      <td className="p-3 font-bold text-slate-200">{prod.product_name}</td>
                      <td className="p-3 text-right">
                        <button onClick={() => setEditingProduct(prod)} className="text-blue-400 mr-3 px-2 py-1 bg-blue-900/30 rounded">Edit</button>
                        <button onClick={() => handleDeleteProduct(prod.id, prod.product_name)} className="text-rose-400 px-2 py-1 bg-rose-900/30 rounded">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "assembling" && (
          <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <h2 className="text-md font-semibold text-slate-200">Products Assembling Detail (Live BOM)</h2>
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] text-slate-400 uppercase sticky top-0">
                  <tr><th className="p-3">Party</th><th className="p-3">Product</th><th className="p-3 text-amber-400">Component</th><th className="p-3">Capacity</th><th className="p-3 text-amber-400">Weight</th><th className="p-3 text-right">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredBomView.map((bom) => (
                    <tr key={bom.id} className="hover:bg-slate-800/50">
                      <td className="p-3 font-semibold text-emerald-400">{bom.products?.parties?.name}</td>
                      <td className="p-3 font-semibold text-slate-200">{bom.products?.product_name}</td>
                      <td className="p-3 capitalize font-bold text-amber-400">{bom.component_type.replace("_", " ")}</td>
                      <td className="p-3 font-mono">{bom.ml_capacity ? `${bom.ml_capacity} ml` : "-"}</td>
                      <td className="p-3 font-mono font-bold text-amber-300">{bom.weight_10_pcs_grams} g</td>
                      <td className="p-3 text-right">
                        <button onClick={() => setEditingBomItem(bom)} className="text-blue-400 mr-3 px-2 py-1 bg-blue-900/30 rounded">Edit</button>
                        <button onClick={() => handleDeleteBomItem(bom.id)} className="text-rose-400 px-2 py-1 bg-rose-900/30 rounded">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "filling" && (
          <div className="space-y-6">
            {/* Filling Incharge Entry Form with 100% Dynamic Available Stock */}
            <form onSubmit={handleSaveFillingRequest} className="bg-[#121827] border border-slate-800 p-6 rounded-xl shadow-lg space-y-4">
              <h2 className="text-md font-semibold text-amber-400 uppercase">Filling Incharge — New Batch Request</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Select Party / Company</label>
                  <select value={fillingPartyId} onChange={(e) => { setFillingPartyId(e.target.value); setFillingProductId(""); }} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" required>
                    <option value="">-- Select Party --</option>
                    {partiesList.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Select Product</label>
                  <select value={fillingProductId} onChange={(e) => setFillingProductId(e.target.value)} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" required disabled={!fillingPartyId}>
                    <option value="">-- Select Product --</option>
                    {availableProductsForFilling.map(prod => (<option key={prod.id} value={prod.id}>{prod.product_name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Batch No & Total Pcs</label>
                  <div className="flex gap-2">
                    <input type="text" placeholder="Batch No" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} className="w-1/2 bg-[#0b0f19] border border-slate-800 rounded-lg px-2 py-2 text-xs text-white uppercase font-mono" required />
                    <input type="number" placeholder="Total Pcs" value={pcsRequested || ""} onChange={(e) => setPcsRequested(Number(e.target.value))} className="w-1/2 bg-[#0b0f19] border border-slate-800 rounded-lg px-2 py-2 text-xs text-amber-300 font-mono" required />
                  </div>
                </div>
              </div>

              {/* 100% Dynamic Components & Live Stock View */}
              {fillingComponents.length > 0 && (
                <div className="space-y-2 pt-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase">Components Breakdown & Live Available Stock:</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {fillingComponents.map((comp, index) => {
                      const liveStock = availableStockMap[comp.component_type] || 0;
                      return (
                        <div key={index} className="flex items-center justify-between bg-[#0b0f19] p-3 rounded-lg border border-slate-800">
                          <div>
                            <span className="text-xs font-bold text-slate-200 capitalize">{comp.component_type.replace("_", " ")}</span>
                            <span className="text-[10px] text-slate-400 block mt-0.5">
                              Available Stock: <strong className="text-emerald-400 font-mono">{liveStock} Pcs</strong>
                            </span>
                          </div>
                          <div>
                            <input
                              type="number"
                              placeholder="Required Pcs"
                              value={comp.pcs_requested || ""}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                if (val > liveStock) {
                                  alert(`Warning: Requested quantity (${val}) exceeds available stock (${liveStock})!`);
                                }
                                handleComponentQtyChange(index, val);
                              }}
                              className="bg-[#121827] border border-slate-700 rounded p-1.5 text-xs text-amber-300 font-mono w-28"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <button type="submit" disabled={loading} className="w-full bg-amber-600 hover:bg-amber-700 text-white font-medium py-2.5 rounded-lg text-xs shadow-lg mt-2">Submit Filling Request</button>
            </form>

            <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
              <h2 className="text-md font-semibold text-slate-200">Filling Logs & Batch Verification (Live Database)</h2>
              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-[#0b0f19] text-slate-400 uppercase sticky top-0">
                    <tr><th className="p-3">Batch No</th><th className="p-3">Party</th><th className="p-3">Product</th><th className="p-3 text-center">Req. Pcs</th><th className="p-3 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredFillingLogs.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-800/50">
                        <td className="p-3 font-mono font-bold text-purple-400">{req.batch_no}</td>
                        <td className="p-3 font-bold">{req.party_name}</td>
                        <td className="p-3 text-emerald-400">{req.product_name}</td>
                        <td className="p-3 text-center font-mono text-amber-300">{req.pcs_requested}</td>
                        <td className="p-3 text-right"><button onClick={() => setSelectedWeightLog(req)} className="bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white px-3 py-1 rounded">View Detail</button></td>
                      </tr>
                    ))}
                    {filteredFillingLogs.length === 0 && (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-500">No live filling logs found in database.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "warehouse" && (
          <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <h2 className="text-md font-semibold text-slate-200">Warehouse Register (Live Database)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] text-slate-400 uppercase">
                  <tr><th className="p-3">Type</th><th className="p-3">Party</th><th className="p-3">Product</th><th className="p-3">Component</th><th className="p-3">Quantity</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredWarehouseLogs.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-800/50">
                      <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${w.type === "IN" ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}`}>{w.type}</span></td>
                      <td className="p-3 font-semibold">{w.parties?.name || w.party_name}</td>
                      <td className="p-3 text-emerald-400">{w.products?.product_name || w.product_name}</td>
                      <td className="p-3 capitalize">{w.component_type}</td>
                      <td className="p-3 font-mono font-bold text-amber-300">{w.quantity}</td>
                    </tr>
                  ))}
                  {filteredWarehouseLogs.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-500">No live warehouse logs found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "inventory" && (
          <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl space-y-4">
            <h2 className="text-md font-semibold text-white">Master Inventory Stock Balance (Live Database)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] text-slate-400 uppercase">
                  <tr><th className="p-3">Party</th><th className="p-3">Product</th><th className="p-3">Bottles</th><th className="p-3">Caps</th><th className="p-3">Seals</th><th className="p-3">Boxes</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredInventoryList.map((inv, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/50">
                      <td className="p-3 font-semibold">{inv.parties?.name || inv.party_name}</td>
                      <td className="p-3 text-emerald-400">{inv.products?.product_name || inv.product_name}</td>
                      <td className="p-3 font-mono">{inv.bottles || 0}</td>
                      <td className="p-3 font-mono">{inv.caps || 0}</td>
                      <td className="p-3 font-mono">{inv.seals || 0}</td>
                      <td className="p-3 font-mono text-amber-300">{inv.boxes || 0}</td>
                    </tr>
                  ))}
                  {filteredInventoryList.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-slate-500">No live inventory records found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "client_access" && (
          <div className="space-y-6">
            <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl shadow-lg">
              <h2 className="text-md font-semibold text-white mb-4">Generate & Assign Portal Access to Party</h2>
              <form onSubmit={handleCreatePartyPortalAccess} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Select Party</label>
                  <select value={selectedPartyForPortal} onChange={(e) => setSelectedPartyForPortal(e.target.value)} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200" required>
                    <option value="">-- Select Party --</option>
                    {partiesList.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.code})</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Login Username</label>
                  <input type="text" value={portalUsername} onChange={(e) => setPortalUsername(e.target.value)} placeholder="e.g. magitech_user" className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200" required />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Secret Password PIN</label>
                  <input type="text" value={portalPin} onChange={(e) => setPortalPin(e.target.value)} placeholder="e.g. 123456" className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono" required />
                </div>
                <button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg text-xs">Create Portal Access</button>
              </form>
            </div>

            {/* ADMIN VIEW PARTY LIVE PORTAL SECTION */}
            <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl shadow-lg space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <h3 className="text-sm font-semibold text-emerald-400 uppercase">🔍 Admin View: Live Party Portal Dashboard (IN/OUT & Stock)</h3>
                <div className="w-full sm:w-72">
                  <select
                    value={selectedPartyForView}
                    onChange={(e) => setSelectedPartyForView(e.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <option value="">-- Select Party to Inspect Live --</option>
                    {partiesList.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedPartyForView ? (
                <div className="space-y-6 pt-2">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 uppercase mb-2">Live Stock Balance for Selected Party</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead className="bg-[#0b0f19] text-slate-400 uppercase">
                          <tr><th className="p-2.5">Product Name</th><th className="p-2.5">Bottles</th><th className="p-2.5">Caps</th><th className="p-2.5">Seals</th><th className="p-2.5">Boxes</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {partyInventoryStock.length > 0 ? (
                            partyInventoryStock.map((inv: any, i: number) => (
                              <tr key={i}>
                                <td className="p-2.5 font-bold text-emerald-400">{inv.products?.product_name || inv.product_name}</td>
                                <td className="p-2.5 font-mono">{inv.bottles || 0}</td>
                                <td className="p-2.5 font-mono">{inv.caps || 0}</td>
                                <td className="p-2.5 font-mono">{inv.seals || 0}</td>
                                <td className="p-2.5 font-mono text-amber-300">{inv.boxes || 0}</td>
                              </tr>
                            ))
                          ) : (
                            <tr><td colSpan={5} className="p-4 text-center text-slate-500">No stock found for this party.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 uppercase mb-2">Live Warehouse IN/OUT History</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead className="bg-[#0b0f19] text-slate-400 uppercase">
                          <tr><th className="p-2.5">Type</th><th className="p-2.5">Product</th><th className="p-2.5">Component</th><th className="p-2.5">Quantity</th><th className="p-2.5">Date</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {partyWarehouseLogs.length > 0 ? (
                            partyWarehouseLogs.map((w: any) => (
                              <tr key={w.id}>
                                <td className="p-2.5"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${w.type === "IN" ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}`}>{w.type}</span></td>
                                <td className="p-2.5 text-emerald-400">{w.products?.product_name}</td>
                                <td className="p-2.5 capitalize">{w.component_type}</td>
                                <td className="p-2.5 font-mono font-bold text-amber-300">{w.quantity} Pcs</td>
                                <td className="p-2.5 text-slate-400">{new Date(w.created_at || w.timestamp).toLocaleString()}</td>
                              </tr>
                            ))
                          ) : (
                            <tr><td colSpan={5} className="p-4 text-center text-slate-500">No warehouse logs found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-slate-500 text-xs">Upar diye gaye dropdown se koi party select karein taake uska live stock aur warehouse data yahan show ho sake.</div>
              )}
            </div>

            <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl shadow-lg space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">Active Party Portal Credentials</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-[#0b0f19] text-slate-400 uppercase">
                    <tr><th className="p-3">Party Name</th><th className="p-3">Username</th><th className="p-3">PIN</th><th className="p-3">Status</th><th className="p-3 text-right">Toggle</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {partyAccessList.map((acc) => (
                      <tr key={acc.id} className="hover:bg-slate-800/50">
                        <td className="p-3 font-bold text-white">{acc.parties?.name || acc.party_name}</td>
                        <td className="p-3 font-mono text-indigo-400">{acc.username}</td>
                        <td className="p-3 font-mono text-amber-300">{acc.access_pin}</td>
                        <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${acc.is_active ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}`}>{acc.is_active ? "ACTIVE" : "DISABLED"}</span></td>
                        <td className="p-3 text-right">
                          <button onClick={() => handleTogglePortalStatus(acc.id, acc.is_active)} className={`px-3 py-1 rounded text-xs font-semibold ${acc.is_active ? "bg-rose-900/30 text-rose-400" : "bg-emerald-900/30 text-emerald-400"}`}>
                            {acc.is_active ? "Disable" : "Enable"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedWeightLog && (
        <WeightModal isOpen={!!selectedWeightLog} onClose={() => setSelectedWeightLog(null)} log={selectedWeightLog} onSave={handleSaveActualWeightsFromModal} />
      )}

      {showAddTypeModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl w-full max-w-md space-y-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100">Add New Component Type Option</h3>
            <input type="text" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="e.g. outer_carton" className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200" />
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowAddTypeModal(false)} className="px-4 py-1.5 text-xs bg-slate-800 text-slate-300 rounded-lg">Cancel</button>
              <button type="button" onClick={handleAddNewComponentType} className="px-4 py-1.5 text-xs bg-amber-600 text-white rounded-lg font-medium">Add Option</button>
            </div>
          </div>
        </div>
      )}

      {editingParty && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleUpdateParty} className="bg-[#121827] border border-slate-800 p-6 rounded-2xl space-y-4 w-full max-w-md">
            <h3 className="text-lg font-bold text-white">Edit Party</h3>
            <input type="text" value={editingParty.name} onChange={(e) => setEditingParty({ ...editingParty, name: e.target.value })} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white" required />
            <input type="text" value={editingParty.code} onChange={(e) => setEditingParty({ ...editingParty, code: e.target.value })} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white uppercase font-mono" required />
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setEditingParty(null)} className="w-1/2 bg-slate-800 py-2 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" className="w-1/2 bg-purple-700 py-2 rounded-xl text-xs font-bold">Update</button>
            </div>
          </form>
        </div>
      )}

      {editingProduct && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleUpdateProduct} className="bg-[#121827] border border-slate-800 p-6 rounded-2xl space-y-4 w-full max-w-md">
            <h3 className="text-lg font-bold text-white">Edit Product</h3>
            <select value={editingProduct.party_id} onChange={(e) => setEditingProduct({ ...editingProduct, party_id: e.target.value })} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white" required>
              {partiesList.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.code})</option>))}
            </select>
            <input type="text" value={editingProduct.product_name} onChange={(e) => setEditingProduct({ ...editingProduct, product_name: e.target.value })} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white" required />
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setEditingProduct(null)} className="w-1/2 bg-slate-800 py-2 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" className="w-1/2 bg-emerald-700 py-2 rounded-xl text-xs font-bold">Update</button>
            </div>
          </form>
        </div>
      )}

      {editingBomItem && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <form onSubmit={handleUpdateBomItem} className="bg-[#121827] border border-slate-800 p-6 rounded-2xl space-y-4 w-full max-w-md">
            <h3 className="text-lg font-bold text-white">Edit Assembling Component</h3>
            <select value={editingBomItem.component_type} onChange={(e) => setEditingBomItem({ ...editingBomItem, component_type: e.target.value })} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white capitalize" required>
              {componentTypes.map((type) => (<option key={type} value={type}>{type.replace("_", " ")}</option>))}
            </select>
            <input type="number" value={editingBomItem.ml_capacity} onChange={(e) => setEditingBomItem({ ...editingBomItem, ml_capacity: Number(e.target.value) })} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white" placeholder="ML Capacity" />
            <input type="number" value={editingBomItem.weight_10_pcs_grams} onChange={(e) => setEditingBomItem({ ...editingBomItem, weight_10_pcs_grams: Number(e.target.value) })} className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-amber-300 font-mono" placeholder="Weight for 10 Pcs" />
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => setEditingBomItem(null)} className="w-1/2 bg-slate-800 py-2 rounded-xl text-xs font-bold">Cancel</button>
              <button type="submit" className="w-1/2 bg-amber-600 py-2 rounded-xl text-xs font-bold">Update</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function WeightModal({ isOpen, onClose, log, onSave }: { isOpen: boolean; onClose: () => void; log: any; onSave: (updatedComponents: any[]) => void; }) {
  const [actualWeights, setActualWeights] = useState<{ [key: string]: number }>(() => {
    const initial: { [key: string]: number } = {};
    (log.components || []).forEach((c: any) => { initial[c.component_type] = c.actual_issued_weight_kg || 0; });
    return initial;
  });

  if (!isOpen) return null;

  const handleInputChange = (compType: string, val: string) => {
    setActualWeights({ ...actualWeights, [compType]: parseFloat(val) || 0 });
  };

  const handleSaveModal = () => {
    const updated = (log.components || []).map((c: any) => ({ ...c, actual_issued_weight_kg: actualWeights[c.component_type] || 0 }));
    onSave(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 text-slate-100">
      <div className="bg-[#121827] border border-slate-800 rounded-2xl w-full max-w-3xl p-6 space-y-6 shadow-2xl">
        <div className="flex justify-between items-start border-b border-slate-800 pb-4">
          <div><span className="text-[10px] font-bold text-amber-400 uppercase">Batch No: {log.batch_no}</span><h2 className="text-xl font-extrabold text-white">Filling vs Warehouse Weight Detail</h2></div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-lg">✕</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-[#0b0f19] text-slate-400 uppercase">
              <tr><th className="p-3">Component</th><th className="p-3">10 Pcs Grams</th><th className="p-3 text-indigo-400">Req. Weight (Kg)</th><th className="p-3 text-amber-400">Dispatched Weight (Kg)</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {(log.components || []).map((c: any, idx: number) => (
                <tr key={idx}>
                  <td className="p-3 font-bold capitalize">{c.component_type}</td>
                  <td className="p-3 font-mono">{c.weight_10_pcs_grams}g</td>
                  <td className="p-3 font-mono text-indigo-300">{c.theoretical_weight_kg ? c.theoretical_weight_kg.toFixed(2) : "0.00"} Kg</td>
                  <td className="p-3"><input type="number" step="0.01" value={actualWeights[c.component_type] || ""} onChange={(e) => handleInputChange(c.component_type, e.target.value)} className="bg-[#0b0f19] border border-slate-700 rounded px-2 py-1 text-xs text-amber-300 font-mono w-28" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 bg-slate-800 rounded-xl text-xs font-semibold">Close</button>
          <button onClick={handleSaveModal} className="px-5 py-2 bg-amber-600 rounded-xl text-xs font-bold text-white">Save Dispatched Weight</button>
        </div>
      </div>
    </div>
  );
}