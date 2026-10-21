"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  FillingMaterialReturn,
  getFillingMaterialReturnStatusLabel,
  getFillingMaterialReturnsSetupMessage,
  isFillingMaterialReturnsTableMissing,
} from "@/lib/filling-material-returns";

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
  master_carton_count?: number | null;
  master_carton_pcs?: number | null;
  master_cartons_required?: number | null;
  plan_pcs?: number;
  nigehban_pcs?: number;
  source_warehouse?: string | null;
  source_warehouse_party_id?: string | null;
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

const getRequiredMasterCartonCount = (request: FillingRequest) =>
  request.master_cartons_required ??
  (request.master_carton_pcs && request.master_carton_pcs > 0 && request.pcs_requested > 0
    ? Math.ceil(request.pcs_requested / request.master_carton_pcs)
    : null);

const getRequestComponentsLabel = (request: FillingRequest) =>
  request.components?.length
    ? request.components
      .map((component) => `${component.component_type}: ${component.pcs_requested.toLocaleString()} pcs`)
      .join("\n")
    : "N/A";

const omitAllocationSourceFields = (request: FillingRequest) => {
  const visibleRequest = { ...request };
  delete visibleRequest.plan_pcs;
  delete visibleRequest.nigehban_pcs;
  delete visibleRequest.source_warehouse;
  delete visibleRequest.source_warehouse_party_id;
  return visibleRequest;
};

interface InventoryLog {
  id: string;
  action_type: "IN" | "OUT";
  party_name: string;
  product_name?: string;
  component_type: string;
  quantity: number;
  remarks: string;
  created_at: string;
  carton_count?: number | null;
  carton_name?: string | null;
}

interface StockBalance {
  id: string;
  party_id?: string;
  party_name: string;
  product_id?: string;
  product_name?: string;
  component_type: string;
  quantity: number;
  carton_count?: number | null;
  carton_name?: string | null;
}

interface MasterCartonOption {
  id: string;
  carton_count: number | null;
  carton_name: string | null;
}

interface ProductBomCapacity {
  component_type: string;
  ml_capacity: number | null;
  capacity_unit: "ML" | "GM" | null;
  products?: {
    product_name: string;
    parties?: { name: string } | { name: string }[] | null;
  } | {
    product_name: string;
    parties?: { name: string } | { name: string }[] | null;
  }[] | null;
}

interface StockInComponentRow {
  component_type: string;
  quantity: string;
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const databaseError = error as { message?: string; code?: string; details?: string; hint?: string };
    return [
      databaseError.message,
      databaseError.code ? `(${databaseError.code})` : "",
      databaseError.details,
      databaseError.hint,
    ].filter(Boolean).join(" ");
  }
  return String(error);
};

const fetchSavedComponentTypes = async () => {
  const { data, error } = await supabase
    .from("component_type_options")
    .select("component_type")
    .order("component_type");

  if (error && error.message.toLowerCase().includes("component_type")) {
    const fallback = await supabase.from("component_type_options").select("name").order("name");
    if (fallback.error) throw fallback.error;
    return (fallback.data ?? [])
      .map((option) => option.name?.trim().toLowerCase() ?? "")
      .filter(Boolean);
  }

  if (error) throw error;
  return (data ?? [])
    .map((option) => option.component_type?.trim().toLowerCase() ?? "")
    .filter(Boolean);
};

const getQuantityUnit = (componentType: string) =>
  componentType.trim().toLowerCase() === "master_carton" ? "Cartons" : "Pcs";

const isTapeComponentType = (componentType: string) => {
  const normalizedType = componentType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalizedType === "tape" || normalizedType.endsWith("_tape");
};

const getMasterCartonLabel = (item: { carton_count?: number | null; carton_name?: string | null }) =>
  item.carton_name?.trim() || (item.carton_count ? `Carton #${item.carton_count}` : "Shared / unspecified");

const ALL_PARTIES_OPTION = "__all_parties__";
const ALL_PRODUCTS_OPTION = "__all_products__";

