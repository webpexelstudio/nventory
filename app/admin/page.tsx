"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Company Details for PDF Export Header
const COMPANY_DETAILS = {
  name: "WEB PEXEL STUDIO / NIGEHBAN HEALTHCARE",
  address: "Gulistan-e-Johar, Karachi, Pakistan",
  contact: "Ph: +92 315 0274582 | Email: rizwanmadni517@gmail.com",
  logoPath: "/logo.png",
};

// Interfaces
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

interface ComponentWeightItem {
  component_type: string;
  pcs_requested: number;
  weight_10_pcs_grams: number;
  theoretical_weight_kg: number;
  actual_issued_weight_kg?: number;
}

interface FillingRequestLog {
  id: string;
  batch_no: string;
  party_name: string;
  product_name: string;
  pcs_requested: number;
  mfg_date?: string;
  exp_date?: string;
  retail_price?: number;
  requested_at: string;
  issued_at?: string;
  accepted_at?: string;
  status: "PENDING" | "ISSUED" | "ACCEPTED";
  created_at?: string;
  components: ComponentWeightItem[];
}

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

// Party Portal Access Management Interface
interface PartyPortalAccess {
  id: string;
  party_id: string;
  party_name: string;
  username: string;
  access_pin: string;
  is_active: boolean;
  created_at?: string;
}

interface AssemblingRow {
  component_type: string;
  ml_capacity: string;
  weight_10_pcs_grams: string;
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

  // Lists State
  const [partiesList, setPartiesList] = useState<Party[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [bomViewList, setBomViewList] = useState<ProductBomView[]>([]);
  const [fillingLogs, setFillingLogs] = useState<FillingRequestLog[]>([]);
  const [warehouseLogs, setWarehouseLogs] = useState<WarehouseLog[]>([]);
  const [inventoryList, setInventoryList] = useState<InventorySummary[]>([]);
  const [partyAccessList, setPartyAccessList] = useState<PartyPortalAccess[]>([]);

  // Setup Form State
  const [partyName, setPartyName] = useState("");
  const [partyCode, setPartyCode] = useState("");
  const [selectedPartyForProduct, setSelectedPartyForProduct] = useState("");
  const [productName, setProductName] = useState("");
  const [selectedPartyForBom, setSelectedPartyForBom] = useState("");
  const [selectedProductForBom, setSelectedProductForBom] = useState("");

  // Client Portal Form State
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

  const [assemblingRows, setAssemblingRows] = useState<AssemblingRow[]>([
    { component_type: "bottle", ml_capacity: "500", weight_10_pcs_grams: "122" },
  ]);

  // Edit Modals
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingBomItem, setEditingBomItem] = useState<ProductBomView | null>(null);

  // Weight Breakdown Pop-up Modal State
  const [selectedWeightLog, setSelectedWeightLog] = useState<FillingRequestLog | null>(null);

