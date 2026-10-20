"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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

interface MasterCartonOption {
  id: string;
  carton_count: number | null;
  carton_name: string | null;
  alert_threshold?: number | null;
}

const normalizeMasterCartonOption = (option: {
  id: string;
  carton_count: number | string | null;
  carton_name?: string | null;
  alert_threshold?: number | null;
}): MasterCartonOption => {
  const rawCount = String(option.carton_count ?? "").trim();
  const numericCount = /^\d+$/.test(rawCount) ? Number(rawCount) : null;
  return {
    id: option.id,
    carton_count: numericCount !== null && Number.isSafeInteger(numericCount) && numericCount > 0
      ? numericCount
      : null,
    carton_name: option.carton_name?.trim() || (rawCount && numericCount === null ? rawCount : null),
    alert_threshold: option.alert_threshold ?? null,
  };
};

const getMasterCartonOptionLabel = (option: MasterCartonOption) =>
  option.carton_name || `Carton #${option.carton_count}`;

interface MasterCartonProductSetting {
  carton_count: number;
  carton_pcs: number | null;
}

const isMissingCartonPcsColumnError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = `${details.message ?? ""} ${details.details ?? ""}`.toLowerCase();
  return (
    (details.code === "42703" || message.includes("schema cache")) &&
    message.includes("carton_pcs")
  );
};

const isMissingCartonNameColumnError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = `${details.message ?? ""} ${details.details ?? ""}`.toLowerCase();
  return (
    message.includes("carton_name") &&
    (details.code === "42703" ||
      details.code === "PGRST204" ||
      message.includes("schema cache") ||
      message.includes("does not exist"))
  );
};

const isCartonPcsMigrationRequiredError = (error: unknown) => {
  if (isMissingCartonPcsColumnError(error)) return true;
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes("pcs per carton cannot be saved yet");
};

const cartonPcsMigrationMessage =
  "Pcs per carton cannot be saved yet. Apply supabase/migrations/20261025000000_add_master_carton_pcs_per_product.sql in Supabase first.";

const getMasterCartonErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const details = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const message = typeof details.message === "string" ? details.message : "";
    const code = typeof details.code === "string" ? ` (${details.code})` : "";
    const extra = typeof details.details === "string" ? ` ${details.details}` : "";
    const hint = typeof details.hint === "string" ? ` Hint: ${details.hint}` : "";
    if (message || extra || hint) return `${message}${code}${extra}${hint}`.trim();
  }
  return fallback;
};

const getDefaultWarehousePartyId = (partyList: Party[]) =>
  partyList.find((party) => party.name.trim().toLowerCase() === "nigehban")?.id ??
  partyList.find((party) => party.name.toLowerCase().includes("nigehban"))?.id ??
  "";

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
  weight_10_pcs_grams: number;
}

interface ProductBomRow {
  component_type?: string | null;
  component_name?: string | null;
  ml_capacity?: number | null;
  capacity_unit?: "ML" | "GM" | null;
  weight_10_pcs_grams?: number | null;
  qty_per_unit?: number | null;
  quantity?: number | null;
}

interface InventoryRow {
  component_type?: string | null;
  product_id?: string | null;
  quantity?: number | null;
}

interface WarehousePackagingStock {
  component_type: string;
  quantity: number;
  carton_count?: number | null;
  carton_name?: string | null;
}