export default function WarehousePortalPage() {
  const [activeTab, setActiveTab] = useState<"requests" | "returns" | "stock_in" | "master_cartons" | "stock_out" | "balance">("requests");
  const [loading, setLoading] = useState(false);
  const [warehouseDataError, setWarehouseDataError] = useState<string | null>(null);

  // Master Data from DB
  const [partiesList, setPartiesList] = useState<Party[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [masterCartonOptions, setMasterCartonOptions] = useState<MasterCartonOption[]>([]);
  const [masterCartonOptionsError, setMasterCartonOptionsError] = useState<string | null>(null);

  // Warehouse Data
  const [requestsList, setRequestsList] = useState<FillingRequest[]>([]);
  const [materialReturns, setMaterialReturns] = useState<FillingMaterialReturn[]>([]);
  const [materialReturnsError, setMaterialReturnsError] = useState("");
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
  const [stockInRows, setStockInRows] = useState<StockInComponentRow[]>([
    { component_type: "bottle", quantity: "" },
  ]);
  const [remarks, setRemarks] = useState("");
  const [masterCartonPartyId, setMasterCartonPartyId] = useState("");
  const [masterCartonProductPartyId, setMasterCartonProductPartyId] = useState("");
  const [masterCartonProductId, setMasterCartonProductId] = useState("");
  const [masterCartonOptionId, setMasterCartonOptionId] = useState("");
  const [masterCartonQuantity, setMasterCartonQuantity] = useState("");
  const [masterCartonPlanType, setMasterCartonPlanType] = useState("");
  const [masterCartonNigehbanQuantity, setMasterCartonNigehbanQuantity] = useState("");
  const [masterCartonRemarks, setMasterCartonRemarks] = useState("");
  const [masterCartonOutWarehouseId, setMasterCartonOutWarehouseId] = useState("");
  const [masterCartonOutProductPartyId, setMasterCartonOutProductPartyId] = useState("");
  const [masterCartonOutProductId, setMasterCartonOutProductId] = useState("");
  const [masterCartonOutStockId, setMasterCartonOutStockId] = useState("");
  const [masterCartonOutQuantity, setMasterCartonOutQuantity] = useState("");
  const [masterCartonOutRemarks, setMasterCartonOutRemarks] = useState("");
  const [tapeInWarehouseId, setTapeInWarehouseId] = useState("");
  const [tapeInProductId, setTapeInProductId] = useState("");
  const [tapeInComponentType, setTapeInComponentType] = useState("");
  const [tapeInQuantity, setTapeInQuantity] = useState("");
  const [tapeInRemarks, setTapeInRemarks] = useState("");
  const [tapeOutWarehouseId, setTapeOutWarehouseId] = useState("");
  const [tapeOutProductId, setTapeOutProductId] = useState("");
  const [tapeOutStockId, setTapeOutStockId] = useState("");
  const [tapeOutQuantity, setTapeOutQuantity] = useState("");
  const [tapeOutRemarks, setTapeOutRemarks] = useState("");

  // Stock OUT Manual Form State
  const [outPartyIdInput, setOutPartyIdInput] = useState("");
  const [outProductIdInput, setOutProductIdInput] = useState("");
  const [outComponentType, setOutComponentType] = useState("bottle");
  const [outMasterCartonStockId, setOutMasterCartonStockId] = useState("");
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
    setWarehouseDataError(null);
    try {
      const { data: partyData } = await supabase.from("parties").select("*").order("name");
      if (partyData) setPartiesList(partyData);

      const { data: prodData } = await supabase.from("products").select("*").order("product_name");
      if (prodData) setProductsList(prodData);

      const { data: reqData } = await supabase.from("filling_requests").select("*");
      if (reqData) setRequestsList(reqData as FillingRequest[]);

      const { data: materialReturnData, error: materialReturnError } = await supabase
        .from("filling_material_returns")
        .select("*")
        .order("created_at", { ascending: false });
      if (materialReturnError) {
        setMaterialReturnsError(
          isFillingMaterialReturnsTableMissing(materialReturnError)
            ? getFillingMaterialReturnsSetupMessage()
            : materialReturnError.message
        );
        setMaterialReturns([]);
      } else {
        setMaterialReturnsError("");
        setMaterialReturns((materialReturnData ?? []) as FillingMaterialReturn[]);
      }

      const { data: logData } = await supabase.from("inventory_logs").select("*").order("created_at", { ascending: false });
      if (logData) setInOutLogs(logData);

      const { data: stockData } = await supabase.from("inventory").select("*");
      if (stockData) setStockBalances(stockData);

      const { data: cartonOptionsData, error: cartonOptionsError } = await supabase
        .from("master_carton_options")
        .select("id, carton_count, carton_name")
        .order("carton_count");
      if (cartonOptionsError) {
        setMasterCartonOptionsError(cartonOptionsError.message);
        throw cartonOptionsError;
      }
      setMasterCartonOptions(cartonOptionsData ?? []);
      setMasterCartonOptionsError(null);

      // Fetch dynamic component types from product_bom table
      const { data: bomTypesData, error: bomTypesError } = await supabase
        .from("product_bom")
        .select("component_type, ml_capacity, capacity_unit, products(product_name, parties!products_party_id_fkey(name))");
      if (bomTypesError) throw bomTypesError;
      if (bomTypesData) setProductBomCapacities(bomTypesData);
      const savedComponentTypes = await fetchSavedComponentTypes();
      const uniqueTypes = Array.from(
        new Set([
          ...savedComponentTypes,
          ...(bomTypesData ?? []).map((item: any) => item.component_type).filter(Boolean),
          "master_carton",
        ])
      );
      setDynamicComponentTypes(uniqueTypes);
      const stockInTypes = uniqueTypes.filter((type) => type.toLowerCase() !== "master_carton");
      setStockInRows((rows) =>
        rows.map((row, index) =>
          index === 0 && !stockInTypes.some((type) => type.toLowerCase() === row.component_type.toLowerCase())
            ? { ...row, component_type: stockInTypes[0] || "bottle" }
            : row
        )
      );
      if (uniqueTypes.length > 0 && !uniqueTypes.includes(outComponentType)) {
        setOutComponentType(uniqueTypes[0]);
      }
    } catch (e) {
      setWarehouseDataError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const filteredProductsForSelect = productsList.filter((p) => p.party_id === selectedPartyId);
  const filteredProductsForOutForm = productsList.filter((p) => p.party_id === outPartyIdInput);
  const filteredProductsForMasterCartonOut = masterCartonOutProductPartyId === ALL_PARTIES_OPTION
    ? productsList
    : productsList.filter((product) => product.party_id === masterCartonOutProductPartyId);
  const filteredProductsForTapeIn = productsList.filter((product) => product.party_id === tapeInWarehouseId);
  const filteredProductsForTapeOut = productsList.filter((product) => product.party_id === tapeOutWarehouseId);
  const tapeComponentTypes = dynamicComponentTypes.filter(isTapeComponentType);
  const availableTapeComponentTypes = tapeComponentTypes.length > 0 ? tapeComponentTypes : ["tape"];
  const selectedTapeComponentType = availableTapeComponentTypes.includes(tapeInComponentType)
    ? tapeInComponentType
    : availableTapeComponentTypes[0];
  const tapeOutStockOptions = stockBalances.filter((stock) =>
    isTapeComponentType(stock.component_type ?? "") &&
    (stock.party_id === tapeOutWarehouseId ||
      stock.party_name?.toLowerCase() === partiesList.find((party) => party.id === tapeOutWarehouseId)?.name.toLowerCase()) &&
    (stock.product_id === tapeOutProductId ||
      stock.product_name?.toLowerCase() === productsList.find((product) => product.id === tapeOutProductId)?.product_name.toLowerCase())
  );
  const masterCartonOutStockOptions = stockBalances.filter((stock) =>
    stock.component_type?.trim().toLowerCase() === "master_carton" &&
    (stock.party_id === masterCartonOutWarehouseId ||
      stock.party_name?.toLowerCase() === partiesList.find((party) => party.id === masterCartonOutWarehouseId)?.name.toLowerCase()) &&
    (stock.product_id === masterCartonOutProductId ||
      stock.product_name?.toLowerCase() === productsList.find((product) => product.id === masterCartonOutProductId)?.product_name.toLowerCase() ||
      (!stock.product_id && stock.product_name?.toLowerCase() === "all products"))
  );
  const outMasterCartonStockOptions = stockBalances.filter((stock) =>
    stock.component_type?.trim().toLowerCase() === "master_carton" &&
    (stock.party_id === outPartyIdInput ||
      stock.party_name?.toLowerCase() === partiesList.find((party) => party.id === outPartyIdInput)?.name.toLowerCase()) &&
    (stock.product_id === outProductIdInput ||
      stock.product_name?.toLowerCase() === productsList.find((product) => product.id === outProductIdInput)?.product_name.toLowerCase())
  );
  const filteredProductsForReq = productsList.filter((p) => p.party_id === reqPartyId);
  const filteredProductsForIn = productsList.filter((p) => p.party_id === inPartyId);
  const filteredProductsForOut = productsList.filter((p) => p.party_id === outPartyId);
  const filteredProductsForBal = productsList.filter((p) => p.party_id === balPartyId);
  const filteredProductsForMasterCarton = masterCartonProductPartyId === ALL_PARTIES_OPTION
    ? productsList
    : productsList.filter((product) => product.party_id === masterCartonProductPartyId);
  const stockInComponentTypes = dynamicComponentTypes.filter((type) => type.toLowerCase() !== "master_carton");
  const getCurrentStockQuantity = (
    partyId: string,
    productId: string,
    componentType: string,
    cartonOption?: MasterCartonOption
  ) => {
    const partyName = partiesList.find((party) => party.id === partyId)?.name.toLowerCase();
    const product = productsList.find((item) => item.id === productId);
    const isSharedProduct = productId === ALL_PRODUCTS_OPTION;

    return stockBalances
      .filter((stock) => {
        const matchesParty =
          stock.party_id === partyId || (!!partyName && stock.party_name?.toLowerCase() === partyName);
        const matchesProduct = isSharedProduct
          ? !stock.product_id && stock.product_name?.toLowerCase() === "all products"
          : !!product && (
              stock.product_id === product.id ||
              stock.product_name?.toLowerCase() === product.product_name.toLowerCase()
            );
        const matchesComponent =
          stock.component_type?.trim().toLowerCase() === componentType.trim().toLowerCase();
        const matchesCarton = !cartonOption || (
          (stock.carton_count ?? null) === cartonOption.carton_count &&
          (stock.carton_name?.trim().toLowerCase() ?? null) ===
            (cartonOption.carton_name?.trim().toLowerCase() ?? null)
        );
        return matchesParty && matchesProduct && matchesComponent && matchesCarton;
      })
      .reduce((total, stock) => total + Number(stock.quantity || 0), 0);
  };
  const selectedMasterCartonOption = masterCartonOptions.find((option) => option.id === masterCartonOptionId);
  const selectedMasterCartonStock = masterCartonOutStockOptions.find((stock) => stock.id === masterCartonOutStockId);
  const selectedTapeOutStock = tapeOutStockOptions.find((stock) => stock.id === tapeOutStockId);
  const selectedManualOutMasterCartonStock = outMasterCartonStockOptions.find(
    (stock) => stock.id === outMasterCartonStockId
  );
  const masterCartonInAvailable = masterCartonPartyId && masterCartonProductId && selectedMasterCartonOption
    ? getCurrentStockQuantity(
        masterCartonPartyId,
        masterCartonProductId,
        "master_carton",
        selectedMasterCartonOption
      )
    : null;
  const tapeInAvailable = tapeInWarehouseId && tapeInProductId
    ? getCurrentStockQuantity(tapeInWarehouseId, tapeInProductId, selectedTapeComponentType)
    : null;
  const tapeOutAvailable = selectedTapeOutStock?.quantity ?? null;
  const manualOutAvailable = outComponentType.trim().toLowerCase() === "master_carton"
    ? selectedManualOutMasterCartonStock?.quantity ?? null
    : outPartyIdInput && outProductIdInput
      ? getCurrentStockQuantity(outPartyIdInput, outProductIdInput, outComponentType)
      : null;

  const addStockInComponentRow = () => {
    const usedTypes = new Set(stockInRows.map((row) => row.component_type.toLowerCase()));
    const nextType = stockInComponentTypes.find((type) => !usedTypes.has(type.toLowerCase()));
    if (nextType) {
      setStockInRows((rows) => [...rows, { component_type: nextType, quantity: "" }]);
    }
  };

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

  const exportPDF = (
    title: string,
    headers: string[],
    body: any[][],
    orientation: "portrait" | "landscape" = "portrait"
  ) => {
    const doc = new jsPDF({ orientation });
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

  const handleReceiveMaterialReturn = async (returnId: string) => {
    if (!confirm("Confirm warehouse receipt? Usable returns will be added to inventory; damaged items will not.")) return;

    setLoading(true);
    try {
      const { error } = await supabase.rpc("receive_filling_material_return", {
        p_return_id: returnId,
      });
      if (error) throw error;
      await fetchWarehouseAndMasterData();
    } catch (error: unknown) {
      alert("Could not confirm warehouse receipt: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStockIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyId || !selectedProductId) {
      return alert("Please select Party and Product.");
    }
    if (
      stockInRows.length === 0 ||
      stockInRows.some((row) => !Number.isSafeInteger(Number(row.quantity)) || Number(row.quantity) <= 0)
    ) {
      return alert("Please enter a valid whole-number quantity greater than zero for every component.");
    }
    const componentTypes = stockInRows.map((row) => row.component_type.trim().toLowerCase());
    if (componentTypes.some((type, index) => !type || componentTypes.indexOf(type) !== index)) {
      return alert("Please select a different component type for each row.");
    }

    setLoading(true);
    try {
      const receivedRows = stockInRows.map((row) => ({
        componentType: row.component_type,
        quantity: Number(row.quantity),
      }));
      await recordWarehouseStockIn(selectedPartyId, selectedProductId, receivedRows, remarks);

      alert(`Stock IN recorded successfully for ${receivedRows.length} component${receivedRows.length === 1 ? "" : "s"}!`);
      setSelectedPartyId("");
      setSelectedProductId("");
      setStockInRows([{ component_type: stockInComponentTypes[0] || "bottle", quantity: "" }]);
      setRemarks("");
      fetchWarehouseAndMasterData();
    } catch (err: unknown) {
      alert("Stock IN failed: " + getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const recordWarehouseStockIn = async (
    partyId: string,
    productId: string | null,
    receivedRows: {
      componentType: string;
      quantity: number;
      planType?: string;
      nigehbanQuantity?: number;
      cartonCount?: number;
      cartonName?: string;
    }[],
    entryRemarks: string
  ) => {
    const partyObj = partiesList.find((party) => party.id === partyId);
    const prodObj = productId ? productsList.find((product) => product.id === productId) : null;
    if (!partyObj || (productId && !prodObj)) throw new Error("Selected Party or Product could not be found.");
    const productName = prodObj?.product_name ?? "All Products";

    const logPayloads = receivedRows.map((row) => ({
      action_type: "IN",
      party_name: partyObj.name,
      product_name: productName,
      component_type: row.componentType,
      quantity: row.quantity,
      remarks: entryRemarks || "Stock IN entry in Warehouse",
      created_at: new Date().toISOString(),
      ...(row.planType === undefined ? {} : { plan_type: row.planType }),
      ...(row.nigehbanQuantity === undefined ? {} : { nigehban_quantity: row.nigehbanQuantity }),
      ...(row.cartonCount === undefined ? {} : { carton_count: row.cartonCount }),
      ...(row.cartonName === undefined ? {} : { carton_name: row.cartonName }),
    }));

    const { error: logError } = await supabase.from("inventory_logs").insert(logPayloads);
    if (logError) throw logError;

    for (const row of receivedRows) {
      const existingStock = stockBalances.find(
        (stock) =>
          (stock.party_id === partyId || stock.party_name?.toLowerCase() === partyObj.name.toLowerCase()) &&
          (productId
            ? stock.product_id === productId || stock.product_name?.toLowerCase() === productName.toLowerCase()
            : !stock.product_id && stock.product_name?.toLowerCase() === productName.toLowerCase()) &&
          stock.component_type?.toLowerCase() === row.componentType.toLowerCase() &&
            (row.cartonCount === undefined && row.cartonName === undefined ||
              (stock.carton_count ?? null) === (row.cartonCount ?? null) &&
              (stock.carton_name?.trim().toLowerCase() ?? null) === (row.cartonName?.trim().toLowerCase() ?? null))
      );

      if (existingStock) {
        const { error } = await supabase
          .from("inventory")
          .update({ quantity: existingStock.quantity + row.quantity })
          .eq("id", existingStock.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("inventory").insert([
          {
            party_id: partyId,
            party_name: partyObj.name,
            product_id: productId,
            product_name: productName,
            component_type: row.componentType,
            quantity: row.quantity,
            ...(row.cartonCount === undefined ? {} : { carton_count: row.cartonCount }),
            ...(row.cartonName === undefined ? {} : { carton_name: row.cartonName }),
          },
        ]);
        if (error) throw error;
      }
    }
  };

  const handleSaveMasterCartonStockIn = async (event: React.FormEvent) => {
    event.preventDefault();
    const quantity = Number(masterCartonQuantity);
    const nigehbanQuantity = Number(masterCartonNigehbanQuantity);
    const selectedCartonOption = masterCartonOptions.find((option) => option.id === masterCartonOptionId);

    if (!masterCartonPartyId || !masterCartonProductPartyId || !masterCartonProductId) {
      return alert("Please select Product Party, Warehouse, and Product.");
    }
    const isSharedProductStock = masterCartonProductId === ALL_PRODUCTS_OPTION;
    const selectedProduct = isSharedProductStock
      ? null
      : productsList.find((product) => product.id === masterCartonProductId);
    if (!isSharedProductStock && (
      !selectedProduct ||
      (masterCartonProductPartyId !== ALL_PARTIES_OPTION &&
        selectedProduct?.party_id !== masterCartonProductPartyId)
    )) {
      return alert("Please select a product that belongs to the selected Product Party.");
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return alert("Please enter a whole-number carton quantity greater than zero.");
    }
    if (!selectedCartonOption) {
      return alert("Please select a valid Master Carton option.");
    }

    if (!masterCartonPlanType.trim()) {
      return alert("Please enter the Plan Type.");
    }
    if (!Number.isSafeInteger(nigehbanQuantity) || nigehbanQuantity < 0) {
      return alert("Please enter a whole-number Nigehban quantity of zero or more.");
    }

    setLoading(true);
    try {
      await recordWarehouseStockIn(
        masterCartonPartyId,
        isSharedProductStock ? null : masterCartonProductId,
        [{
          componentType: "master_carton",
          quantity,
          ...(selectedCartonOption.carton_count === null ? {} : { cartonCount: selectedCartonOption.carton_count }),
          ...(selectedCartonOption.carton_name === null ? {} : { cartonName: selectedCartonOption.carton_name }),
          planType: masterCartonPlanType.trim(),
          nigehbanQuantity,
        }],
        masterCartonRemarks
      );
      alert("Master Carton stock entry saved successfully.");
      setMasterCartonPartyId("");
      setMasterCartonProductPartyId("");
      setMasterCartonProductId("");
      setMasterCartonOptionId("");
      setMasterCartonQuantity("");
      setMasterCartonPlanType("");
      setMasterCartonNigehbanQuantity("");
      setMasterCartonRemarks("");
      void fetchWarehouseAndMasterData();
    } catch (error: unknown) {
      alert("Master Carton stock entry failed: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMasterCartonStockOut = async (event: React.FormEvent) => {
    event.preventDefault();
    const quantity = Number(masterCartonOutQuantity);
    const stockItem = masterCartonOutStockOptions.find((stock) => stock.id === masterCartonOutStockId);
    const warehouse = partiesList.find((party) => party.id === masterCartonOutWarehouseId);
    const product = productsList.find((item) => item.id === masterCartonOutProductId);

    if (!warehouse || !product || !stockItem) {
      return alert("Please select the warehouse, product, and carton stock to issue.");
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return alert("Please enter a whole-number carton quantity greater than zero.");
    }
    if (quantity > stockItem.quantity) {
      return alert(`Only ${stockItem.quantity} cartons are available for ${getMasterCartonLabel(stockItem)}.`);
    }

    setLoading(true);
    try {
      const logEntry: Record<string, string | number | null> = {
        action_type: "OUT",
        party_name: warehouse.name,
        product_name: stockItem.product_name || product.product_name,
        component_type: "master_carton",
        quantity,
        carton_count: stockItem.carton_count ?? null,
        remarks: masterCartonOutRemarks || "Master Carton stock OUT from Warehouse",
        created_at: new Date().toISOString(),
      };
      if (stockItem.carton_name) logEntry.carton_name = stockItem.carton_name;
      const { error: logError } = await supabase.from("inventory_logs").insert([logEntry]);
      if (logError) throw logError;

      const { error: stockError } = await supabase
        .from("inventory")
        .update({ quantity: Math.max(0, stockItem.quantity - quantity) })
        .eq("id", stockItem.id);
      if (stockError) throw stockError;

      alert("Master Carton stock OUT saved successfully.");
      setMasterCartonOutStockId("");
      setMasterCartonOutQuantity("");
      setMasterCartonOutRemarks("");
      await fetchWarehouseAndMasterData();
    } catch (error: unknown) {
      alert("Master Carton stock OUT failed: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTapeStockIn = async (event: React.FormEvent) => {
    event.preventDefault();
    const quantity = Number(tapeInQuantity);
    const product = productsList.find((item) => item.id === tapeInProductId);

    if (!tapeInWarehouseId || !product || product.party_id !== tapeInWarehouseId) {
      return alert("Please select the warehouse and a product belonging to it.");
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return alert("Please enter a whole-number Tape quantity greater than zero.");
    }

    setLoading(true);
    try {
      await recordWarehouseStockIn(
        tapeInWarehouseId,
        tapeInProductId,
        [{ componentType: selectedTapeComponentType, quantity }],
        tapeInRemarks
      );
      alert("Tape stock entry saved successfully.");
      setTapeInWarehouseId("");
      setTapeInProductId("");
      setTapeInComponentType("");
      setTapeInQuantity("");
      setTapeInRemarks("");
      await fetchWarehouseAndMasterData();
    } catch (error: unknown) {
      alert("Tape stock entry failed: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTapeStockOut = async (event: React.FormEvent) => {
    event.preventDefault();
    const quantity = Number(tapeOutQuantity);
    const stockItem = tapeOutStockOptions.find((stock) => stock.id === tapeOutStockId);
    const warehouse = partiesList.find((party) => party.id === tapeOutWarehouseId);
    const product = productsList.find((item) => item.id === tapeOutProductId);

    if (!warehouse || !product || !stockItem) {
      return alert("Please select the warehouse, product, and Tape stock to issue.");
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return alert("Please enter a whole-number Tape quantity greater than zero.");
    }
    if (quantity > stockItem.quantity) {
      return alert(`Only ${stockItem.quantity} Tape units are available.`);
    }

    setLoading(true);
    try {
      const { error: logError } = await supabase.from("inventory_logs").insert([{
        action_type: "OUT",
        party_name: warehouse.name,
        product_name: stockItem.product_name || product.product_name,
        component_type: stockItem.component_type,
        quantity,
        remarks: tapeOutRemarks || "Tape stock OUT from Warehouse",
        created_at: new Date().toISOString(),
      }]);
      if (logError) throw logError;

      const { error: stockError } = await supabase
        .from("inventory")
        .update({ quantity: Math.max(0, stockItem.quantity - quantity) })
        .eq("id", stockItem.id);
      if (stockError) throw stockError;

      alert("Tape stock OUT saved successfully.");
      setTapeOutStockId("");
      setTapeOutQuantity("");
      setTapeOutRemarks("");
      await fetchWarehouseAndMasterData();
    } catch (error: unknown) {
      alert("Tape stock OUT failed: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStockOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outPartyIdInput || !outProductIdInput || !outQtyPcs) {
      return alert("Please select Party, Product, and enter Quantity for Stock OUT.");
    }
    const qtyNum = Number(outQtyPcs);
    if (!Number.isSafeInteger(qtyNum) || qtyNum <= 0) {
      return alert("Please enter a whole-number issue quantity greater than zero.");
    }

    setLoading(true);
    try {
      const partyObj = partiesList.find((p) => p.id === outPartyIdInput);
      const prodObj = productsList.find((p) => p.id === outProductIdInput);
      const isMasterCarton = outComponentType.trim().toLowerCase() === "master_carton";
      const stockItem = isMasterCarton
        ? outMasterCartonStockOptions.find((stock) => stock.id === outMasterCartonStockId)
        : stockBalances.find(
          (stock) =>
            (stock.party_id === outPartyIdInput || stock.party_name?.toLowerCase() === partyObj?.name?.toLowerCase()) &&
            (stock.product_id === outProductIdInput || stock.product_name?.toLowerCase() === prodObj?.product_name?.toLowerCase()) &&
            stock.component_type?.toLowerCase() === outComponentType.toLowerCase()
        );
      if (isMasterCarton && !stockItem) {
        return alert("Please select the Master Carton type to issue.");
      }

      const availableQty = stockItem ? stockItem.quantity : 0;
      if (qtyNum > availableQty) {
        const unit = getQuantityUnit(outComponentType);
        return alert(`Stock Out Error: Available quantity (${availableQty} ${unit}) is less than requested issue quantity (${qtyNum} ${unit}).`);
      }

      const logPayload = {
        action_type: "OUT",
        party_name: partyObj?.name || "N/A",
        product_name: prodObj?.product_name || "N/A",
        component_type: outComponentType,
        quantity: qtyNum,
        remarks: outRemarks || "Manual Stock OUT entry from Warehouse",
        created_at: new Date().toISOString(),
        ...(stockItem?.carton_count == null ? {} : { carton_count: stockItem.carton_count }),
        ...(stockItem?.carton_name == null ? {} : { carton_name: stockItem.carton_name }),
      };

      const { error: logErr } = await supabase.from("inventory_logs").insert([logPayload]);
      if (logErr) throw logErr;

      const newQty = Math.max(0, availableQty - qtyNum);
      if (stockItem) {
        const { error: stockUpdateError } = await supabase
          .from("inventory")
          .update({ quantity: newQty })
          .eq("id", stockItem.id);
        if (stockUpdateError) throw stockUpdateError;
      }

      alert("Stock OUT recorded successfully & Balance updated!");
      setOutPartyIdInput("");
      setOutProductIdInput("");
      setOutMasterCartonStockId("");
      setOutQtyPcs("");
      setOutRemarks("");
      fetchWarehouseAndMasterData();
    } catch (err: unknown) {
      alert("Error: " + getErrorMessage(err));
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
    if (componentType === "master_carton") {
      return `MASTER CARTON (${getMasterCartonLabel(log)})`;
    }
    if (!["bottle", "tube", "jar"].includes(componentType)) return log.component_type.toUpperCase();

    const matchingBom = productBomCapacities.find(
      (bom) => {
        if (bom.component_type.trim().toLowerCase() !== componentType) return false;

        const products = Array.isArray(bom.products)
          ? bom.products
          : bom.products
            ? [bom.products]
            : [];
        return products.some((product) => {
          const parties = Array.isArray(product.parties)
            ? product.parties
            : product.parties
              ? [product.parties]
              : [];
          return (
            product.product_name.toLowerCase() === log.product_name?.toLowerCase() &&
            parties.some((party) => party.name.toLowerCase() === log.party_name.toLowerCase())
          );
        });
      }
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
  const getStockBalanceCapacity = (stock: StockBalance) => {
    const componentType = stock.component_type.trim().toLowerCase();
    const matchingBom = productBomCapacities.find((bom) => {
      if (bom.component_type.trim().toLowerCase() !== componentType) return false;
      const bomProducts = Array.isArray(bom.products) ? bom.products : bom.products ? [bom.products] : [];
      return bomProducts.some((product) => {
        const productParties = Array.isArray(product.parties)
          ? product.parties
          : product.parties
            ? [product.parties]
            : [];
        return (
          product.product_name.toLowerCase() === stock.product_name?.toLowerCase() &&
          productParties.some((party) => party.name.toLowerCase() === stock.party_name.toLowerCase())
        );
      });
    });
    return matchingBom?.ml_capacity == null
      ? "—"
      : `${matchingBom.ml_capacity} ${matchingBom.capacity_unit || "ML"}`;
  };
  const getStockBalanceComponentLabel = (stock: StockBalance) =>
    stock.component_type.trim().toLowerCase() === "master_carton"
      ? `MASTER CARTON (${getMasterCartonLabel(stock)})`
      : stock.component_type.toUpperCase();
  const getStockBalanceExportRows = () =>
    filteredStockBalances.map((stock) => ({
      "Party Name": stock.party_name || "General",
      "Product Name": stock.product_name || "General",
      "Component Type": getStockBalanceComponentLabel(stock),
      "ML / GM": getStockBalanceCapacity(stock),
      "Qty": `${stock.quantity || 0} ${getQuantityUnit(stock.component_type)}`,
    }));

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
        {warehouseDataError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-700/50 bg-rose-950/40 p-4 text-sm text-rose-300 normal-case">
            <span>Warehouse data could not be loaded: {warehouseDataError}</span>
            <button
              type="button"
              onClick={() => void fetchWarehouseAndMasterData()}
              disabled={loading}
              className="rounded-lg border border-rose-700/60 px-3 py-2 font-semibold hover:bg-rose-900/40 disabled:opacity-50"
            >
              {loading ? "Retrying..." : "Retry"}
            </button>
          </div>
        )}
        <div className="flex gap-2 border-b border-slate-800 pb-3 overflow-x-auto scrollbar-thin">
          <button
            onClick={() => setActiveTab("requests")}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${activeTab === "requests" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
              }`}
          >
            📦 Filling Requests ({requestsList.filter(r => r.status === "PENDING_WAREHOUSE").length})
          </button>
          <span className="px-3 sm:px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 text-slate-500">
            ↩ Returns / Damage — Coming Soon
          </span>
          <button
            onClick={() => setActiveTab("stock_in")}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${activeTab === "stock_in" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
              }`}
          >
            📥 Stock IN Portal
          </button>
          <button
            onClick={() => setActiveTab("master_cartons")}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${activeTab === "master_cartons" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
              }`}
          >
            📦 Master Carton IN
          </button>
          <button
            onClick={() => setActiveTab("stock_out")}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${activeTab === "stock_out" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
              }`}
          >
            📤 Stock OUT Portal & History
          </button>
          <button
            onClick={() => setActiveTab("balance")}
            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 ${activeTab === "balance" ? "bg-blue-600 text-white shadow-lg" : "bg-[#121827] text-slate-400 hover:text-white"
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
                      filteredRequests.map((request) => {
                        const exportRequest = omitAllocationSourceFields(request);
                        delete exportRequest.room_number;
                        return {
                          ...exportRequest,
                          room: request.room_number ? `Room ${request.room_number}` : "N/A",
                          components: getRequestComponentsLabel(request),
                        };
                      }),
                      "Filling_Requests_Dispatch"
                    )}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() =>
                      exportPDF(
                        "Warehouse Filling Requests Log",
                        ["Batch No", "Mfg/Exp", "Price", "Party", "Product", "Components", "Pack Size", "Room", "Pcs", "Carton Number", "Pcs/Carton", "Total Cartons Required", "Target Wt", "Scale Wt", "Dates", "Status"],
                        filteredRequests.map((f) => [
                          f.batch_no || f.req_code || "N/A",
                          `Mfg: ${f.mfg_date}\nExp: ${f.exp_date}`,
                          `Rs. ${f.retail_price || 0}`,
                          f.party_name,
                          f.product_name,
                          getRequestComponentsLabel(f),
                          f.pack_size ? `${f.pack_size} ${f.pack_unit || "ML"}` : "N/A",
                          f.room_number ? `Room ${f.room_number}` : "N/A",
                          f.pcs_requested,
                          f.master_carton_count ?? "N/A",
                          f.master_carton_pcs ?? "N/A",
                          getRequiredMasterCartonCount(f) ?? "N/A",
                          `${(f.total_weight_kg || 0).toFixed(2)} Kg`,
                          f.actual_dispatched_weight_kg ? `${f.actual_dispatched_weight_kg.toFixed(2)} Kg` : "Pending",
                          `Req: ${f.required_date || "-"}\nSent: ${f.requested_at ? new Date(f.requested_at).toLocaleDateString() : "-"}\nDisp: ${f.dispatched_at || "-"}\nRecv: ${f.received_at || "-"}`,
                          f.status,
                        ]),
                        "landscape"
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
                        <th className="p-3">Master Carton Requirement</th>
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
                          <td className="p-3 text-[10px] text-slate-300 whitespace-nowrap">
                            <div>Carton number: {req.master_carton_count ?? "—"} | {req.master_carton_pcs ?? "—"} pcs/carton</div>
                            <div className="font-bold text-cyan-300">
                              Send for batch: {getRequiredMasterCartonCount(req) ?? "—"} cartons
                            </div>
                          </td>
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
                                className={`px-2 py-0.5 rounded font-bold inline-block ${req.status === "RECEIVED_BY_FILLING_INCHARGE" || req.status === "RECEIVED_AND_VERIFIED"
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
        {activeTab === "returns" && (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
            <h2 className="mb-4 text-sm font-bold text-white">Filling Returns & Damaged Items</h2>
            {materialReturnsError && (
              <p role="alert" className="mb-4 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-300">
                Could not load return records: {materialReturnsError}. Apply the filling returns migration and refresh.
              </p>
            )}
            <table className="w-full min-w-[850px] text-left text-xs text-slate-300">
              <thead className="bg-[#0b0f19] uppercase text-slate-400">
                <tr>
                  <th className="p-3">Type / Batch</th>
                  <th className="p-3">Party / Product</th>
                  <th className="p-3">Destination</th>
                  <th className="p-3">Components / Qty</th>
                  <th className="p-3">Return to party date</th>
                  <th className="p-3">Status / Received</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {materialReturns.map((record) => (
                  <tr key={record.id}>
                    <td className="p-3">
                      <div className={`font-bold ${record.kind === "DAMAGED" ? "text-rose-300" : "text-cyan-300"}`}>
                        {record.kind === "DAMAGED" ? "DAMAGED" : "RETURN"}
                      </div>
                      <div className="mt-1 text-slate-400">{record.batch_no || "No batch"}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-white">{record.party_name}</div>
                      <div className="text-emerald-300">{record.product_name}</div>
                    </td>
                    <td className="p-3">{record.destination === "PARTY" ? "Party" : "Warehouse"}</td>
                    <td className="p-3">
                      {record.components.map((component, index) => (
                        <div key={`${component.component_type}-${index}`}>
                          {component.component_type}: {component.quantity} pcs
                        </div>
                      ))}
                    </td>
                    <td className="p-3">
                      {record.party_return_date
                        ? new Date(`${record.party_return_date}T00:00:00`).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="p-3">
                      <div>{getFillingMaterialReturnStatusLabel(record)}</div>
                      <div className="mt-1 text-[10px] text-slate-500">
                        Received: {record.received_at
                          ? new Date(record.received_at).toLocaleString()
                          : record.destination === "PARTY" ? "Not for warehouse" : "Pending"}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      {record.destination === "WAREHOUSE" && record.status === "PENDING_WAREHOUSE" && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => void handleReceiveMaterialReturn(record.id)}
                          className="rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          ✔ Confirm Received
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {materialReturns.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-500">No return or damage records.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "stock_in" && (
          <div className="space-y-6">
            <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-6">
              <h2 className="text-sm sm:text-md font-bold text-white">Stock IN Portal (Receive Material into Warehouse)</h2>
              <form onSubmit={handleSaveStockIn} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold text-slate-300">Components &amp; Quantities</h3>
                    <button
                      type="button"
                      onClick={addStockInComponentRow}
                      disabled={stockInRows.length >= stockInComponentTypes.length}
                      className="px-3 py-2 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/30 text-xs font-bold hover:bg-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      + Add Component
                    </button>
                  </div>
                  {stockInRows.map((row, rowIndex) => (
                    <div key={row.component_type} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">
                          Component Type {rowIndex + 1}
                        </label>
                        <select
                          value={row.component_type}
                          onChange={(event) =>
                            setStockInRows((rows) =>
                              rows.map((item, index) =>
                                index === rowIndex ? { ...item, component_type: event.target.value } : item
                              )
                            )
                          }
                          className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white uppercase"
                          required
                        >
                          {stockInComponentTypes.map((type) => (
                            <option
                              key={type}
                              value={type}
                              disabled={stockInRows.some(
                                (item, index) =>
                                  index !== rowIndex && item.component_type.toLowerCase() === type.toLowerCase()
                              )}
                            >
                              {type.replace("_", " ").toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-amber-400 block mb-1">Quantity Received (Pcs)</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={row.quantity}
                          onChange={(event) =>
                            setStockInRows((rows) =>
                              rows.map((item, index) =>
                                index === rowIndex ? { ...item, quantity: event.target.value } : item
                              )
                            )
                          }
                          placeholder="e.g. 5000"
                          className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                          required
                        />
                        {selectedPartyId && selectedProductId && (
                          <p className="mt-1 text-[10px] text-cyan-300">
                            Current stock: {getCurrentStockQuantity(selectedPartyId, selectedProductId, row.component_type)} Pcs
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setStockInRows((rows) => rows.filter((_, index) => index !== rowIndex))}
                        disabled={stockInRows.length === 1}
                        aria-label={`Remove component row ${rowIndex + 1}`}
                        className="px-3 py-3 rounded-lg bg-rose-600/20 text-rose-300 border border-rose-500/30 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
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
                      exportPDF(
                        "Warehouse Stock IN Log",
                        ["Party", "Product", "Component", "Quantity", "Remarks", "Timestamp"],
                        filteredStockInLogs.map((l) => [l.party_name, l.product_name || "N/A", formatStockInComponent(l), `${l.quantity} ${getQuantityUnit(l.component_type)}`, l.remarks, new Date(l.created_at).toLocaleString()])
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
                          <td className="p-3 font-mono font-bold text-emerald-300 whitespace-nowrap">{log.quantity} {getQuantityUnit(log.component_type)}</td>
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

        {activeTab === "master_cartons" && (
          <div className="space-y-5">
          <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-5">
            <div>
              <h2 className="text-sm sm:text-md font-bold text-white">Master Carton Stock IN</h2>
              <p className="mt-1 text-xs text-slate-400">
                Record received master cartons separately. Tape stock is managed independently below and is not required for this entry.
              </p>
            </div>
            <form onSubmit={handleSaveMasterCartonStockIn} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Product Party / Company</label>
                  <select
                    value={masterCartonProductPartyId}
                    onChange={(event) => {
                      setMasterCartonProductPartyId(event.target.value);
                      setMasterCartonProductId("");
                    }}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                  >
                    <option value="">-- Select Product Party --</option>
                    <option value={ALL_PARTIES_OPTION}>All Parties</option>
                    {partiesList.map((party) => (
                      <option key={party.id} value={party.id}>{party.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Master Carton Warehouse</label>
                  <select
                    value={masterCartonPartyId}
                    onChange={(event) => setMasterCartonPartyId(event.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                  >
                    <option value="">-- Select Warehouse --</option>
                    {partiesList.map((party) => (
                      <option key={party.id} value={party.id}>{party.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Select Product</label>
                  <select
                    value={masterCartonProductId}
                    onChange={(event) => setMasterCartonProductId(event.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                    disabled={!masterCartonProductPartyId}
                  >
                    <option value="">-- Select Product --</option>
                    <option value={ALL_PRODUCTS_OPTION}>All Products (Shared Stock)</option>
                    {filteredProductsForMasterCarton.map((product) => (
                      <option key={product.id} value={product.id}>
                        {masterCartonProductPartyId === ALL_PARTIES_OPTION
                          ? `${partiesList.find((party) => party.id === product.party_id)?.name ?? "Unknown party"} — ${product.product_name}`
                          : product.product_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-cyan-400 block mb-1">Master Carton Number / Name</label>
                  <select
                    value={masterCartonOptionId}
                    onChange={(event) => setMasterCartonOptionId(event.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                  >
                    <option value="">-- Select Carton Number or Name --</option>
                    {masterCartonOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {getMasterCartonLabel(option)}
                      </option>
                    ))}
                  </select>
                  {masterCartonOptionsError && (
                    <p className="mt-1 text-xs text-rose-400">
                      Could not load carton numbers: {masterCartonOptionsError}
                    </p>
                  )}
                  {!masterCartonOptionsError && masterCartonOptions.length === 0 && (
                    <p className="mt-1 text-xs text-amber-300">
                      Admin must add a carton number or name in Master Cartons setup first.
                    </p>
                  )}
                  {masterCartonOptionId && (
                    <p className="mt-1 text-[10px] text-slate-400">
                      Enter the received quantity for {getMasterCartonLabel(
                        masterCartonOptions.find((option) => option.id === masterCartonOptionId) ?? {}
                      )} below.
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-amber-400 block mb-1">
                    Quantity Received ({masterCartonOptionId
                      ? getMasterCartonLabel(masterCartonOptions.find((option) => option.id === masterCartonOptionId) ?? {})
                      : "Master Carton"})
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={masterCartonQuantity}
                    onChange={(event) => setMasterCartonQuantity(event.target.value)}
                    placeholder="e.g. 500 cartons"
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                    required
                  />
                  {masterCartonInAvailable !== null && (
                    <p className="mt-1 text-[10px] text-cyan-300">
                      Current stock: {masterCartonInAvailable} Cartons
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Plan Type</label>
                  <input
                    type="text"
                    value={masterCartonPlanType}
                    onChange={(event) => setMasterCartonPlanType(event.target.value)}
                    placeholder="Enter plan type"
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Nigehban Quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={masterCartonNigehbanQuantity}
                    onChange={(event) => setMasterCartonNigehbanQuantity(event.target.value)}
                    placeholder="Enter quantity"
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Remarks / Note</label>
                <input
                  type="text"
                  value={masterCartonRemarks}
                  onChange={(event) => setMasterCartonRemarks(event.target.value)}
                  placeholder="Supplier details or batch info"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-lg"
              >
                {loading ? "Saving..." : "Confirm & Save Master Carton Entry"}
              </button>
            </form>
          </div>
          <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-4">
            <div>
              <h2 className="text-sm sm:text-md font-bold text-white">Master Carton Stock OUT</h2>
              <p className="mt-1 text-xs text-slate-400">
                Select the same warehouse, product, and carton type that was used for Stock IN.
              </p>
            </div>
            <form onSubmit={handleSaveMasterCartonStockOut} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Product Party / Company</label>
                  <select
                    value={masterCartonOutProductPartyId}
                    onChange={(event) => {
                      setMasterCartonOutProductPartyId(event.target.value);
                      setMasterCartonOutProductId("");
                      setMasterCartonOutStockId("");
                    }}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                  >
                    <option value="">-- Select Product Party --</option>
                    <option value={ALL_PARTIES_OPTION}>All Parties</option>
                    {partiesList.map((party) => (
                      <option key={party.id} value={party.id}>{party.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Master Carton Warehouse</label>
                  <select
                    value={masterCartonOutWarehouseId}
                    onChange={(event) => {
                      setMasterCartonOutWarehouseId(event.target.value);
                      setMasterCartonOutStockId("");
                    }}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                  >
                    <option value="">-- Select Warehouse --</option>
                    {partiesList.map((party) => (
                      <option key={party.id} value={party.id}>{party.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Select Product</label>
                  <select
                    value={masterCartonOutProductId}
                    onChange={(event) => {
                      setMasterCartonOutProductId(event.target.value);
                      setMasterCartonOutStockId("");
                    }}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                    disabled={!masterCartonOutProductPartyId}
                  >
                    <option value="">-- Select Product --</option>
                    {filteredProductsForMasterCartonOut.map((product) => (
                      <option key={product.id} value={product.id}>{product.product_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-cyan-400 block mb-1">Carton Type / Name</label>
                  <select
                    value={masterCartonOutStockId}
                    onChange={(event) => setMasterCartonOutStockId(event.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                    disabled={!masterCartonOutWarehouseId || !masterCartonOutProductId}
                  >
                    <option value="">-- Select Carton Stock --</option>
                    {masterCartonOutStockOptions.map((stock) => (
                      <option key={stock.id} value={stock.id}>
                        {getMasterCartonLabel(stock)} — {stock.quantity} available
                      </option>
                    ))}
                  </select>
                  {masterCartonOutWarehouseId && masterCartonOutProductId && masterCartonOutStockOptions.length === 0 && (
                    <p className="mt-1 text-xs text-amber-300">No Master Carton stock found for this warehouse and product.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-amber-400 block mb-1">Quantity to Issue (Cartons)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={masterCartonOutQuantity}
                    onChange={(event) => setMasterCartonOutQuantity(event.target.value)}
                    placeholder="Enter cartons to issue"
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                    required
                  />
                  {selectedMasterCartonStock && (
                    <p className="mt-1 text-[10px] text-cyan-300">
                      Available now: {selectedMasterCartonStock.quantity} Cartons
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Remarks / Purpose</label>
                  <input
                    type="text"
                    value={masterCartonOutRemarks}
                    onChange={(event) => setMasterCartonOutRemarks(event.target.value)}
                    placeholder="Reason for issuing cartons"
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-lg"
              >
                {loading ? "Processing..." : "Confirm & Save Master Carton OUT"}
              </button>
            </form>
          </div>
          <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-4">
            <div>
              <h2 className="text-sm sm:text-md font-bold text-white">Tape Stock IN</h2>
              <p className="mt-1 text-xs text-slate-400">
                Enter Tape stock on its own; no Master Carton option or quantity is needed.
              </p>
            </div>
            <form onSubmit={handleSaveTapeStockIn} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Tape Warehouse</label>
                  <select
                    value={tapeInWarehouseId}
                    onChange={(event) => {
                      setTapeInWarehouseId(event.target.value);
                      setTapeInProductId("");
                    }}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                  >
                    <option value="">-- Select Warehouse --</option>
                    {partiesList.map((party) => (
                      <option key={party.id} value={party.id}>{party.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Select Product</label>
                  <select
                    value={tapeInProductId}
                    onChange={(event) => setTapeInProductId(event.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                    disabled={!tapeInWarehouseId}
                  >
                    <option value="">-- Select Product --</option>
                    {filteredProductsForTapeIn.map((product) => (
                      <option key={product.id} value={product.id}>{product.product_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Tape Type</label>
                  <select
                    value={selectedTapeComponentType}
                    onChange={(event) => setTapeInComponentType(event.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                  >
                    {availableTapeComponentTypes.map((type) => (
                      <option key={type} value={type}>{type.replace(/[_-]+/g, " ").toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-amber-400 block mb-1">Quantity Received (Pcs)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={tapeInQuantity}
                    onChange={(event) => setTapeInQuantity(event.target.value)}
                    placeholder="Enter Tape quantity"
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                    required
                  />
                  {tapeInAvailable !== null && (
                    <p className="mt-1 text-[10px] text-cyan-300">
                      Current stock: {tapeInAvailable} Pcs
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Remarks / Note</label>
                <input
                  type="text"
                  value={tapeInRemarks}
                  onChange={(event) => setTapeInRemarks(event.target.value)}
                  placeholder="Supplier details or batch info"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-lg"
              >
                {loading ? "Saving..." : "Confirm & Save Tape IN"}
              </button>
            </form>
          </div>
          <div className="bg-[#121827] border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xl space-y-4">
            <div>
              <h2 className="text-sm sm:text-md font-bold text-white">Tape Stock OUT</h2>
              <p className="mt-1 text-xs text-slate-400">
                Choose the warehouse, product, and available Tape stock to issue.
              </p>
            </div>
            <form onSubmit={handleSaveTapeStockOut} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Tape Warehouse</label>
                  <select
                    value={tapeOutWarehouseId}
                    onChange={(event) => {
                      setTapeOutWarehouseId(event.target.value);
                      setTapeOutProductId("");
                      setTapeOutStockId("");
                    }}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                  >
                    <option value="">-- Select Warehouse --</option>
                    {partiesList.map((party) => (
                      <option key={party.id} value={party.id}>{party.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Select Product</label>
                  <select
                    value={tapeOutProductId}
                    onChange={(event) => {
                      setTapeOutProductId(event.target.value);
                      setTapeOutStockId("");
                    }}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                    disabled={!tapeOutWarehouseId}
                  >
                    <option value="">-- Select Product --</option>
                    {filteredProductsForTapeOut.map((product) => (
                      <option key={product.id} value={product.id}>{product.product_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-cyan-400 block mb-1">Tape Stock Available</label>
                  <select
                    value={tapeOutStockId}
                    onChange={(event) => setTapeOutStockId(event.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                    required
                    disabled={!tapeOutWarehouseId || !tapeOutProductId}
                  >
                    <option value="">-- Select Tape Stock --</option>
                    {tapeOutStockOptions.map((stock) => (
                      <option key={stock.id} value={stock.id}>
                        {stock.component_type.replace(/[_-]+/g, " ").toUpperCase()} — {stock.quantity} Pcs
                      </option>
                    ))}
                  </select>
                  {tapeOutWarehouseId && tapeOutProductId && tapeOutStockOptions.length === 0 && (
                    <p className="mt-1 text-xs text-amber-300">No Tape stock found for this warehouse and product.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-amber-400 block mb-1">Quantity to Issue (Pcs)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={tapeOutQuantity}
                    onChange={(event) => setTapeOutQuantity(event.target.value)}
                    placeholder="Enter Tape quantity"
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                    required
                  />
                  {tapeOutAvailable !== null && (
                    <p className="mt-1 text-[10px] text-cyan-300">
                      Available now: {tapeOutAvailable} Pcs
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Remarks / Purpose</label>
                <input
                  type="text"
                  value={tapeOutRemarks}
                  onChange={(event) => setTapeOutRemarks(event.target.value)}
                  placeholder="Reason for issuing Tape"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition text-xs shadow-lg"
              >
                {loading ? "Processing..." : "Confirm & Save Tape OUT"}
              </button>
            </form>
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
                        setOutMasterCartonStockId("");
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
                      onChange={(e) => {
                        setOutProductIdInput(e.target.value);
                        setOutMasterCartonStockId("");
                      }}
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
                      onChange={(e) => {
                        setOutComponentType(e.target.value);
                        setOutMasterCartonStockId("");
                      }}
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white uppercase"
                    >
                      {dynamicComponentTypes.map((type) => (
                        <option key={type} value={type}>{type.replace("_", " ").toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                  {outComponentType.trim().toLowerCase() === "master_carton" && (
                    <div>
                      <label className="text-xs text-cyan-400 block mb-1">Master Carton Type</label>
                      <select
                        value={outMasterCartonStockId}
                        onChange={(event) => setOutMasterCartonStockId(event.target.value)}
                        className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                        required
                      >
                        <option value="">-- Select Carton Number or Name --</option>
                        {outMasterCartonStockOptions.map((stock) => (
                          <option key={stock.id} value={stock.id}>
                            {getMasterCartonLabel(stock)} ({stock.quantity} available)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-amber-400 block mb-1">
                      {outComponentType === "master_carton" ? "Master Cartons to Issue" : "Issue Quantity (Pcs)"}
                    </label>
                    <input
                      type="number"
                      value={outQtyPcs}
                      onChange={(e) => setOutQtyPcs(e.target.value)}
                      placeholder="e.g. 1000"
                      className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-amber-300 font-mono font-bold"
                      required
                    />
                    {manualOutAvailable !== null && (
                      <p className="mt-1 text-[10px] text-cyan-300">
                        Available now: {manualOutAvailable} {getQuantityUnit(outComponentType)}
                      </p>
                    )}
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
                      exportPDF(
                        "Warehouse Stock OUT Log",
                        ["Party", "Product", "Component", "Quantity", "Remarks", "Timestamp"],
                        filteredStockOutLogs.map((l) => [l.party_name, l.product_name || "N/A", l.component_type.toUpperCase(), `${l.quantity} ${getQuantityUnit(l.component_type)}`, l.remarks, new Date(l.created_at).toLocaleString()])
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
                          <td className="p-3 text-indigo-300">{formatStockInComponent(log)}</td>
                          <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">{log.quantity} {getQuantityUnit(log.component_type)}</td>
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
                    onClick={() => exportExcel(getStockBalanceExportRows(), "Complete_Inventory_Balance")}
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
                          getStockBalanceComponentLabel(stock),
                          getStockBalanceCapacity(stock),
                          `${stock.quantity || 0} ${getQuantityUnit(stock.component_type)}`,
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
                          <td className="p-3 font-bold text-white">{stk.party_name || "General Party"}</td>
                          <td className="p-3 text-emerald-400">{stk.product_name || "General Product"}</td>
                          <td className="p-3 uppercase text-indigo-300">{getStockBalanceComponentLabel(stk)}</td>
                          <td className="p-3 font-mono font-bold text-amber-300 whitespace-nowrap">{stk.quantity || 0} {getQuantityUnit(stk.component_type)}</td>
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
                    <p className="text-[10px] text-cyan-300">
                      Available inventory: {getCurrentStockQuantity(
                        dispatchModalReq.party_id ?? "",
                        dispatchModalReq.product_id ?? "",
                        c.component_type
                      )} Pcs
                    </p>
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