  // Filters for ALL Tabs
  const [filterPartyName, setFilterPartyName] = useState("");
  const [filterProductName, setFilterProductName] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  useEffect(() => {
    fetchMasterData();

    // SUPABASE REALTIME LISTENER FOR LIVE UPDATES
    const channel = supabase
      .channel("filling_realtime_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "filling_requests" },
        (payload) => {
          console.log("Live Realtime Update Received:", payload);
          fetchMasterData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchMasterData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Parties
      const { data: partyData } = await supabase.from("parties").select("*").order("name");
      if (partyData) setPartiesList(partyData);

      // 2. Fetch Products
      const { data: prodData } = await supabase
        .from("products")
        .select("*, parties(id, name, code)")
        .order("product_name");
      if (prodData) setProductsList(prodData as any);

      // 3. Fetch BOM Details
      const { data: bomData } = await supabase
        .from("product_bom")
        .select("*, products(id, product_name, parties(id, name, code))");
      if (bomData) setBomViewList(bomData as any);

      // Demo/Initial Data for Filling Logs
      setFillingLogs([
        {
          id: "1",
          batch_no: "BATCH-2026-001",
          party_name: "Dermsol",
          product_name: "Serum 30ml",
          pcs_requested: 333,
          mfg_date: "2026-10-01",
          exp_date: "2028-09-30",
          retail_price: 1250,
          requested_at: "2026-10-04 10:00 AM",
          issued_at: "2026-10-04 11:30 AM",
          accepted_at: "2026-10-04 12:15 PM",
          status: "ACCEPTED",
          created_at: "2026-10-04",
          components: [
            {
              component_type: "bottle",
              pcs_requested: 333,
              weight_10_pcs_grams: 122,
              theoretical_weight_kg: (333 * 12.2) / 1000,
              actual_issued_weight_kg: 4.5,
            },
            {
              component_type: "cap",
              pcs_requested: 333,
              weight_10_pcs_grams: 45,
              theoretical_weight_kg: (333 * 4.5) / 1000,
              actual_issued_weight_kg: 1.6,
            },
          ],
        },
      ]);

      // Demo Data for Warehouse Logs
      setWarehouseLogs([
        {
          id: "w1",
          type: "IN",
          party_name: "Magitech",
          product_name: "Cream 50g",
          component_type: "Bottle",
          quantity: 5000,
          timestamp: "2026-10-03 04:00 PM",
          created_at: "2026-10-03",
        },
        {
          id: "w2",
          type: "OUT",
          party_name: "Magitech",
          product_name: "Cream 50g",
          component_type: "Bottle",
          quantity: 1000,
          timestamp: "2026-10-04 11:30 AM",
          created_at: "2026-10-04",
        },
      ]);

      // Demo Data for Inventory
      setInventoryList([
        {
          party_name: "Magitech",
          product_name: "Cream 50g",
          bottles: 4000,
          caps: 4500,
          seals: 4800,
          boxes: 200,
          created_at: "2026-10-04",
        },
        {
          party_name: "Dermsol",
          product_name: "Serum 30ml",
          bottles: 3000,
          caps: 3200,
          seals: 3500,
          boxes: 150,
          created_at: "2026-10-04",
        },
      ]);

      // Demo Data for Party Client Portal Access
      setPartyAccessList([
        {
          id: "acc-1",
          party_id: "p-magitech",
          party_name: "Magitech",
          username: "magitech_user",
          access_pin: "123456",
          is_active: true,
          created_at: "2026-10-01",
        },
      ]);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // EXPORT UTILITIES WITH LOGO & BRANDING
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
      console.warn("Logo load failed, rendering text header instead.");
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
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated Date: ${new Date().toLocaleString()}`, 14, 51);

    autoTable(doc, {
      startY: 56,
      head: [headers],
      body: body,
      theme: "grid",
      headStyles: { fillColor: [79, 70, 229] },
      styles: { fontSize: 8 },
    });

    doc.save(`${title.toLowerCase().replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`);
  };

  // Filter Logic
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

  // 1. PARTY ACTIONS
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

  // 2. PRODUCT ACTIONS
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
        .update({
          product_name: editingProduct.product_name,
          party_id: editingProduct.party_id,
        })
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

  // 3. ASSEMBLING (BOM) ACTIONS
  const handleAddAssemblingRow = () => {
    setAssemblingRows([
      ...assemblingRows,
      {
        component_type: componentTypes[0] || "bottle",
        ml_capacity: "",
        weight_10_pcs_grams: "",
      },
    ]);
  };

  const handleRemoveAssemblingRow = (index: number) => {
    const list = [...assemblingRows];
    list.splice(index, 1);
    setAssemblingRows(list);
  };

  const handleRowChange = (index: number, field: keyof AssemblingRow, value: string) => {
    const updated = [...assemblingRows];
    updated[index][field] = value;
    setAssemblingRows(updated);
  };

  const handleAddNewComponentType = () => {
    if (!newTypeName.trim()) return;
    const formatted = newTypeName.trim().toLowerCase();
    if (!componentTypes.includes(formatted)) {
      setComponentTypes([...componentTypes, formatted]);
    }
    setNewTypeName("");
    setShowAddTypeModal(false);
  };

  const handleSaveAssemblingRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyForBom || !selectedProductForBom) {
      return alert("Please select Company/Party and Product.");
    }

    setLoading(true);
    try {
      await supabase.from("product_bom").delete().eq("product_id", selectedProductForBom);

      const payload = assemblingRows.map((row) => {
        const weight10Pcs = row.weight_10_pcs_grams ? parseFloat(row.weight_10_pcs_grams) : 0;
        return {
          product_id: selectedProductForBom,
          component_type: row.component_type,
          ml_capacity: row.ml_capacity ? parseFloat(row.ml_capacity) : 0,
          weight_10_pcs_grams: weight10Pcs,
          sample_weight_grams: weight10Pcs,
          per_piece_grams: weight10Pcs > 0 ? weight10Pcs / 10 : 0,
        };
      });

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
          sample_weight_grams: editingBomItem.weight_10_pcs_grams,
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
    if (!confirm("Kya aap is Assembling Component ko delete karna chahte hain?")) return;

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

  // 4. CREATE PARTY PORTAL ACCESS
  const handleCreatePartyPortalAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyForPortal || !portalUsername || !portalPin) {
      return alert("Please select Party, Username, and Password PIN.");
    }

    const partyObj = partiesList.find((p) => p.id === selectedPartyForPortal);
    const newAccess: PartyPortalAccess = {
      id: `acc-${Date.now()}`,
      party_id: selectedPartyForPortal,
      party_name: partyObj ? partyObj.name : "Unknown Party",
      username: portalUsername,
      access_pin: portalPin,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    setPartyAccessList([...partyAccessList, newAccess]);
    alert(`Portal Access Created Successfully for "${partyObj?.name}"! Username: ${portalUsername}`);
    setSelectedPartyForPortal("");
    setPortalUsername("");
    setPortalPin("");
  };

  const handleTogglePortalStatus = (accessId: string) => {
    setPartyAccessList(
      partyAccessList.map((item) => {
        if (item.id === accessId) {
          return { ...item, is_active: !item.is_active };
        }
        return item;
      })
    );
  };

  const handleSaveActualWeightsFromModal = (updatedComponents: ComponentWeightItem[]) => {
    if (!selectedWeightLog) return;
    const updatedLogs = fillingLogs.map((log) => {
      if (log.id === selectedWeightLog.id) {
        return { ...log, components: updatedComponents };
      }
      return log;
    });
    setFillingLogs(updatedLogs);
    alert("Actual Dispatched Weights Saved Successfully!");
  };

  const availableProductsForBom = productsList.filter((p) => p.party_id === selectedPartyForBom);

  // Filtered Lists for ALL TABS
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
    filterByDateAndText(w.created_at, w.party_name, w.product_name)
  );
  const filteredInventoryList = inventoryList.filter((i) =>
    filterByDateAndText(i.created_at, i.party_name, i.product_name)
  );

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 p-6 font-sans space-y-8">
      {/* Top Header & Tab Navigation */}
      <div className="border-b border-slate-800 pb-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 max-w-7xl mx-auto">
        <div>
          <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-2">
            ADMIN CENTRAL DASHBOARD <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/40 font-bold">LIVE REALTIME</span>
          </span>
          <h1 className="text-2xl font-extrabold text-white mt-1">WMS Master & Monitoring Portal</h1>
        </div>

        <div className="flex flex-wrap gap-1.5 bg-[#121827] p-1.5 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab("setup")}
            className={`px-3 py-2 rounded-lg font-bold transition ${
              activeTab === "setup" ? "bg-purple-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            + Add Master
          </button>
          <button
            onClick={() => setActiveTab("parties")}
            className={`px-3 py-2 rounded-lg font-bold transition ${
              activeTab === "parties" ? "bg-purple-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Parties ({partiesList.length})
          </button>
          <button
            onClick={() => setActiveTab("products")}
            className={`px-3 py-2 rounded-lg font-bold transition ${
              activeTab === "products" ? "bg-purple-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Products ({productsList.length})
          </button>
          <button
            onClick={() => setActiveTab("assembling")}
            className={`px-3 py-2 rounded-lg font-bold transition ${
              activeTab === "assembling" ? "bg-purple-700 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            BOM Assembling
          </button>
          <button
            onClick={() => setActiveTab("filling")}
            className={`px-3 py-2 rounded-lg font-bold transition ${
              activeTab === "filling" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Filling Log
          </button>
          <button
            onClick={() => setActiveTab("warehouse")}
            className={`px-3 py-2 rounded-lg font-bold transition ${
              activeTab === "warehouse" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Warehouse IN/OUT
          </button>
          <button
            onClick={() => setActiveTab("inventory")}
            className={`px-3 py-2 rounded-lg font-bold transition ${
              activeTab === "inventory" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Total Inventory
          </button>
          <button
            onClick={() => setActiveTab("client_access")}
            className={`px-3 py-2 rounded-lg font-bold transition ${
              activeTab === "client_access" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Client Portal Access
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto space-y-6">
        {/* GLOBAL FILTER BAR FOR ALL TABS */}
        {activeTab !== "setup" && activeTab !== "client_access" && (
          <div className="bg-[#121827] border border-slate-800 p-4 rounded-xl grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Filter by Party Name</label>
              <input
                type="text"
                placeholder="Search Party..."
                value={filterPartyName}
                onChange={(e) => setFilterPartyName(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Filter by Product Name</label>
              <input
                type="text"
                placeholder="Search Product..."
                value={filterProductName}
                onChange={(e) => setFilterProductName(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">From Date</label>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">To Date</label>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
        )}

        {/* TAB 1: ADD SETUP FORM */}
        {activeTab === "setup" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 1. Setup Company / Party */}
              <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg">
                <h2 className="text-md font-semibold text-slate-200 mb-4 flex items-center gap-2">
                  <span className="bg-purple-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                    1
                  </span>
                  Setup Company / Party
                </h2>
                <form onSubmit={handleSaveParty} className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Company / Party Name</label>
                    <input
                      type="text"
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      placeholder="e.g. Nigehban Healthcare Ltd"
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Party Unique Code</label>
                    <input
                      type="text"
                      value={partyCode}
                      onChange={(e) => setPartyCode(e.target.value)}
                      placeholder="E.G. NIGH-01"
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-purple-700 hover:bg-purple-800 text-white font-medium py-2.5 rounded-lg transition text-sm mt-2"
                  >
                    Save Party
                  </button>
                </form>
              </div>

              {/* 2. Setup Party Product */}
              <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg">
                <h2 className="text-md font-semibold text-slate-200 mb-4 flex items-center gap-2">
                  <span className="bg-emerald-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                    2
                  </span>
                  Setup Party Product
                </h2>
                <form onSubmit={handleSaveProduct} className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Select Company / Party</label>
                    <select
                      value={selectedPartyForProduct}
                      onChange={(e) => setSelectedPartyForProduct(e.target.value)}
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
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
                    <label className="block text-xs text-slate-400 mb-1">Product Name</label>
                    <input
                      type="text"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="e.g. gel"
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-medium py-2.5 rounded-lg transition text-sm mt-2"
                  >
                    Save Product
                  </button>
                </form>
              </div>
            </div>

            {/* 3. Setup Product Assembling & Items (Gram Weight) */}
            <form onSubmit={handleSaveAssemblingRecord} className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-md font-semibold text-slate-200 flex items-center gap-2">
                  <span className="bg-amber-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                    3
                  </span>
                  Setup Product Assembling & Items (Gram Weight)
                </h2>

                <button
                  type="button"
                  onClick={() => setShowAddTypeModal(true)}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 px-3 py-2 rounded-lg transition w-fit"
                >
                  + Add Component Option (Bottle, Cap, etc.)
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Select Company / Party</label>
                  <select
                    value={selectedPartyForBom}
                    onChange={(e) => {
                      setSelectedPartyForBom(e.target.value);
                      setSelectedProductForBom("");
                    }}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
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
                  <label className="block text-xs text-slate-400 mb-1">Select Product</label>
                  <select
                    value={selectedProductForBom}
                    onChange={(e) => setSelectedProductForBom(e.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                    required
                    disabled={!selectedPartyForBom}
                  >
                    <option value="">-- Select Product --</option>
                    {availableProductsForBom.map((prod) => (
                      <option key={prod.id} value={prod.id}>
                        {prod.product_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2">
                <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                  ASSEMBLING COMPONENTS BREAKDOWN:
                </span>
                <button
                  type="button"
                  onClick={handleAddAssemblingRow}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition"
                >
                  + Add Row
                </button>
              </div>

              <div className="space-y-3">
                {assemblingRows.map((row, index) => (
                  <div key={index} className="flex flex-col sm:flex-row items-center gap-3 bg-[#0b0f19] p-3 rounded-lg border border-slate-800 relative">
                    <button
                      type="button"
                      onClick={() => handleRemoveAssemblingRow(index)}
                      className="absolute -top-2 -right-2 bg-rose-600 text-white w-6 h-6 rounded-full text-xs font-bold shadow-lg"
                    >
                      ✕
                    </button>
                    <div className="flex-1 w-full">
                      <label className="block text-[10px] text-slate-500 mb-1">Component Type</label>
                      <select
                        value={row.component_type}
                        onChange={(e) => handleRowChange(index, "component_type", e.target.value)}
                        className="w-full bg-[#121827] border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200"
                        required
                      >
                        {componentTypes.map((t) => (
                          <option key={t} value={t} className="capitalize">
                            {t.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex-1 w-full">
                      <label className="block text-[10px] text-slate-500 mb-1">Fill Capacity (ML)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={row.ml_capacity}
                        onChange={(e) => handleRowChange(index, "ml_capacity", e.target.value)}
                        placeholder="e.g. 500"
                        className="w-full bg-[#121827] border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200"
                      />
                    </div>

                    <div className="flex-1 w-full">
                      <label className="block text-[10px] text-slate-500 mb-1">Weight for 10 Pcs (Grams)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={row.weight_10_pcs_grams}
                        onChange={(e) => handleRowChange(index, "weight_10_pcs_grams", e.target.value)}
                        placeholder="e.g. 122"
                        className="w-full bg-[#121827] border border-amber-500/50 rounded-lg px-2 py-1.5 text-xs text-amber-400 font-mono"
                        required
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-medium py-3 rounded-lg transition text-sm shadow-lg mt-2"
              >
                Save Assembling Setup
              </button>
            </form>
          </div>
        )}

        {/* TAB 2: PARTIES DIRECTORY */}
        {activeTab === "parties" && (
          <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h2 className="text-md font-semibold text-slate-200">Registered Companies / Parties</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => exportExcel(filteredParties, "Parties_Master_Data")}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                >
                  Excel
                </button>
                <button
                  onClick={() =>
                    exportPDFWithLogo("Registered Parties Directory", ["Party Code", "Party Name", "Date Added"], filteredParties.map(p => [p.code || "N/A", p.name, p.created_at ? new Date(p.created_at).toLocaleDateString() : "N/A"]))
                  }
                  className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                >
                  PDF
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold sticky top-0">
                  <tr>
                    <th className="p-3">Party Code</th>
                    <th className="p-3">Company / Party Name</th>
                    <th className="p-3">System ID</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredParties.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-800/50 transition">
                      <td className="p-3 font-mono text-purple-400">{p.code || "N/A"}</td>
                      <td className="p-3 font-bold text-slate-200">{p.name}</td>
                      <td className="p-3 font-mono text-slate-500 text-[10px]">{p.id}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setEditingParty(p)}
                          className="text-blue-400 hover:text-blue-300 mr-3 px-2 py-1 bg-blue-900/30 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteParty(p.id, p.name)}
                          className="text-rose-400 hover:text-rose-300 px-2 py-1 bg-rose-900/30 rounded"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredParties.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-slate-500">No parties found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: PRODUCTS DIRECTORY */}
        {activeTab === "products" && (
          <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h2 className="text-md font-semibold text-slate-200">Registered Products</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => exportExcel(filteredProducts, "Products_Master_Data")}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                >
                  Excel
                </button>
                <button
                  onClick={() =>
                    exportPDFWithLogo("Registered Products Directory", ["Company/Party", "Party Code", "Product Name", "Date Added"], filteredProducts.map(p => [p.parties?.name || "N/A", p.parties?.code || "N/A", p.product_name, p.created_at ? new Date(p.created_at).toLocaleDateString() : "N/A"]))
                  }
                  className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                >
                  PDF
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold sticky top-0">
                  <tr>
                    <th className="p-3">Company / Party</th>
                    <th className="p-3">Party Code</th>
                    <th className="p-3">Product Name</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredProducts.map((prod) => (
                    <tr key={prod.id} className="hover:bg-slate-800/50 transition">
                      <td className="p-3 font-bold text-emerald-400">{prod.parties?.name || "N/A"}</td>
                      <td className="p-3 font-mono text-slate-400">{prod.parties?.code || "N/A"}</td>
                      <td className="p-3 font-bold text-slate-200">{prod.product_name}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setEditingProduct(prod)}
                          className="text-blue-400 hover:text-blue-300 mr-3 px-2 py-1 bg-blue-900/30 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(prod.id, prod.product_name)}
                          className="text-rose-400 hover:text-rose-300 px-2 py-1 bg-rose-900/30 rounded"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-slate-500">No products found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: ASSEMBLING DIRECTORY (BOM) */}
        {activeTab === "assembling" && (
          <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h2 className="text-md font-semibold text-slate-200">Products Assembling Detail (BOM)</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => exportExcel(filteredBomView, "Assembling_BOM_Data")}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                >
                  Excel
                </button>
                <button
                  onClick={() =>
                    exportPDFWithLogo("Products Assembling (BOM) Directory", ["Party", "Product", "Component", "Capacity(ML)", "10Pcs Wt(g)"], filteredBomView.map(b => [b.products?.parties?.name || "N/A", b.products?.product_name || "N/A", b.component_type, b.ml_capacity, b.weight_10_pcs_grams]))
                  }
                  className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                >
                  PDF
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold sticky top-0">
                  <tr>
                    <th className="p-3">Party Name</th>
                    <th className="p-3">Product Name</th>
                    <th className="p-3 text-amber-400">Component</th>
                    <th className="p-3">Fill Capacity (ML)</th>
                    <th className="p-3 text-amber-400">Weight (10 Pcs)</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredBomView.map((bom) => (
                    <tr key={bom.id} className="hover:bg-slate-800/50 transition">
                      <td className="p-3 font-semibold text-emerald-400">{bom.products?.parties?.name || "N/A"}</td>
                      <td className="p-3 font-semibold text-slate-200">{bom.products?.product_name || "N/A"}</td>
                      <td className="p-3 capitalize font-bold text-amber-400">{bom.component_type.replace("_", " ")}</td>
                      <td className="p-3 font-mono">{bom.ml_capacity > 0 ? `${bom.ml_capacity} ml` : "-"}</td>
                      <td className="p-3 font-mono font-bold text-amber-300">{bom.weight_10_pcs_grams} g</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setEditingBomItem(bom)}
                          className="text-blue-400 hover:text-blue-300 mr-3 px-2 py-1 bg-blue-900/30 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteBomItem(bom.id)}
                          className="text-rose-400 hover:text-rose-300 px-2 py-1 bg-rose-900/30 rounded"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredBomView.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">No Assembling details found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: FILLING LOGS */}
        {activeTab === "filling" && (
          <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <div>
                <h2 className="text-md font-semibold text-slate-200 flex items-center gap-2">
                  Filling Logs & Batch Verification
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" title="Live Sync Active"></span>
                </h2>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => exportExcel(filteredFillingLogs, "Filling_Requests_Log")}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                >
                  Excel
                </button>
                <button
                  onClick={() =>
                    exportPDFWithLogo(
                      "Filling Production Batch Summary",
                      ["Batch No", "Party", "Product", "Pcs Req", "MFG Date", "EXP Date", "Retail Price", "Req Date", "Status"],
                      filteredFillingLogs.map(f => [
                        f.batch_no,
                        f.party_name,
                        f.product_name,
                        f.pcs_requested,
                        f.mfg_date || "N/A",
                        f.exp_date || "N/A",
                        f.retail_price ? `Rs. ${f.retail_price}` : "N/A",
                        f.requested_at,
                        f.status
                      ])
                    )
                  }
                  className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
                >
                  PDF
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold sticky top-0">
                  <tr>
                    <th className="p-3">Batch No</th>
                    <th className="p-3">Party Name</th>
                    <th className="p-3">Product Name</th>
                    <th className="p-3 text-center">Req. Pcs</th>
                    <th className="p-3 text-center text-purple-400">MFG Date</th>
                    <th className="p-3 text-center text-rose-400">EXP Date</th>
                    <th className="p-3 text-right text-emerald-400">Retail Price</th>
                    <th className="p-3">Request Date</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">View Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredFillingLogs.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-800/50 transition">
                      <td className="p-3 font-mono font-bold text-purple-400">{req.batch_no}</td>
                      <td className="p-3 font-bold text-white">{req.party_name}</td>
                      <td className="p-3 font-semibold text-emerald-400">{req.product_name}</td>
                      <td className="p-3 text-center font-mono text-amber-300 font-bold">{req.pcs_requested} Pcs</td>
                      <td className="p-3 text-center font-mono text-slate-300">{req.mfg_date || "-"}</td>
                      <td className="p-3 text-center font-mono text-rose-300">{req.exp_date || "-"}</td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-300">
                        {req.retail_price ? `Rs. ${req.retail_price}` : "-"}
                      </td>
                      <td className="p-3 text-slate-400 font-mono text-[11px]">{req.requested_at}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          req.status === "ACCEPTED" ? "bg-emerald-900/50 text-emerald-400 border border-emerald-800" :
                          req.status === "ISSUED" ? "bg-blue-900/50 text-blue-400 border border-blue-800" :
                          "bg-amber-900/50 text-amber-400 border border-amber-800"
                        }`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setSelectedWeightLog(req)}
                          className="bg-amber-600/20 hover:bg-amber-600 border border-amber-500/50 text-amber-400 hover:text-white px-3 py-1.5 rounded transition font-medium"
                        >
                          View Detail
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredFillingLogs.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-6 text-center text-slate-500">No filling requests found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: WAREHOUSE LOGS */}
        {activeTab === "warehouse" && (
          <div className="bg-[#121827] border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h2 className="text-md font-semibold text-slate-200">Warehouse IN/OUT Register</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => exportExcel(filteredWarehouseLogs, "Warehouse_Logs")}
                  className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition"
                >
                  Export Excel
                </button>
                <button
                  onClick={() =>
                    exportPDFWithLogo("Warehouse IN/OUT Logs", ["Type", "Party", "Product", "Component", "Quantity", "Date"], filteredWarehouseLogs.map(w => [w.type, w.party_name, w.product_name, w.component_type, w.quantity, w.timestamp]))
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
                    <th className="p-3">Party Name</th>
                    <th className="p-3">Product Name</th>
                    <th className="p-3">Component Item</th>
                    <th className="p-3">Quantity (Pcs)</th>
                    <th className="p-3">Date & Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredWarehouseLogs.map((w) => (
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
                      <td className="p-3 font-semibold text-white">{w.party_name}</td>
                      <td className="p-3 text-emerald-400">{w.product_name}</td>
                      <td className="p-3 text-slate-200">{w.component_type}</td>
                      <td className="p-3 font-mono font-bold text-amber-300">{w.quantity} Pcs</td>
                      <td className="p-3 text-slate-400">{w.timestamp}</td>
                    </tr>
                  ))}
                  {filteredWarehouseLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">No warehouse logs found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 7: TOTAL INVENTORY SUMMARY */}
        {activeTab === "inventory" && (
          <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-md font-semibold text-white">Master Party-Wise Total Stock Balance</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => exportExcel(filteredInventoryList, "Master_Inventory_Stock")}
                  className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition"
                >
                  Export Excel
                </button>
                <button
                  onClick={() =>
                    exportPDFWithLogo(
                      "Master Inventory Stock Balance Report",
                      ["Party", "Product", "Bottles", "Caps", "Seals", "Boxes"],
                      filteredInventoryList.map((i) => [
                        i.party_name,
                        i.product_name,
                        i.bottles,
                        i.caps,
                        i.seals,
                        i.boxes,
                      ])
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
                    <th className="p-3">Party Name</th>
                    <th className="p-3">Product Name</th>
                    <th className="p-3">Bottles Stock</th>
                    <th className="p-3">Caps Stock</th>
                    <th className="p-3">Seals Stock</th>
                    <th className="p-3">Boxes / Cartons</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredInventoryList.map((inv, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/50">
                      <td className="p-3 font-semibold text-white">{inv.party_name}</td>
                      <td className="p-3 text-emerald-400">{inv.product_name}</td>
                      <td className="p-3 font-mono font-bold text-slate-100">{inv.bottles} Pcs</td>
                      <td className="p-3 font-mono text-slate-300">{inv.caps} Pcs</td>
                      <td className="p-3 font-mono text-slate-300">{inv.seals} Pcs</td>
                      <td className="p-3 font-mono text-amber-300">{inv.boxes} Boxes</td>
                    </tr>
                  ))}
                  {filteredInventoryList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">No inventory data found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 8: CLIENT PORTAL ACCESS MANAGEMENT (NEW) */}
        {activeTab === "client_access" && (
          <div className="space-y-6">
            <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl shadow-lg">
              <h2 className="text-md font-semibold text-white mb-4 flex items-center gap-2">
                <span className="bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">🔒</span>
                Generate & Assign Portal Access to Specific Party (e.g. Magitech)
              </h2>
              <form onSubmit={handleCreatePartyPortalAccess} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Select Party / Client</label>
                  <select
                    value={selectedPartyForPortal}
                    onChange={(e) => setSelectedPartyForPortal(e.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    required
                  >
                    <option value="">-- Select Party --</option>
                    {partiesList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Login Username</label>
                  <input
                    type="text"
                    value={portalUsername}
                    onChange={(e) => setPortalUsername(e.target.value)}
                    placeholder="e.g. magitech_user"
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Secret Password PIN</label>
                  <input
                    type="text"
                    value={portalPin}
                    onChange={(e) => setPortalPin(e.target.value)}
                    placeholder="e.g. 123456"
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition text-xs shadow-lg"
                >
                  Create Portal Access
                </button>
              </form>
            </div>

            <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl shadow-lg space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">Active Party Portal Credentials</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold">
                    <tr>
                      <th className="p-3">Party Name</th>
                      <th className="p-3">Portal Username</th>
                      <th className="p-3">Access PIN</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Toggle Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {partyAccessList.map((acc) => (
                      <tr key={acc.id} className="hover:bg-slate-800/50">
                        <td className="p-3 font-bold text-white">{acc.party_name}</td>
                        <td className="p-3 font-mono text-indigo-400">{acc.username}</td>
                        <td className="p-3 font-mono text-amber-300">{acc.access_pin}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              acc.is_active
                                ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                                : "bg-rose-950 text-rose-400 border border-rose-800"
                            }`}
                          >
                            {acc.is_active ? "ACTIVE" : "DISABLED"}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleTogglePortalStatus(acc.id)}
                            className={`px-3 py-1 rounded text-xs font-semibold transition ${
                              acc.is_active
                                ? "bg-rose-900/30 text-rose-400 hover:bg-rose-900/50"
                                : "bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50"
                            }`}
                          >
                            {acc.is_active ? "Disable Access" : "Enable Access"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {partyAccessList.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-500">No client portal accounts created yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* COMPONENT WEIGHT BREAKDOWN MODAL */}
      {selectedWeightLog && (
        <WeightModal
          isOpen={!!selectedWeightLog}
          onClose={() => setSelectedWeightLog(null)}
          log={selectedWeightLog}
          onSave={handleSaveActualWeightsFromModal}
        />
      )}

      {/* MODAL: ADD COMPONENT OPTION */}
      {showAddTypeModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-[#121827] border border-slate-800 p-6 rounded-xl w-full max-w-md space-y-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100">Add New Component Type</h3>
            <input
              type="text"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="e.g. outer_carton"
              className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAddTypeModal(false)}
                className="px-4 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddNewComponentType}
                className="px-4 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium"
              >
                Add Option
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PARTY MODAL */}
      {editingParty && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={handleUpdateParty} className="bg-[#121827] border border-slate-800 p-6 rounded-2xl space-y-4 w-full max-w-md">
            <h3 className="text-lg font-bold text-white">Edit Party / Company</h3>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Party Name</label>
              <input
                type="text"
                value={editingParty.name}
                onChange={(e) => setEditingParty({ ...editingParty, name: e.target.value })}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Party Code</label>
              <input
                type="text"
                value={editingParty.code}
                onChange={(e) => setEditingParty({ ...editingParty, code: e.target.value })}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white uppercase font-mono"
                required
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingParty(null)}
                className="w-1/2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-1/2 bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold py-2 rounded-xl"
              >
                Update Party
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT PRODUCT MODAL */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={handleUpdateProduct} className="bg-[#121827] border border-slate-800 p-6 rounded-2xl space-y-4 w-full max-w-md">
            <h3 className="text-lg font-bold text-white">Edit Product</h3>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Select Party</label>
              <select
                value={editingProduct.party_id}
                onChange={(e) => setEditingProduct({ ...editingProduct, party_id: e.target.value })}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                required
              >
                {partiesList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Product Name</label>
              <input
                type="text"
                value={editingProduct.product_name}
                onChange={(e) => setEditingProduct({ ...editingProduct, product_name: e.target.value })}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                required
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="w-1/2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-1/2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-2 rounded-xl"
              >
                Update Product
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT ASSEMBLING (BOM) ITEM MODAL */}
      {editingBomItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={handleUpdateBomItem} className="bg-[#121827] border border-slate-800 p-6 rounded-2xl space-y-4 w-full max-w-md">
            <h3 className="text-lg font-bold text-white">Edit Assembling Component Details</h3>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Component Type</label>
              <select
                value={editingBomItem.component_type}
                onChange={(e) => setEditingBomItem({ ...editingBomItem, component_type: e.target.value })}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white capitalize"
                required
              >
                {componentTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">ML Size</label>
              <input
                type="number"
                value={editingBomItem.ml_capacity}
                onChange={(e) => setEditingBomItem({ ...editingBomItem, ml_capacity: Number(e.target.value) })}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-xs text-amber-400 block mb-1">10 Pcs Weight (Grams)</label>
              <input
                type="number"
                value={editingBomItem.weight_10_pcs_grams}
                onChange={(e) =>
                  setEditingBomItem({ ...editingBomItem, weight_10_pcs_grams: Number(e.target.value) })
                }
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 text-xs text-amber-300 font-mono"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingBomItem(null)}
                className="w-1/2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-1/2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold py-2 rounded-xl"
              >
                Update Details
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// WEIGHT BREAKDOWN MODAL COMPONENT
function WeightModal({
  isOpen,
  onClose,
  log,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  log: FillingRequestLog;
  onSave: (updatedComponents: ComponentWeightItem[]) => void;
}) {
  const [actualWeights, setActualWeights] = useState<{ [key: string]: number }>(() => {
    const initial: { [key: string]: number } = {};
    log.components.forEach((c) => {
      initial[c.component_type] = c.actual_issued_weight_kg || 0;
    });
    return initial;
  });

  if (!isOpen) return null;

  const handleInputChange = (compType: string, val: string) => {
    setActualWeights({
      ...actualWeights,
      [compType]: parseFloat(val) || 0,
    });
  };

  const handleSaveModal = () => {
    const updated = log.components.map((c) => ({
      ...c,
      actual_issued_weight_kg: actualWeights[c.component_type] || 0,
    }));
    onSave(updated);
    onClose();
  };

  const totalTheoreticalKg = log.components.reduce((sum, c) => sum + c.theoretical_weight_kg, 0);
  const totalActualKg = Object.values(actualWeights).reduce((sum, val) => sum + val, 0);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans text-slate-100">
      <div className="bg-[#121827] border border-slate-800 rounded-2xl w-full max-w-3xl p-6 space-y-6 shadow-2xl">
        <div className="flex justify-between items-start border-b border-slate-800 pb-4">
          <div>
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
              Batch No: {log.batch_no} ({log.pcs_requested} Pcs)
            </span>
            <h2 className="text-xl font-extrabold text-white">Filling vs Warehouse Weight Detail</h2>
            <div className="flex flex-wrap gap-4 text-xs text-slate-400 mt-2">
              <span>Party: <strong className="text-white">{log.party_name}</strong></span>
              <span>Product: <strong className="text-emerald-400">{log.product_name}</strong></span>
              <span>MFG Date: <strong className="text-purple-300">{log.mfg_date || "N/A"}</strong></span>
              <span>EXP Date: <strong className="text-rose-300">{log.exp_date || "N/A"}</strong></span>
              <span>MRP: <strong className="text-emerald-300">{log.retail_price ? `Rs. ${log.retail_price}` : "N/A"}</strong></span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-lg p-1">
            ✕
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-[#0b0f19] text-slate-400 uppercase font-semibold">
              <tr>
                <th className="p-3">Component Item</th>
                <th className="p-3">10 Pcs Grams</th>
                <th className="p-3 text-indigo-400">Filling Requested Weight (Kg)</th>
                <th className="p-3 text-amber-400">Warehouse Dispatched Weight (Kg)</th>
                <th className="p-3 text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {log.components.map((c, idx) => {
                const actual = actualWeights[c.component_type] || 0;
                const variance = actual - c.theoretical_weight_kg;

                return (
                  <tr key={idx} className="hover:bg-slate-800/50">
                    <td className="p-3 font-bold text-white capitalize">{c.component_type}</td>
                    <td className="p-3 font-mono text-slate-400">{c.weight_10_pcs_grams}g</td>
                    <td className="p-3 font-mono font-bold text-indigo-300">
                      {c.theoretical_weight_kg.toFixed(2)} Kg
                    </td>
                    <td className="p-3">
                      <input
                        type="number"
                        step="0.01"
                        value={actualWeights[c.component_type] || ""}
                        onChange={(e) => handleInputChange(c.component_type, e.target.value)}
                        placeholder="e.g. 4.5"
                        className="bg-[#0b0f19] border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-amber-300 font-mono font-bold w-28 focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="p-3 text-right font-mono font-bold">
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
                <td className="p-3 font-mono text-indigo-400">{totalTheoreticalKg.toFixed(2)} Kg</td>
                <td className="p-3 font-mono text-amber-400">{totalActualKg.toFixed(2)} Kg</td>
                <td className="p-3 text-right font-mono text-emerald-400">
                  {(totalActualKg - totalTheoreticalKg).toFixed(2)} Kg
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
          >
            Close
          </button>
          <button
            onClick={handleSaveModal}
            className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-lg transition"
          >
            Save Dispatched Weight
          </button>
        </div>
      </div>
    </div>
  );
}