interface WarehousePackagingStockRow {
  component_type: string | null;
  quantity: number | null;
  product_id: string | null;
  carton_count: number | null;
  carton_name?: string | null;
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
  master_carton_warehouse?: string | null;
  master_carton_warehouse_party_id?: string | null;
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

const getRequiredMasterCartonCount = (request: FillingRequest) =>
  request.master_cartons_required ??
  (request.master_carton_pcs && request.master_carton_pcs > 0 && request.pcs_requested > 0
    ? Math.ceil(request.pcs_requested / request.master_carton_pcs)
    : null);

const omitAllocationSourceFields = (request: FillingRequest) => {
  const visibleRequest = { ...request };
  delete visibleRequest.plan_pcs;
  delete visibleRequest.nigehban_pcs;
  delete visibleRequest.source_warehouse;
  delete visibleRequest.source_warehouse_party_id;
  return visibleRequest;
};

export default function FillingInchargePage() {
  const [partiesList, setPartiesList] = useState<Party[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [masterCartonOptions, setMasterCartonOptions] = useState<MasterCartonOption[]>([]);
  const [masterCartonOptionsError, setMasterCartonOptionsError] = useState<string | null>(null);
  const [fillingRequests, setFillingRequests] = useState<FillingRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [masterCartonSettingExists, setMasterCartonSettingExists] = useState(false);
  const [masterCartonSettingLoading, setMasterCartonSettingLoading] = useState(false);
  const [masterCartonSettingError, setMasterCartonSettingError] = useState<string | null>(null);
  const cartonLookupSequence = useRef(0);

  const [batchNo, setBatchNo] = useState<string>("BATCH-");
  const [mfgDate, setMfgDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [expDate, setExpDate] = useState<string>("");
  const [retailPrice, setRetailPrice] = useState<string>("");
  const [productPackSize, setProductPackSize] = useState<number | null>(null);
  const [productPackUnit, setProductPackUnit] = useState<"ML" | "GM">("ML");
  const [roomNumber, setRoomNumber] = useState("");
  const [masterCartonCount, setMasterCartonCount] = useState("");
  const [selectedMasterCartonName, setSelectedMasterCartonName] = useState("");
  const [masterCartonPcs, setMasterCartonPcs] = useState("");
  const [masterCartonWarehousePartyId, setMasterCartonWarehousePartyId] = useState("");

  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [pcsRequested, setPcsRequested] = useState<string>("");
  const [requiredDate, setRequiredDate] = useState<string>(new Date().toISOString().split("T")[0]);

  const [productBomPreview, setProductBomPreview] = useState<BomComponentRequirement[]>([]);
  const [warehousePackagingStock, setWarehousePackagingStock] = useState<WarehousePackagingStock[]>([]);
  const [warehousePackagingStockError, setWarehousePackagingStockError] = useState<string | null>(null);
  const [warehousePackagingStockNotice, setWarehousePackagingStockNotice] = useState<string | null>(null);
  const [warehouseCartonNameColumnAvailable, setWarehouseCartonNameColumnAvailable] = useState(true);
  const [warehousePackagingStockLoading, setWarehousePackagingStockLoading] = useState(false);
  const [stockErrorMsg, setStockErrorMsg] = useState<string | null>(null);
  const [maxPossiblePcs, setMaxPossiblePcs] = useState<number | null>(null);
  const [selectedRequestForModal, setSelectedRequestForModal] = useState<FillingRequest | null>(null);
  const packagingStockLookupSequence = useRef(0);

  const [filterPartyName, setFilterPartyName] = useState("");
  const [filterProductName, setFilterProductName] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  const fetchLiveSupabaseData = useCallback(async () => {
    try {
      const { data: partyData, error: partyError } = await supabase.from("parties").select("*");
      if (partyError) throw partyError;
      if (partyData) {
        setPartiesList(partyData);
        const defaultWarehouseId = getDefaultWarehousePartyId(partyData);
        setMasterCartonWarehousePartyId((current) => current || defaultWarehouseId);
      }

      const { data: prodData, error: productsError } = await supabase.from("products").select("*");
      if (productsError) throw productsError;
      if (prodData) setProductsList(prodData);

      const { data: cartonOptions, error: cartonOptionsError } = await supabase
        .from("master_carton_options")
        .select("id, carton_count, carton_name, alert_threshold")
        .order("carton_count");
      if (cartonOptionsError) {
        if (isMissingCartonNameColumnError(cartonOptionsError)) {
          const legacyOptions = await supabase
            .from("master_carton_options")
            .select("id, carton_count, alert_threshold")
            .order("carton_count");
          if (legacyOptions.error) {
            setMasterCartonOptionsError(legacyOptions.error.message);
            console.error("Master Carton options fetch error:", legacyOptions.error.message);
          } else {
            setMasterCartonOptions(
              (legacyOptions.data ?? []).map((option) =>
                normalizeMasterCartonOption({ ...option, carton_name: null })
              )
            );
            setMasterCartonOptionsError(null);
          }
        } else {
          setMasterCartonOptionsError(cartonOptionsError.message);
          console.error("Master Carton options fetch error:", cartonOptionsError.message);
        }
      } else {
        setMasterCartonOptionsError(null);
        setMasterCartonOptions((cartonOptions ?? []).map(normalizeMasterCartonOption));
      }

      const { data: reqData, error: reqErr } = await supabase
        .from("filling_requests")
        .select("*");
      if (reqErr) throw reqErr;
      if (reqData) setFillingRequests(reqData as FillingRequest[]);
    } catch (error) {
      console.error("Could not refresh filling page data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(fetchLiveSupabaseData);
  }, [fetchLiveSupabaseData]);

  useEffect(() => {
    const lookupSequence = ++packagingStockLookupSequence.current;
    if (!selectedProductId || !masterCartonWarehousePartyId) {
      return;
    }

    let disposed = false;
    let requestSequence = 0;
    const fetchWarehousePackagingStock = async () => {
      const requestId = ++requestSequence;
      setWarehousePackagingStockLoading(true);
      setWarehousePackagingStockError(null);
      setWarehousePackagingStockNotice(null);
      try {
        const stockResult = await supabase
          .from("inventory")
          .select("component_type, quantity, product_id, carton_count, carton_name")
          .eq("party_id", masterCartonWarehousePartyId);
        let data = stockResult.data as WarehousePackagingStockRow[] | null;
        let error = stockResult.error;
        let cartonNameColumnAvailable = true;
        if (isMissingCartonNameColumnError(error)) {
          const legacyResult = await supabase
            .from("inventory")
            .select("component_type, quantity, product_id, carton_count")
            .eq("party_id", masterCartonWarehousePartyId);
          data = legacyResult.data as WarehousePackagingStockRow[] | null;
          error = legacyResult.error;
          cartonNameColumnAvailable = false;
        }
        if (error) throw error;
        if (disposed || lookupSequence !== packagingStockLookupSequence.current || requestId !== requestSequence) return;
        if (!cartonNameColumnAvailable) {
          setWarehouseCartonNameColumnAvailable(false);
          setWarehousePackagingStockNotice(
            "Supabase migration 20261029000000_add_named_master_carton_stock.sql is needed to separate cartons by name. Showing the total master-carton stock for this product."
          );
        } else {
          setWarehouseCartonNameColumnAvailable(true);
        }

        const productRows = ((data ?? []) as WarehousePackagingStockRow[]).filter(
          (row) => row.product_id === selectedProductId || !row.product_id
        );
        const stockByComponentAndNumber = new Map<string, WarehousePackagingStock>();
        for (const row of productRows) {
          const componentType = String(row.component_type ?? "").trim().toLowerCase();
          if (!componentType) continue;
          const cartonCount = row.carton_count == null ? null : Number(row.carton_count);
          const cartonName = typeof row.carton_name === "string" ? row.carton_name.trim() : "";
          const key = `${componentType}:${cartonCount ?? "unspecified"}:${cartonName.toLowerCase()}`;
          const existing = stockByComponentAndNumber.get(key);
          stockByComponentAndNumber.set(key, {
            component_type: componentType,
            carton_count: cartonCount,
            carton_name: cartonName || null,
            quantity: (existing?.quantity ?? 0) + (Number(row.quantity) || 0),
          });
        }
        setWarehousePackagingStock(Array.from(stockByComponentAndNumber.values()));
      } catch (error) {
        if (disposed || lookupSequence !== packagingStockLookupSequence.current || requestId !== requestSequence) return;
        console.error("Could not load warehouse packaging stock:", error);
        setWarehousePackagingStockError(
          getMasterCartonErrorMessage(error, "Could not load carton and tape stock from this warehouse.")
        );
      } finally {
        if (!disposed && lookupSequence === packagingStockLookupSequence.current && requestId === requestSequence) {
          setWarehousePackagingStockLoading(false);
        }
      }
    };

    void fetchWarehousePackagingStock();
    const inventoryChannel = supabase
      .channel(`filling-packaging-stock-${masterCartonWarehousePartyId}-${selectedProductId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, () => {
        void fetchWarehousePackagingStock();
      })
      .subscribe();
    const refreshInterval = window.setInterval(() => {
      void fetchWarehousePackagingStock();
    }, 10000);

    return () => {
      disposed = true;
      window.clearInterval(refreshInterval);
      void supabase.removeChannel(inventoryChannel);
      packagingStockLookupSequence.current += 1;
    };
  }, [masterCartonWarehousePartyId, selectedProductId]);

  // 100% DYNAMIC LIVE STOCK FETCHING FROM SUPABASE INVENTORY TABLE
  const handleProductSelection = async (prodId: string) => {
    const lookupSequence = ++cartonLookupSequence.current;
    setSelectedProductId(prodId);
    setStockErrorMsg(null);
    setPcsRequested("");
    setProductBomPreview([]);
    setProductPackSize(null);
    setProductPackUnit("ML");
    setWarehousePackagingStock([]);
    setWarehousePackagingStockError(null);
    setWarehousePackagingStockNotice(null);
    setWarehouseCartonNameColumnAvailable(true);
    setWarehousePackagingStockLoading(false);
    setMasterCartonCount("");
    setSelectedMasterCartonName("");
    setMasterCartonPcs("");
    setMasterCartonSettingExists(false);
    setMasterCartonSettingError(null);
    setMasterCartonSettingLoading(Boolean(prodId));

    if (!prodId || !selectedPartyId) {
      setMasterCartonSettingLoading(false);
      return;
    }

    try {
      try {
        const { data: cartonSetting, error: cartonSettingError } = await supabase
          .from("master_carton_product_settings")
          .select("carton_count, carton_pcs")
          .eq("product_id", prodId)
          .maybeSingle();
        let setting = cartonSetting;
        if (cartonSettingError && isMissingCartonPcsColumnError(cartonSettingError)) {
          const { data, error } = await supabase
            .from("master_carton_product_settings")
            .select("carton_count")
            .eq("product_id", prodId)
            .maybeSingle();
          if (error) throw error;
          setting = data ? { ...data, carton_pcs: null } : null;
        } else if (cartonSettingError) {
          throw cartonSettingError;
        }
        if (lookupSequence === cartonLookupSequence.current) {
          setMasterCartonCount(setting ? String(setting.carton_count) : "");
          setMasterCartonPcs(setting?.carton_pcs == null ? "" : String(setting.carton_pcs));
          setMasterCartonSettingExists(Boolean(setting));
        }
      } catch (err) {
        if (lookupSequence === cartonLookupSequence.current) {
          setMasterCartonSettingError(
            getMasterCartonErrorMessage(err, "Could not load this product's master carton count.")
          );
        }
      }

      // 1. Fetch Product BOM Breakdown
      const { data: bomData, error: bomError } = await supabase
        .from("product_bom")
        .select("*")
        .eq("product_id", prodId);
      if (bomError) throw bomError;
      if (lookupSequence !== cartonLookupSequence.current) return;
      const bomRows = (bomData ?? []) as ProductBomRow[];
      const packSizeBom = bomData?.find(
        (item) => item.component_type?.toLowerCase() === "bottle" && Number(item.ml_capacity) > 0
      ) ?? bomData?.find(
        (item) => item.component_type?.toLowerCase() === "tube" && Number(item.ml_capacity) > 0
      ) ?? bomData?.find((item) => Number(item.ml_capacity) > 0);
      if (packSizeBom) {
        setProductPackSize(Number(packSizeBom.ml_capacity));
        setProductPackUnit(packSizeBom.capacity_unit === "GM" ? "GM" : "ML");
      }

      // 2. Fetch Live Inventory from DB for the selected Party & Product
      const { data: invData, error: inventoryError } = await supabase
        .from("inventory")
        .select("*")
        .eq("party_id", selectedPartyId);
      if (inventoryError) throw inventoryError;
      if (lookupSequence !== cartonLookupSequence.current) return;
      const inventoryRows = (invData ?? []) as InventoryRow[];

      if (bomRows.length > 0) {
        const previewList: BomComponentRequirement[] = bomRows.map((item) => {
          const compType = (item.component_type || item.component_name || "component").trim().toLowerCase();
          const liveStock = inventoryRows
            .filter((inv) =>
              inv.component_type?.trim().toLowerCase() === compType &&
              (inv.product_id === prodId || !inv.product_id)
            )
            .reduce((total, inv) => total + (Number(inv.quantity) || 0), 0);

          return {
            component_type: compType,
            qty_per_unit: Number(item.qty_per_unit ?? item.quantity) > 0
              ? Number(item.qty_per_unit ?? item.quantity)
              : 1,
            available_stock: liveStock, // Live Dynamic Value from DB
            weight_10_pcs_grams: Number(item.weight_10_pcs_grams) || 0,
          };
        });
        setProductBomPreview(previewList);
      } else {
        // Fallback with 0 stock if no BOM is configured
        setProductBomPreview([
          { component_type: "bottle", qty_per_unit: 1, available_stock: 0, weight_10_pcs_grams: 0 },
          { component_type: "cap", qty_per_unit: 1, available_stock: 0, weight_10_pcs_grams: 0 },
          { component_type: "nozzle", qty_per_unit: 1, available_stock: 0, weight_10_pcs_grams: 0 },
          { component_type: "seal", qty_per_unit: 1, available_stock: 0, weight_10_pcs_grams: 0 },
          { component_type: "carton", qty_per_unit: 0.1, available_stock: 0, weight_10_pcs_grams: 0 },
        ]);
      }
    } catch (err) {
      if (lookupSequence === cartonLookupSequence.current) {
        console.error("Error fetching live stock:", err);
        setMasterCartonSettingError(getMasterCartonErrorMessage(err, "Could not load product BOM and inventory."));
      }
    } finally {
      if (lookupSequence === cartonLookupSequence.current) {
        setMasterCartonSettingLoading(false);
      }
    }
  };

  const persistMasterCartonSetting = async (
    productId: string,
    cartonCount: number,
    cartonPcs?: number | null
  ) => {
    const payload: { product_id: string; carton_count: number; carton_pcs?: number | null } = {
      product_id: productId,
      carton_count: cartonCount,
    };
    if (cartonPcs !== undefined) payload.carton_pcs = cartonPcs;

    const { data, error } = await supabase
      .from("master_carton_product_settings")
      .insert(payload)
      .select("carton_count, carton_pcs")
      .single();
    if (!error && data) return data as MasterCartonProductSetting;
    if (isMissingCartonPcsColumnError(error)) {
      if (cartonPcs !== undefined) throw new Error(cartonPcsMigrationMessage);
      const { data: countOnlyData, error: countOnlyError } = await supabase
        .from("master_carton_product_settings")
        .insert({ product_id: productId, carton_count: cartonCount })
        .select("carton_count")
        .single();
      if (!countOnlyError && countOnlyData) {
        return { carton_count: countOnlyData.carton_count, carton_pcs: null };
      }
    }

    const { data: existingSetting, error: lookupError } = await supabase
      .from("master_carton_product_settings")
      .select("carton_count, carton_pcs")
      .eq("product_id", productId)
      .maybeSingle();
    let existing = existingSetting;
    if (lookupError && isMissingCartonPcsColumnError(lookupError)) {
      const { data, error } = await supabase
        .from("master_carton_product_settings")
        .select("carton_count")
        .eq("product_id", productId)
        .maybeSingle();
      if (error) throw error;
      existing = data ? { ...data, carton_pcs: null } : null;
    } else if (lookupError) {
      throw lookupError;
    }
    if (existing) {
      const update: { carton_count: number; carton_pcs?: number | null; updated_at: string } = {
        carton_count: existing.carton_count,
        updated_at: new Date().toISOString(),
      };
      if (cartonPcs !== undefined) update.carton_pcs = cartonPcs;
      const { data: updatedSetting, error: updateError } = await supabase
        .from("master_carton_product_settings")
        .update(update)
        .eq("product_id", productId)
        .select("carton_count, carton_pcs")
        .single();
      if (isMissingCartonPcsColumnError(updateError) && cartonPcs !== undefined) {
        throw new Error(cartonPcsMigrationMessage);
      }
      if (isMissingCartonPcsColumnError(updateError)) {
        const { data: countOnlyData, error: countOnlyError } = await supabase
          .from("master_carton_product_settings")
          .update({ carton_count: update.carton_count, updated_at: update.updated_at })
          .eq("product_id", productId)
          .select("carton_count")
          .single();
        if (countOnlyError) throw countOnlyError;
        if (!countOnlyData) throw new Error("The database did not return the saved carton count.");
        return { carton_count: countOnlyData.carton_count, carton_pcs: null };
      }
      if (updateError) throw updateError;
      if (!updatedSetting) throw new Error("The database did not return the saved carton settings.");
      return updatedSetting as MasterCartonProductSetting;
    }
    if (error) throw error;
    throw new Error("The database did not return the saved carton settings.");
  };

  const handleSaveInitialMasterCartonCount = async () => {
    if (
      !selectedProductId ||
      masterCartonSettingExists ||
      !Number(masterCartonCount) ||
      masterCartonSettingLoading
    ) return;

    const trimmedCartonCount = String(masterCartonCount).trim();
    if (!trimmedCartonCount) {
      setMasterCartonSettingError("Please select a valid Master Carton option.");
      return;
    }

    setMasterCartonSettingLoading(true);
    setMasterCartonSettingError(null);
    try {
      const cartonPcs = masterCartonPcs === "" ? undefined : Number(masterCartonPcs);
      if (cartonPcs !== undefined && (!Number.isSafeInteger(cartonPcs) || cartonPcs <= 0)) {
        setMasterCartonSettingError("Enter a whole number of pcs per carton greater than zero.");
        return;
      }
      const cartonCount = Number(trimmedCartonCount);
      if (!Number.isSafeInteger(cartonCount) || cartonCount <= 0) {
        setMasterCartonSettingError("Please select a valid Master Carton option.");
        return;
      }
      const savedSetting = await persistMasterCartonSetting(selectedProductId, cartonCount, cartonPcs);
      if (String(savedSetting.carton_count) !== trimmedCartonCount) setMasterCartonCount(String(savedSetting.carton_count));
      if (savedSetting.carton_pcs != null) setMasterCartonPcs(String(savedSetting.carton_pcs));
      setMasterCartonSettingExists(true);
    } catch (err) {
      if (!isCartonPcsMigrationRequiredError(err)) {
        console.error("Could not save product master carton option:", err);
      }
      setMasterCartonSettingError(
        getMasterCartonErrorMessage(err, "Could not save this product's master carton option.")
      );
    } finally {
      setMasterCartonSettingLoading(false);
    }
  };

  const handleSaveMasterCartonPcs = async () => {
    if (!selectedProductId || !masterCartonSettingExists || masterCartonPcs === "" || masterCartonSettingLoading) return;
    const cartonPcs = Number(masterCartonPcs);
    const cartonCount = Number(masterCartonCount);
    if (!Number.isSafeInteger(cartonPcs) || cartonPcs <= 0) {
      setMasterCartonSettingError("Enter a whole number of pcs per carton greater than zero.");
      return;
    }
    if (!Number.isSafeInteger(cartonCount) || cartonCount <= 0) {
      setMasterCartonSettingError("Select a valid master carton count before saving pcs per carton.");
      return;
    }

    setMasterCartonSettingLoading(true);
    setMasterCartonSettingError(null);
    try {
      const savedSetting = await persistMasterCartonSetting(selectedProductId, cartonCount, cartonPcs);
      setMasterCartonCount(String(savedSetting.carton_count));
      setMasterCartonPcs(savedSetting.carton_pcs == null ? "" : String(savedSetting.carton_pcs));
    } catch (error) {
      if (!isCartonPcsMigrationRequiredError(error)) {
        console.error("Could not save pcs per master carton:", error);
      }
      setMasterCartonSettingError(
        getMasterCartonErrorMessage(error, "Could not save pcs per master carton.")
      );
    } finally {
      setMasterCartonSettingLoading(false);
    }
  };

  const handleQuantityChange = (qtyVal: string) => {
    setPcsRequested(qtyVal);
    setStockErrorMsg(null);
    setMaxPossiblePcs(null);

    if (!qtyVal) return;
    const qty = Number(qtyVal);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      setStockErrorMsg("Quantity must be a whole number greater than zero.");
      return;
    }
    if (productBomPreview.length === 0) return;

    const shortages: string[] = [];
    let minAllowed = qty;

    productBomPreview.forEach((comp) => {
      const requiredTotal = qty * comp.qty_per_unit;
      if (comp.available_stock < requiredTotal) {
        const diff = requiredTotal - comp.available_stock;
        shortages.push(`${diff} Pcs ${comp.component_type.toUpperCase()}s कम हैं`);
        const possibleForThisComp = Math.floor(comp.available_stock / comp.qty_per_unit);
        if (possibleForThisComp < minAllowed) {
          minAllowed = possibleForThisComp;
        }
      }
    });

    if (shortages.length > 0) {
      setMaxPossiblePcs(minAllowed);
      setStockErrorMsg(
        `आप अभी मैक्सिमम ${minAllowed} Pcs का ऑर्डर लगा सकते हैं! (${shortages.join(", ")})`
      );
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPartyId || !selectedProductId || !pcsRequested || !batchNo || !expDate || !retailPrice || !roomNumber) {
      return alert("Please fill all required fields including Batch No, Expiry Date, Retail Price, and Room.");
    }
    const qty = Number(pcsRequested);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      return alert("Quantity must be a whole number greater than zero.");
    }

    if (stockErrorMsg) {
      return alert(`Order Cannot Be Processed!\n\n${stockErrorMsg}`);
    }

    const cartonCount = masterCartonCount === "" ? null : Number(masterCartonCount);
    const cartonPcs = masterCartonPcs === "" ? null : Number(masterCartonPcs);
    if (
      (cartonCount !== null && (!Number.isSafeInteger(cartonCount) || cartonCount <= 0)) ||
      (cartonPcs !== null && (!Number.isSafeInteger(cartonPcs) || cartonPcs <= 0))
    ) {
      return alert("Enter whole numbers greater than zero for carton values.");
    }

    setLoading(true);
    try {
      let savedCartonCount = cartonCount;
      if (
        cartonCount !== null &&
        (!masterCartonSettingExists || cartonPcs !== null)
      ) {
        const savedSetting = await persistMasterCartonSetting(selectedProductId, cartonCount, cartonPcs);
        savedCartonCount = savedSetting.carton_count;
        setMasterCartonCount(String(savedSetting.carton_count));
        if (savedSetting.carton_pcs != null) setMasterCartonPcs(String(savedSetting.carton_pcs));
        setMasterCartonSettingExists(true);
      }

      const partyObj = partiesList.find((p) => p.id === selectedPartyId);
      const prodObj = productsList.find((p) => p.id === selectedProductId);
      const masterCartonWarehouseParty = partiesList.find((p) => p.id === masterCartonWarehousePartyId);
      const qty = Number(pcsRequested);
      const resolvedCartonPcs = cartonPcs ?? (Number.isFinite(qty) && qty > 0 && Number.isFinite(Number(masterCartonPcs)) && Number(masterCartonPcs) > 0 ? Number(masterCartonPcs) : null);
      const effectiveCartonCount =
        savedCartonCount ??
        (resolvedCartonPcs && qty > 0 ? Math.ceil(qty / resolvedCartonPcs) : null);
      const requiredMasterCartons =
        resolvedCartonPcs && qty > 0 ? Math.ceil(qty / resolvedCartonPcs) : null;

      const generatedComponents: ComponentWeightItem[] = productBomPreview.map((comp) => ({
        component_type: comp.component_type,
        pcs_requested: qty * comp.qty_per_unit,
        weight_10_pcs_grams: comp.weight_10_pcs_grams,
        theoretical_weight_kg: (qty * comp.qty_per_unit * comp.weight_10_pcs_grams) / 10000,
      }));

      const totalWeight = generatedComponents.reduce((sum, c) => sum + c.theoretical_weight_kg, 0);

      const payload: Record<string, unknown> = {
        batch_no: batchNo,
        req_code: batchNo,
        mfg_date: mfgDate,
        exp_date: expDate,
        retail_price: parseFloat(retailPrice) || 0,
        pack_size: productPackSize,
        pack_unit: productPackUnit,
        room_number: Number(roomNumber),
        master_carton_count: effectiveCartonCount,
        master_carton_pcs: resolvedCartonPcs,
        master_cartons_required: requiredMasterCartons,
        master_carton_warehouse: masterCartonWarehouseParty?.name ?? null,
        master_carton_warehouse_party_id: masterCartonWarehouseParty?.id ?? null,
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

      if (
        res.error &&
        (res.error.message ?? "").includes("master_cartons_required")
      ) {
        delete payload.master_cartons_required;
        res = await supabase.from("filling_requests").insert([payload]);
      }

      if (res.error && res.error.message?.includes("components")) {
        delete payload.components;
        res = await supabase.from("filling_requests").insert([payload]);
      }

      if (res.error) throw res.error;

      alert(`Filling Requisition (Batch: ${batchNo}) Saved Successfully!`);

      void fetchLiveSupabaseData();

      setSelectedPartyId("");
      setSelectedProductId("");
      setRoomNumber("");
      setMasterCartonCount("");
      setMasterCartonSettingExists(false);
      setMasterCartonSettingError(null);
      setMasterCartonPcs("");
      const defaultWarehouseId = getDefaultWarehousePartyId(partiesList);
      setMasterCartonWarehousePartyId(defaultWarehouseId);
      setPcsRequested("");
      setRetailPrice("");
      setExpDate("");
      setStockErrorMsg(null);
      setProductBomPreview([]);
      setProductPackSize(null);
      setProductPackUnit("ML");
      setBatchNo("BATCH-");
    } catch (err) {
      alert("Database Save Error: " + getMasterCartonErrorMessage(err, "Could not save the filling request."));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReceived = async (reqId: string) => {
    if (!confirm("Have you verified the weight of the entire material received from the warehouse?")) return;

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
    } catch (err) {
      alert("Update Error: " + getMasterCartonErrorMessage(err, "Could not confirm receipt."));
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = (data: Record<string, unknown>[], fileName: string) => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    XLSX.writeFile(workbook, `${fileName}_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const exportPDFWithLogo = async (title: string, headers: string[], body: (string | number)[][]) => {
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
    } catch {
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

  const requestedQty = Number(pcsRequested);
  const enteredPcsPerCarton = Number(masterCartonPcs);
  const computedCartonQty =
    Number.isFinite(requestedQty) && requestedQty > 0 && Number.isFinite(enteredPcsPerCarton) && enteredPcsPerCarton > 0
      ? Math.ceil(requestedQty / enteredPcsPerCarton)
      : null;
  const masterCartonWarehouseParty = partiesList.find((p) => p.id === masterCartonWarehousePartyId);
  const autoCartonSummary =
    computedCartonQty !== null
      ? {
        cartons: computedCartonQty,
        pcsPerCarton: enteredPcsPerCarton,
        masterWarehouse: masterCartonWarehouseParty?.name ?? "Not selected",
      }
      : null;
  const selectedMasterCartonThreshold =
    Number(masterCartonCount) > 0
      ? masterCartonOptions.find((option) => option.carton_count === Number(masterCartonCount))?.alert_threshold ?? null
      : computedCartonQty !== null
        ? masterCartonOptions.find((option) => option.carton_count === computedCartonQty)?.alert_threshold ?? null
        : null;
  const selectedMasterCartonAlert =
    selectedMasterCartonThreshold !== null &&
    Number(masterCartonCount || computedCartonQty || 0) <= selectedMasterCartonThreshold &&
    Number(masterCartonCount || computedCartonQty || 0) > 0;
  const getWarehouseComponentStock = (matches: (componentType: string) => boolean) =>
    warehousePackagingStock
      .filter((item) => matches(item.component_type.trim().toLowerCase().replace(/[\s-]+/g, "_")))
      .reduce((total, item) => total + item.quantity, 0);
const trimmedMasterCartonCount = String(masterCartonCount ?? "").trim();
  const trimmedMasterCartonName = selectedMasterCartonName.trim().toLowerCase();
  const selectedProductName = productsList
    .find((product) => product.id === selectedProductId)
    ?.product_name.trim().toLowerCase();
  const masterCartonInventoryRows = warehousePackagingStock.filter((item) => {
    const compType = String(item.component_type ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return ["carton", "cartons", "master_carton", "master_cartons", "master_carton_box", "master_carton_boxes"].includes(compType);
  });
  const selectedNamedCartonRows = masterCartonInventoryRows.filter((item) => {
    const itemCartonName = item.carton_name?.trim().toLowerCase() ?? "";
    return itemCartonName && (
      itemCartonName === trimmedMasterCartonName ||
      itemCartonName === trimmedMasterCartonCount.toLowerCase() ||
      itemCartonName === selectedProductName
    );
  });
  const legacyNamedCartonRows = masterCartonInventoryRows.filter((item) =>
    !item.carton_name?.trim() &&
    ["", "1"].includes(String(item.carton_count ?? "").trim())
  );
  const masterCartonStockRows = !warehouseCartonNameColumnAvailable
    ? masterCartonInventoryRows
    : trimmedMasterCartonName
      ? selectedNamedCartonRows.length > 0
        ? selectedNamedCartonRows
        : legacyNamedCartonRows
      : masterCartonInventoryRows.filter((item) => {
        const itemCartonCount = String(item.carton_count ?? "").trim().toLowerCase();
        return !itemCartonCount || itemCartonCount === trimmedMasterCartonCount.toLowerCase();
      });
  const masterCartonStock = masterCartonStockRows
    .reduce((total, item) => total + (Number(item.quantity) || 0), 0);
  const usingLegacyNamedCartonStock =
    warehouseCartonNameColumnAvailable &&
    Boolean(trimmedMasterCartonName) &&
    selectedNamedCartonRows.length === 0 &&
    legacyNamedCartonRows.length > 0;
  const tapeStock = getWarehouseComponentStock((componentType) => componentType === "tape" || componentType.endsWith("_tape"));
  const tapeBomRequirement = productBomPreview.find((component) => {
    const normalizedType = component.component_type.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return normalizedType === "tape" || normalizedType.endsWith("_tape");
  });
  const requestedTapeQuantity =
    tapeBomRequirement && Number.isFinite(requestedQty) && requestedQty > 0
      ? requestedQty * tapeBomRequirement.qty_per_unit
      : null;
  const masterCartonShortage =
    computedCartonQty !== null ? Math.max(0, computedCartonQty - masterCartonStock) : null;
  const tapeShortage =
    requestedTapeQuantity !== null ? Math.max(0, requestedTapeQuantity - tapeStock) : null;

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
          onClick={() => {
            setLoading(true);
            void fetchLiveSupabaseData();
          }}
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
                <button
                  type="button"
                  onClick={() => setBatchNo(`BATCH-${Math.floor(1000 + Math.random() * 9000)}`)}
                  className="mt-1 text-[10px] text-amber-300 hover:text-amber-200"
                >
                  Generate batch number
                </button>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Select Party / Company</label>
                <select
                  value={selectedPartyId}
                  onChange={(e) => {
                    setSelectedPartyId(e.target.value);
                    setSelectedProductId("");
                    cartonLookupSequence.current += 1;
                    setWarehousePackagingStock([]);
                    setWarehousePackagingStockError(null);
                    setWarehousePackagingStockLoading(false);
                    setMasterCartonCount("");
                    setMasterCartonPcs("");
                    setMasterCartonSettingExists(false);
                    setMasterCartonSettingLoading(false);
                    setMasterCartonSettingError(null);
                    setProductBomPreview([]);
                    setProductPackSize(null);
                    setProductPackUnit("ML");
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
                {selectedProductId && (
                  <p className="mt-1 text-[10px] text-cyan-300">
                    Pack size: {productPackSize ? `${productPackSize} ${productPackUnit}` : "Not set in product BOM"}
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs text-cyan-400 block mb-1">Room</label>
                <select
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                  required
                >
                  <option value="">-- Select Room --</option>
                  {[1, 2, 3, 4, 5, 6].map((room) => (
                    <option key={room} value={room}>Room {room}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-amber-400 block mb-1">Quantity Requested (Pcs)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
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

            {autoCartonSummary && (
              <div className="bg-[#0b0f19] border border-emerald-700/50 rounded-xl p-3 text-xs text-slate-200 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">
                  Auto Carton / Warehouse Summary
                </div>
                <div className="text-sm font-bold text-emerald-300">
                  {autoCartonSummary.cartons} master carton(s) required for {requestedQty.toLocaleString()} pcs
                </div>
                <div>
                  Approximate Pcs per carton: <span className="font-bold text-white">{autoCartonSummary.pcsPerCarton}</span>
                </div>
                <div>
                  Master carton warehouse: <span className="font-bold text-white">{autoCartonSummary.masterWarehouse}</span>
                </div>
                {selectedMasterCartonThreshold !== null && (
                  <div className={`mt-2 rounded-lg border px-2 py-1.5 ${selectedMasterCartonAlert ? "border-rose-500/50 bg-rose-500/10 text-rose-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
                    {selectedMasterCartonAlert
                      ? `ALERT: Remaining cartons are at or below ${selectedMasterCartonThreshold}. Admin and warehouse team must be notified.`
                      : `Alert threshold set: if remaining cartons fall to ${selectedMasterCartonThreshold} or below, admin/warehouse will be alerted.`}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-cyan-400 block mb-1">Master Carton</label>
                <select
                  value={
                    masterCartonOptions.find((option) =>
                      selectedMasterCartonName
                        ? option.carton_name?.toLowerCase() === selectedMasterCartonName.toLowerCase()
                        : option.carton_count !== null && String(option.carton_count) === masterCartonCount
                    )?.id ?? (masterCartonSettingExists && masterCartonCount ? `saved:${masterCartonCount}` : "")
                  }
                  onChange={(event) => {
                    const option = masterCartonOptions.find((item) => item.id === event.target.value);
                    setMasterCartonSettingError(null);
                    if (!option) {
                      setSelectedMasterCartonName("");
                      setMasterCartonCount("");
                    } else if (option.carton_name) {
                      setSelectedMasterCartonName(option.carton_name);
                      setMasterCartonCount("");
                    } else {
                      setSelectedMasterCartonName("");
                      setMasterCartonCount(String(option.carton_count));
                    }
                  }}
                  onBlur={handleSaveInitialMasterCartonCount}
                  disabled={!selectedProductId || masterCartonSettingLoading || masterCartonSettingExists}
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                >
                  <option value="">
                    {selectedProductId ? "-- Select Master Carton Option --" : "-- Select a product first --"}
                  </option>
                  {masterCartonSettingExists &&
                    masterCartonCount &&
                    !masterCartonOptions.some((option) => String(option.carton_count) === masterCartonCount) && (
                      <option value={`saved:${masterCartonCount}`}>{masterCartonCount} cartons (saved)</option>
                    )}
                  {masterCartonOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {getMasterCartonOptionLabel(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Pcs per Master Carton</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={masterCartonPcs}
                  onChange={(event) => {
                    setMasterCartonPcs(event.target.value);
                    setMasterCartonSettingError(null);
                  }}
                  onBlur={handleSaveMasterCartonPcs}
                  disabled={!selectedProductId || masterCartonSettingLoading}
                  placeholder="Enter pcs per carton"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg p-3 text-xs text-white"
                />
                {masterCartonSettingExists && masterCartonPcs && (
                  <p className="mt-1 text-[10px] text-slate-400">
                    Saved for this product. Changes are saved when you leave this field.
                  </p>
                )}
              </div>
            </div>
            {masterCartonSettingLoading && (
              <p className="text-[10px] text-slate-400">Loading or saving carton settings...</p>
            )}
            {masterCartonSettingError && (
              <p role="alert" className="text-xs text-rose-400">{masterCartonSettingError}</p>
            )}
            {masterCartonOptionsError && (
              <p role="alert" className="text-xs text-rose-400">
                Could not load carton choices: {masterCartonOptionsError}
              </p>
            )}

            {/* LIVE DYNAMIC STOCK CARDS DISPLAY */}
            {productBomPreview.length > 0 && (
              <div className="bg-[#0b0f19] border border-slate-800 p-4 rounded-xl space-y-2">
                <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider block">
                  📋 Live Supabase Database Inventory Stock Status:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                  {productBomPreview.map((comp, idx) => (
                    <div key={idx} className="bg-[#121827] border border-slate-800/80 p-2.5 rounded-lg text-center">
                      <div className="text-[10px] text-slate-400 uppercase">{comp.component_type}</div>
                      <div className="text-xs font-mono font-bold text-white mt-0.5">
                        {pcsRequested ? Number(pcsRequested) * comp.qty_per_unit : 0} Pcs
                      </div>
                      <div className="text-[9px] text-emerald-400 font-bold mt-1">
                        Live Stock: {comp.available_stock} Pcs
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedProductId && (
              <div className="bg-[#0b0f19] border border-slate-800 p-4 rounded-xl space-y-3">
                <div>
                  <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider block">
                    Master Carton & Tape Stock
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Live stock for this product from the selected master carton warehouse.
                  </span>
                  <select
                    value={masterCartonWarehousePartyId}
                    onChange={(event) => setMasterCartonWarehousePartyId(event.target.value)}
                    aria-label="Master carton stock warehouse"
                    className="mt-2 w-full sm:max-w-sm bg-[#0b0f19] border border-slate-800 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="">-- Select Master Carton Warehouse --</option>
                    {partiesList.map((party) => (
                      <option key={party.id} value={party.id}>{party.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-cyan-300">
                    Selected warehouse: {masterCartonWarehouseParty?.name ?? "None"}
                  </p>
                </div>
                {warehousePackagingStockLoading && (
                  <p className="text-xs text-slate-400">Loading warehouse carton and tape balances...</p>
                )}
                {warehousePackagingStockError && (
                  <p className="text-xs text-rose-400">Could not check warehouse stock: {warehousePackagingStockError}</p>
                )}
                {warehousePackagingStockNotice && (
                  <p className="text-xs text-amber-300">{warehousePackagingStockNotice}</p>
                )}
                {usingLegacyNamedCartonStock && (
                  <p className="text-xs text-amber-300">
                    Showing older unlabelled carton stock for this product. Apply the named-carton migration and re-enter stock to track carton types separately.
                  </p>
                )}
                {!warehousePackagingStockLoading && !warehousePackagingStockError && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className={`rounded-lg border p-3 ${masterCartonShortage !== null && masterCartonShortage > 0 ? "border-rose-500/50 bg-rose-500/10" : "border-slate-700 bg-[#121827]"}`}>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">
                        Master Cartons{selectedMasterCartonName
                          ? ` — ${selectedMasterCartonName}`
                          : masterCartonCount ? ` — ${masterCartonCount}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-slate-200">
                        Available: <strong className="text-white">{masterCartonStock}</strong>
                        {computedCartonQty !== null
                          ? <> | Required: <strong className="text-white">{computedCartonQty}</strong></>
                          : " | Enter pcs per carton to calculate requirement"}
                      </div>
                      {masterCartonShortage !== null && masterCartonShortage > 0 && (
                        <p role="alert" className="mt-2 text-xs font-bold text-rose-300">
                          LOW STOCK: {masterCartonShortage} master carton(s) short for this requisition.
                        </p>
                      )}
                    </div>
                    <div className={`rounded-lg border p-3 ${tapeShortage !== null && tapeShortage > 0 ? "border-rose-500/50 bg-rose-500/10" : "border-slate-700 bg-[#121827]"}`}>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">Tape</div>
                      <div className="mt-1 text-xs text-slate-200">
                        Available: <strong className="text-white">{tapeStock}</strong>
                        {requestedTapeQuantity !== null
                          ? <> | Required: <strong className="text-white">{requestedTapeQuantity}</strong></>
                          : " | Required quantity is not configured in this product's BOM"}
                      </div>
                      {tapeShortage !== null && tapeShortage > 0 && (
                        <p role="alert" className="mt-2 text-xs font-bold text-rose-300">
                          LOW STOCK: {tapeShortage} tape unit(s) short for this requisition.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {stockErrorMsg && (
              <div className="bg-rose-950/80 border border-rose-800 p-4 rounded-xl text-rose-300 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 animate-pulse">
                <div className="font-semibold flex items-center gap-2">
                  <span>⚠️ Inventory Warning:</span>
                  <span>{stockErrorMsg}</span>
                </div>
                {maxPossiblePcs !== null && (
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
                onClick={() => exportExcel(
                  filteredRequestsList.map((request) => {
                    const exportRequest = omitAllocationSourceFields(request);
                    delete exportRequest.room_number;
                    return {
                      ...exportRequest,
                      room: request.room_number ? `Room ${request.room_number}` : "N/A",
                    };
                  }),
                  "Filling_Requests_Log"
                )}
                className="flex-1 sm:flex-none px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition text-center"
              >
                Excel
              </button>
              <button
                onClick={() => {
                  exportPDFWithLogo(
                    "Filling Incharge Material Requisition Log",
                    ["Batch No", "Mfg/Exp", "Retail Price", "Party", "Product", "Pack Size", "Room", "Pcs", "Carton Number", "Pcs/Carton", "Total Cartons Required", "Master Cartons Warehouse"],
                    filteredRequestsList.map((f) => [
                      f.batch_no || f.req_code || "N/A",
                      `Mfg: ${f.mfg_date || "N/A"}\nExp: ${f.exp_date || "N/A"}`,
                      `Rs. ${f.retail_price || 0}`,
                      f.party_name,
                      f.product_name,
                      f.pack_size ? `${f.pack_size} ${f.pack_unit || "ML"}` : "N/A",
                      f.room_number ? `Room ${f.room_number}` : "N/A",
                      f.pcs_requested,
                      f.master_carton_count ?? "N/A",
                      f.master_carton_pcs ?? "N/A",
                      getRequiredMasterCartonCount(f) ?? "N/A",
                      f.master_carton_warehouse || "N/A",
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
                    <th className="p-3">Pack Size</th>
                    <th className="p-3">Room</th>
                    <th className="p-3">Pcs</th>
                    <th className="p-3">Master Cartons / Warehouse</th>
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
                          Required for batch: {getRequiredMasterCartonCount(req) ?? "—"} cartons
                        </div>
                        <div>Master Carton Warehouse: {req.master_carton_warehouse || "—"}</div>
                      </td>
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
                            className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block ${req.status === "RECEIVED_BY_FILLING_INCHARGE"
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
                            const requestWithComponents = req.components?.length
                              ? req
                              : {
                                ...req,
                                components: (() => {
                                  const q = req.pcs_requested || 1000;
                                  return [
                                    { component_type: "bottle", pcs_requested: q, weight_10_pcs_grams: 122, theoretical_weight_kg: (q * 12.2) / 1000 },
                                    { component_type: "cap", pcs_requested: q, weight_10_pcs_grams: 45, theoretical_weight_kg: (q * 4.5) / 1000 },
                                    { component_type: "nozzle", pcs_requested: q, weight_10_pcs_grams: 15, theoretical_weight_kg: (q * 1.5) / 1000 },
                                    { component_type: "seal", pcs_requested: q, weight_10_pcs_grams: 5, theoretical_weight_kg: (q * 0.5) / 1000 },
                                  ];
                                })(),
                              };
                            setSelectedRequestForModal(requestWithComponents);
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