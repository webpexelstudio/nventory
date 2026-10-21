"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

interface FillingRequest {
  id: string;
  party_id?: string | null;
  product_id?: string | null;
  batch_no: string;
  req_code?: string | null;
  mfg_date: string;
  exp_date: string;
  retail_price: number;
  room_number: number | null;
  party_name: string;
  product_name: string;
  pcs_requested: number;
  required_date: string;
  master_carton_pcs: number | null;
  status: string;
  created_at: string;
}

interface HourlyReport {
  id: string;
  filling_request_id: string;
  report_date: string;
  hour_start: string;
  incharge_name: string | null;
  produced_pcs: number;
  carton_pcs: number;
  cartons_completed: number;
}

interface Incharge {
  name: string;
  room_numbers: number[];
}

interface PartyOption {
  id: string;
  name: string;
}

interface ProductOption {
  id: string;
  product_name: string;
  party_id: string;
}

interface ProductBomOption {
  product_id: string;
  component_type: string;
  ml_capacity: number;
  capacity_unit: string | null;
  weight_10_pcs_grams: number | null;
}

interface MasterCartonOption {
  carton_count: number | null;
  carton_name: string | null;
}

interface MasterCartonProductSetting {
  product_id: string;
  carton_count: number;
  carton_pcs: number | null;
}

interface ManualHourlyReport {
  id: string;
  party_id: string;
  product_id: string;
  party_name: string;
  product_name: string;
  batch_no: string | null;
  retail_price: number | null;
  filling_incharge: string | null;
  packing_incharge: string | null;
  production_incharge: string | null;
  mfg_date: string | null;
  exp_date: string | null;
  room_number: number;
  master_carton_count: number | null;
  report_date: string;
  hour_start: string;
  incharge_name: string;
  produced_pcs: number;
  carton_pcs: number;
  cartons_completed: number;
  filling_request_id: string | null;
}

interface ManualReportHeader {
  party_id: string;
  product_id: string;
  party_name: string;
  product_name: string;
  batch_no: string | null;
  retail_price: number;
  filling_incharge: string | null;
  packing_incharge: string;
  production_incharge: string;
  mfg_date: string;
  exp_date: string;
  room_number: number;
  master_carton_count: number;
  carton_pcs: number;
  report_date: string;
}

interface HourlyDraft {
  incharge_name: string;
  produced_pcs: string;
  carton_pcs: string;
  cartons_completed: string;
}

const HOUR_SLOTS = [
  "08:00", "09:00", "10:00", "11:00", "12:00",
  "14:00", "15:00", "16:00", "17:00", "18:00", "19:00",
];
const ADDITIONAL_PRODUCTION_INCHARGES = ["Asim", "Mussarat"];

const today = () => new Date().toISOString().slice(0, 10);

const getHourLabel = (hour: string) => {
  const startHour = Number(hour.slice(0, 2));
  const endHour = startHour + 1;
  const format = (value: number) => {
    const hour12 = value % 12 || 12;
    return `${hour12}:00 ${value < 12 ? "AM" : "PM"}`;
  };
  return `${format(startHour)} – ${format(endHour)}`;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const details = error as Record<string, unknown>;
    const message = typeof details.message === "string" ? details.message : "";
    const code = typeof details.code === "string" ? ` (${details.code})` : "";
    const detail = typeof details.details === "string" ? ` ${details.details}` : "";
    const hint = typeof details.hint === "string" ? ` Hint: ${details.hint}` : "";
    if (details.code === "42P01" || details.code === "PGRST205") {
      return "The manual hourly reports table is missing. Apply supabase/migrations/20261106000000_add_madam_salma_manual_hourly_reports.sql in the Supabase project used by this app, then reload this page.";
    }
    if (details.code === "42501") {
      return `Supabase denied access to manual hourly reports. Confirm the manual-report migration is applied and this signed-in email is authorized.${message ? ` ${message}` : ""}`;
    }
    if (message || detail || hint) return `${message}${code}${detail}${hint}`.trim();
    try {
      const serialized = JSON.stringify(error);
      return serialized === "{}"
        ? "The server returned no error details. Confirm the hourly-production migration is applied and this email is authorized."
        : serialized;
    } catch {
      return "The request failed, but the server returned no error details.";
    }
  }
  return "An unexpected error occurred.";
};

type MadamSalmaView = "reports" | "manual" | "settings";

export default function MadamSalmaPage({ view = "reports" }: { view?: MadamSalmaView }) {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [reportUserName, setReportUserName] = useState("");
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [reportDate, setReportDate] = useState(today);
  const [roomNumber, setRoomNumber] = useState("1");
  const [requests, setRequests] = useState<FillingRequest[]>([]);
  const [reports, setReports] = useState<HourlyReport[]>([]);
  const [incharges, setIncharges] = useState<Incharge[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productBom, setProductBom] = useState<ProductBomOption[]>([]);
  const [masterCartonOptions, setMasterCartonOptions] = useState<MasterCartonOption[]>([]);
  const [masterCartonSettings, setMasterCartonSettings] = useState<MasterCartonProductSetting[]>([]);
  const [manualReports, setManualReports] = useState<ManualHourlyReport[]>([]);
  const [manualHeaders, setManualHeaders] = useState<ManualReportHeader[]>([]);
  const [manualPartyId, setManualPartyId] = useState("");
  const [manualProductId, setManualProductId] = useState("");
  const [manualBatchNo, setManualBatchNo] = useState("");
  const [manualMfgDate, setManualMfgDate] = useState("");
  const [manualExpDate, setManualExpDate] = useState("");
  const [manualRetailPrice, setManualRetailPrice] = useState("");
  const [fillingInchargeName, setFillingInchargeName] = useState("");
  const [packingInchargeName, setPackingInchargeName] = useState("");
  const [productionInchargeName, setProductionInchargeName] = useState("");
  const [manualMasterCartonCount, setManualMasterCartonCount] = useState("");
  const [manualCartonPcs, setManualCartonPcs] = useState("");
  const [manualHourCount, setManualHourCount] = useState(1);
  const [manualDrafts, setManualDrafts] = useState<Record<string, HourlyDraft>>({});
  const [drafts, setDrafts] = useState<Record<string, HourlyDraft>>({});
  const [newInchargeName, setNewInchargeName] = useState("");
  const [editingInchargeName, setEditingInchargeName] = useState<string | null>(null);
  const [inchargeNameDraft, setInchargeNameDraft] = useState("");
  const [editingInchargeRooms, setEditingInchargeRooms] = useState<string | null>(null);
  const [inchargeRoomsDraft, setInchargeRoomsDraft] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingHour, setSavingHour] = useState<string | null>(null);
  const [savingManualHour, setSavingManualHour] = useState<string | null>(null);
  const [savingManualHeader, setSavingManualHeader] = useState(false);
  const [addingIncharge, setAddingIncharge] = useState(false);
  const [savingInchargeName, setSavingInchargeName] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (sessionError) throw sessionError;
        setSession(data.session);
      })
      .catch((sessionError: unknown) => {
        console.error("Could not read production report session:", sessionError);
        setError(getErrorMessage(sessionError));
      })
      .finally(() => setAuthReady(true));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthorized(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setAuthorized(false);
      setCheckingAccess(false);
      return;
    }

    let active = true;
    setCheckingAccess(true);
    void (async () => {
      try {
        const { data: reportUsers, error: accessError } = await supabase
          .from("filling_production_users")
          .select("email, display_name, is_active")
          .eq("is_active", true);
        if (!active) return;
        if (accessError) throw accessError;
        const sessionEmail = session.user.email?.toLowerCase();
        const reportUser = reportUsers?.find((user) =>
          user.email.toLowerCase() === sessionEmail
        );
        setAuthorized(Boolean(reportUser));
        setReportUserName(reportUser?.display_name ?? "");
        if (!reportUser) setError("This login is not authorized for hourly production reports. Ask an administrator to grant Madam Salma report access.");
      } catch (accessError: unknown) {
        if (!active) return;
        console.error("Could not verify production report access:", accessError);
        setError(getErrorMessage(accessError));
      } finally {
        if (active) setCheckingAccess(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [session]);

  const fetchIncharges = useCallback(async () => {
    const [{ data: inchargeData, error: inchargeError }, { data: assignmentData, error: assignmentError }] = await Promise.all([
      supabase
      .from("filling_production_incharges")
      .select("name")
      .eq("is_active", true)
      .order("name"),
      supabase
        .from("filling_production_incharge_rooms")
        .select("incharge_name, room_number"),
    ]);
    if (inchargeError) throw inchargeError;
    if (assignmentError) throw assignmentError;
    const roomsByIncharge = new Map<string, number[]>();
    for (const assignment of assignmentData ?? []) {
      const rooms = roomsByIncharge.get(assignment.incharge_name) ?? [];
      rooms.push(assignment.room_number);
      roomsByIncharge.set(assignment.incharge_name, rooms);
    }
    const rows = (inchargeData ?? []).map((incharge) => ({
      ...incharge,
      room_numbers: roomsByIncharge.get(incharge.name) ?? [],
    }));
    setIncharges(rows);
    setDrafts((current) => Object.fromEntries(
      Object.entries(current).map(([hour, draft]) => [
        hour,
        { ...draft, incharge_name: draft.incharge_name || "" },
      ])
    ));
  }, []);

  const fetchManualReports = useCallback(async () => {
    const [reportResult, headerResult] = await Promise.all([
      supabase
        .from("madam_salma_manual_hourly_reports")
        .select("id, party_id, product_id, party_name, product_name, batch_no, retail_price, filling_incharge, packing_incharge, production_incharge, mfg_date, exp_date, master_carton_count, room_number, report_date, hour_start, incharge_name, produced_pcs, carton_pcs, cartons_completed, filling_request_id")
        .eq("report_date", reportDate)
        .eq("room_number", Number(roomNumber))
        .order("hour_start"),
      supabase
        .from("madam_salma_manual_report_headers")
        .select("party_id, product_id, party_name, product_name, batch_no, retail_price, filling_incharge, packing_incharge, production_incharge, mfg_date, exp_date, room_number, master_carton_count, carton_pcs, report_date")
        .eq("report_date", reportDate)
        .eq("room_number", Number(roomNumber)),
    ]);
    if (reportResult.error) throw reportResult.error;
    if (headerResult.error) throw headerResult.error;
    setManualReports((reportResult.data ?? []) as ManualHourlyReport[]);
    setManualHeaders((headerResult.data ?? []) as ManualReportHeader[]);
  }, [reportDate, roomNumber]);

  const fetchMasterOptions = useCallback(async () => {
    const [partyResult, productResult, bomResult, cartonOptionResult, cartonSettingResult] = await Promise.all([
      supabase.from("parties").select("id, name").order("name"),
      supabase.from("products").select("id, product_name, party_id").order("product_name"),
      supabase.from("product_bom").select("product_id, component_type, ml_capacity, capacity_unit, weight_10_pcs_grams"),
      supabase.from("master_carton_options").select("carton_count, carton_name").order("carton_count"),
      supabase.from("master_carton_product_settings").select("product_id, carton_count, carton_pcs"),
    ]);
    if (partyResult.error) throw partyResult.error;
    if (productResult.error) throw productResult.error;
    if (bomResult.error) throw bomResult.error;
    if (cartonOptionResult.error) throw cartonOptionResult.error;
    if (cartonSettingResult.error) throw cartonSettingResult.error;
    setParties(partyResult.data ?? []);
    setProducts(productResult.data ?? []);
    setProductBom((bomResult.data ?? []) as ProductBomOption[]);
    setMasterCartonOptions(cartonOptionResult.data ?? []);
    setMasterCartonSettings(cartonSettingResult.data ?? []);
  }, []);

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    setError("");
    setRequests([]);
    setReports([]);
    try {
      const { data: requestData, error: requestError } = await supabase
        .from("filling_requests")
        .select("id, party_id, product_id, batch_no, req_code, mfg_date, exp_date, retail_price, room_number, party_name, product_name, pcs_requested, required_date, master_carton_pcs, status, created_at")
        .eq("required_date", reportDate)
        .eq("room_number", Number(roomNumber))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (requestError) throw requestError;

      const requestRows = (requestData ?? []) as FillingRequest[];
      setRequests(requestRows);
      if (requestRows.length === 0) {
        setReports([]);
        setDrafts({});
        return;
      }

      const { data: reportData, error: reportsError } = await supabase
        .from("filling_hourly_production_reports")
        .select("id, filling_request_id, report_date, hour_start, incharge_name, produced_pcs, carton_pcs, cartons_completed")
        .eq("report_date", reportDate)
        .in("filling_request_id", requestRows.map((request) => request.id))
        .order("hour_start");
      if (reportsError) throw reportsError;

      const reportRows = (reportData ?? []) as HourlyReport[];
      setReports(reportRows);
      const progressByRequest = requestRows.map((request) => ({
        request,
        produced: reportRows
          .filter((report) => report.filling_request_id === request.id)
          .reduce((total, report) => total + report.produced_pcs, 0),
      }));
      const currentRequest = progressByRequest.find(
        (item) => item.produced < item.request.pcs_requested
      )?.request;
      const roomIncharges = incharges.filter((incharge) =>
        incharge.room_numbers.includes(currentRequest?.room_number ?? Number(roomNumber))
      );
      const nextDrafts: Record<string, HourlyDraft> = {};
      for (const hour of HOUR_SLOTS) {
        const existing = reportRows.find((report) =>
          report.filling_request_id === currentRequest?.id &&
          report.hour_start.startsWith(hour)
        );
        nextDrafts[hour] = {
          incharge_name: existing?.incharge_name ?? roomIncharges[0]?.name ?? "",
          produced_pcs: existing ? String(existing.produced_pcs) : "",
          carton_pcs: existing
            ? String(existing.carton_pcs)
            : currentRequest?.master_carton_pcs
              ? String(currentRequest.master_carton_pcs)
              : "",
          cartons_completed: existing ? String(existing.cartons_completed) : "",
        };
      }
      setDrafts(nextDrafts);
    } catch (fetchError: unknown) {
      console.error("Could not load hourly production schedule:", fetchError);
      setError(getErrorMessage(fetchError));
    } finally {
      setLoading(false);
    }
  }, [incharges, reportDate, roomNumber]);

  useEffect(() => {
    if (!authorized) return;
    void fetchIncharges().catch((fetchError: unknown) => {
      console.error("Could not load filling incharge names:", fetchError);
      setError(getErrorMessage(fetchError));
    });
  }, [authorized, fetchIncharges]);

  useEffect(() => {
    if (!authorized || (view !== "reports" && view !== "manual")) return;
    void fetchSchedule();
  }, [authorized, fetchSchedule, view]);

  useEffect(() => {
    if (!authorized || view !== "manual") return;
    void fetchManualReports().catch((fetchError: unknown) => {
      const message = getErrorMessage(fetchError);
      console.error("Could not load manual hourly reports:", message);
      setError(message);
    });
  }, [authorized, fetchManualReports, view]);

  useEffect(() => {
    if (!authorized || view !== "manual") return;
    void fetchMasterOptions().catch((fetchError: unknown) => {
      console.error("Could not load party and product options for manual reports:", fetchError);
      setError(getErrorMessage(fetchError));
    });
  }, [authorized, fetchMasterOptions, view]);

  const requestProgress = useMemo(() => requests.map((request) => {
    const requestReports = reports.filter((report) => report.filling_request_id === request.id);
    return {
      request,
      produced: requestReports.reduce((total, report) => total + report.produced_pcs, 0),
      cartons: requestReports.reduce((total, report) => total + report.cartons_completed, 0),
      cartonPcs: requestReports[0]?.carton_pcs ?? request.master_carton_pcs ?? null,
    };
  }), [reports, requests]);

  const activeProgress = requestProgress.find((item) => item.produced < item.request.pcs_requested);
  const activeRequest = activeProgress?.request ?? null;
  const inchargesForRoom = incharges.filter((incharge) =>
    incharge.room_numbers.includes(activeRequest?.room_number ?? Number(roomNumber))
  );
  const manualInchargesForRoom = incharges.filter((incharge) =>
    incharge.room_numbers.includes(Number(roomNumber))
  );
  const productionInchargeOptions = Array.from(new Set([
    ...incharges.map((incharge) => incharge.name),
    ...ADDITIONAL_PRODUCTION_INCHARGES,
  ]));
  const manualProducts = products.filter((product) => product.party_id === manualPartyId);
  const selectedManualParty = parties.find((party) => party.id === manualPartyId);
  const selectedManualProduct = manualProducts.find((product) => product.id === manualProductId);
  const selectedManualCartonSetting = masterCartonSettings.find(
    (setting) => setting.product_id === manualProductId
  );
  const manualProductBom = productBom.filter((bom) => bom.product_id === manualProductId);
  const manualPackSizeBom =
    manualProductBom.find((bom) => bom.component_type.toLowerCase() === "bottle" && bom.ml_capacity > 0) ??
    manualProductBom.find((bom) => bom.component_type.toLowerCase() === "tube" && bom.ml_capacity > 0) ??
    manualProductBom.find((bom) => bom.ml_capacity > 0);
  const manualProductSize = manualPackSizeBom
    ? `${manualPackSizeBom.ml_capacity} ${manualPackSizeBom.capacity_unit || "ML"}`
    : "—";
  const manualProductWeight = manualProductBom.find(
    (bom) => bom.weight_10_pcs_grams !== null && bom.weight_10_pcs_grams > 0
  )?.weight_10_pcs_grams ?? null;
  const savedManualHourCount = manualReports
    .filter((report) =>
      report.party_id === manualPartyId &&
      report.product_id === manualProductId
    )
    .reduce((count, report) => Math.max(count, HOUR_SLOTS.indexOf(report.hour_start.slice(0, 5)) + 1), 0);
  const visibleManualHours = HOUR_SLOTS.slice(0, Math.max(manualHourCount, savedManualHourCount));
  const manualTotalProducedPcs = visibleManualHours.reduce((total, hour) => {
    const saved = manualReports.find((report) =>
      report.party_id === manualPartyId &&
      report.product_id === manualProductId &&
      report.hour_start.startsWith(hour)
    );
    return total + Number(manualDrafts[hour]?.produced_pcs ?? saved?.produced_pcs ?? 0);
  }, 0);
  const manualTotalCartons = visibleManualHours.reduce((total, hour) => {
    const saved = manualReports.find((report) =>
      report.party_id === manualPartyId &&
      report.product_id === manualProductId &&
      report.hour_start.startsWith(hour)
    );
    return total + Number(manualDrafts[hour]?.cartons_completed ?? saved?.cartons_completed ?? 0);
  }, 0);
  const manualMasterCartonCounts = Array.from(new Set([
    ...masterCartonOptions
      .map((option) => option.carton_count)
      .filter((count): count is number => Number.isSafeInteger(count) && count !== null && count > 0),
    ...(selectedManualCartonSetting ? [selectedManualCartonSetting.carton_count] : []),
    ...manualReports
      .filter((report) => report.party_id === manualPartyId && report.product_id === manualProductId)
      .map((report) => report.master_carton_count)
      .filter((count): count is number => count !== null),
  ])).sort((left, right) => left - right);
  const manualNamedCartonOptions = Array.from(new Set(
    masterCartonOptions
      .map((option) => option.carton_name?.trim())
      .filter((name): name is string => Boolean(name))
  )).sort((left, right) => left.localeCompare(right));
  useEffect(() => {
    if (!manualPartyId || !manualProductId) return;
    const savedHeader = manualHeaders.find((header) =>
      header.party_id === manualPartyId && header.product_id === manualProductId
    );
    const savedReport = manualReports.find((report) =>
      report.party_id === manualPartyId && report.product_id === manualProductId
    );
    const saved = savedHeader ?? savedReport;
    if (!saved) return;
    setManualBatchNo(saved.batch_no ?? "");
    setManualMfgDate(saved.mfg_date ?? "");
    setManualExpDate(saved.exp_date ?? "");
    setManualRetailPrice(saved.retail_price == null ? "" : String(saved.retail_price));
    setFillingInchargeName(saved.filling_incharge ?? "");
    setPackingInchargeName(saved.packing_incharge ?? "");
    setProductionInchargeName(saved.production_incharge ?? "");
    setManualMasterCartonCount(saved.master_carton_count == null ? "" : String(saved.master_carton_count));
    setManualCartonPcs(saved.carton_pcs == null ? "" : String(saved.carton_pcs));
  }, [manualHeaders, manualPartyId, manualProductId, manualReports]);
  const requestReady = activeRequest !== null &&
    ["RECEIVED_BY_FILLING_INCHARGE", "RECEIVED_AND_VERIFIED"].includes(activeRequest.status);
  const remainingPcs = activeProgress
    ? Math.max(0, activeProgress.request.pcs_requested - activeProgress.produced)
    : 0;
  const requiredCartons = activeProgress?.cartonPcs
    ? Math.ceil(activeProgress.request.pcs_requested / activeProgress.cartonPcs)
    : null;
  const remainingCartons = requiredCartons === null
    ? null
    : Math.max(0, requiredCartons - (activeProgress?.cartons ?? 0));

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSigningIn(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
    } catch (signInError: unknown) {
      console.error("Could not sign in to hourly production reports:", signInError);
      setError(getErrorMessage(signInError));
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      console.error("Could not sign out of hourly production reports:", signOutError);
      setError(signOutError.message);
    }
  };

  const handleAddIncharge = async () => {
    const name = newInchargeName.trim();
    if (!name || !session?.user.id) {
      setError("Enter an incharge name before adding it.");
      return;
    }
    setAddingIncharge(true);
    setError("");
    try {
      const { error: insertError } = await supabase
        .from("filling_production_incharges")
        .insert({ name, created_by: session.user.id });
      if (insertError) throw insertError;
      await fetchIncharges();
      setNewInchargeName("");
      setNotice(`${name} added to the incharge list.`);
    } catch (insertError: unknown) {
      console.error("Could not add filling incharge:", insertError);
      setError(getErrorMessage(insertError));
    } finally {
      setAddingIncharge(false);
    }
  };

  const handleSaveInchargeName = async (previousName: string) => {
    const nextName = inchargeNameDraft.trim();
    if (!nextName) {
      setError("Incharge name cannot be empty.");
      return;
    }
    if (nextName === previousName) {
      setEditingInchargeName(null);
      setInchargeNameDraft("");
      return;
    }

    setSavingInchargeName(true);
    setError("");
    setNotice("");
    try {
      const { error: renameError } = await supabase.rpc("rename_filling_production_incharge", {
        p_old_name: previousName,
        p_new_name: nextName,
      });
      if (renameError) throw renameError;

      await fetchIncharges();
      setDrafts((current) => Object.fromEntries(
        Object.entries(current).map(([hour, draft]) => [
          hour,
          { ...draft, incharge_name: draft.incharge_name === previousName ? nextName : draft.incharge_name },
        ])
      ));
      setEditingInchargeName(null);
      setInchargeNameDraft("");
      setNotice(`${previousName} was renamed to ${nextName}. Existing reports keep their saved incharge name.`);
    } catch (updateError: unknown) {
      console.error("Could not update filling incharge name:", updateError);
      setError(getErrorMessage(updateError));
    } finally {
      setSavingInchargeName(false);
    }
  };

  const handleSaveInchargeRooms = async (inchargeName: string) => {
    setSavingInchargeName(true);
    setError("");
    setNotice("");
    try {
      const { error: saveError } = await supabase.rpc("set_filling_production_incharge_rooms", {
        p_incharge_name: inchargeName,
        p_room_numbers: inchargeRoomsDraft,
      });
      if (saveError) throw saveError;
      await fetchIncharges();
      setEditingInchargeRooms(null);
      setInchargeRoomsDraft([]);
      setNotice(`Room assignments updated for ${inchargeName}.`);
    } catch (saveError: unknown) {
      console.error("Could not update incharge room assignments:", saveError);
      setError(getErrorMessage(saveError));
    } finally {
      setSavingInchargeName(false);
    }
  };

  const updateDraft = (hour: string, field: keyof HourlyDraft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [hour]: {
        ...(current[hour] ?? {
          incharge_name: "",
          produced_pcs: "",
          carton_pcs: "",
          cartons_completed: "",
        }),
        [field]: value,
      },
    }));
  };

  const handleSaveReport = async (hour: string) => {
    if (!activeRequest || !session?.user.id) return;
    const draft = drafts[hour];
    const producedPcs = Number(draft?.produced_pcs);
    const cartonPcs = Number(draft?.carton_pcs);
    const cartonsCompleted = Number(draft?.cartons_completed);

    if (
      !draft?.incharge_name ||
      !Number.isSafeInteger(producedPcs) || producedPcs < 0 ||
      !Number.isSafeInteger(cartonPcs) || cartonPcs <= 0 ||
      !Number.isSafeInteger(cartonsCompleted) || cartonsCompleted < 0
    ) {
      setError("Select an incharge and enter valid whole-number production and carton quantities.");
      return;
    }

    setSavingHour(hour);
    setError("");
    setNotice("");
    try {
      const { error: saveError } = await supabase.rpc("save_filling_hourly_production_report", {
        p_filling_request_id: activeRequest.id,
        p_report_date: reportDate,
        p_hour_start: hour,
        p_incharge_name: draft.incharge_name,
        p_produced_pcs: producedPcs,
        p_carton_pcs: cartonPcs,
        p_cartons_completed: cartonsCompleted,
      });
      if (saveError) throw saveError;
      setNotice(`${getHourLabel(hour)} report saved.`);
      await fetchSchedule();
    } catch (saveError: unknown) {
      console.error("Could not save hourly production report:", saveError);
      setError(getErrorMessage(saveError));
    } finally {
      setSavingHour(null);
    }
  };

  const updateManualDraft = (hour: string, field: keyof HourlyDraft, value: string) => {
    setManualDrafts((current) => ({
      ...current,
      [hour]: {
        ...(current[hour] ?? {
          incharge_name: manualInchargesForRoom[0]?.name ?? "",
          produced_pcs: "",
          carton_pcs: "",
          cartons_completed: "",
        }),
        [field]: value,
      },
    }));
  };

  const handleSaveManualReport = async (hour: string) => {
    if (!session?.user.id || !selectedManualParty || !selectedManualProduct) {
      setError("Select a party and product before saving a manual report.");
      return;
    }
    const draft = manualDrafts[hour];
    const producedPcs = Number(draft?.produced_pcs);
    const cartonPcs = Number(manualCartonPcs);
    const cartonsCompleted = Number(draft?.cartons_completed);
    const retailPrice = Number(manualRetailPrice);
    const existingManualReport = manualReports.find((report) =>
      report.party_id === selectedManualParty.id &&
      report.product_id === selectedManualProduct.id &&
      report.hour_start.startsWith(hour)
    );
    if (
      !draft?.incharge_name ||
      !manualMfgDate ||
      !manualExpDate ||
      !manualRetailPrice.trim() ||
      !Number.isFinite(retailPrice) || retailPrice < 0 ||
      !fillingInchargeName ||
      !packingInchargeName ||
      !productionInchargeName ||
      !manualMasterCartonCount ||
      Number(manualMasterCartonCount) <= 0 ||
      !Number.isSafeInteger(producedPcs) || producedPcs < 0 ||
      !Number.isSafeInteger(cartonPcs) || cartonPcs <= 0 ||
      !Number.isSafeInteger(cartonsCompleted) || cartonsCompleted < 0
    ) {
      setError("Enter the incharges, retail price, MFG/EXP dates, choose a master carton, set pcs per carton, and enter valid hourly quantities.");
      return;
    }

    setSavingManualHour(hour);
    setError("");
    setNotice("");
    try {
      const { error: saveError } = await supabase.rpc("save_madam_salma_manual_hourly_report", {
        p_party_id: selectedManualParty.id,
        p_product_id: selectedManualProduct.id,
        p_party_name: selectedManualParty.name,
        p_product_name: selectedManualProduct.product_name,
        p_batch_no: manualBatchNo.trim() || existingManualReport?.batch_no || null,
        p_retail_price: retailPrice,
        p_filling_incharge: fillingInchargeName,
        p_packing_incharge: packingInchargeName,
        p_production_incharge: productionInchargeName,
        p_mfg_date: manualMfgDate,
        p_exp_date: manualExpDate,
        p_report_date: reportDate,
        p_room_number: Number(roomNumber),
        p_master_carton_count: Number(manualMasterCartonCount),
        p_hour_start: hour,
        p_incharge_name: draft.incharge_name,
        p_produced_pcs: producedPcs,
        p_carton_pcs: cartonPcs,
        p_cartons_completed: cartonsCompleted,
      });
      if (saveError) throw saveError;
      await fetchManualReports();
      await fetchSchedule();
      setNotice(`${getHourLabel(hour)} manual report saved.`);
    } catch (saveError: unknown) {
      console.error("Could not save manual hourly report:", saveError);
      setError(getErrorMessage(saveError));
    } finally {
      setSavingManualHour(null);
    }
  };

  const handleSaveManualHeader = async () => {
    if (!selectedManualParty || !selectedManualProduct) {
      setError("Select a party and product before saving report details.");
      return;
    }
    const retailPrice = Number(manualRetailPrice);
    const masterCartonCount = Number(manualMasterCartonCount);
    const cartonPcs = Number(manualCartonPcs);
    if (
      !manualMfgDate ||
      !manualExpDate ||
      manualExpDate < manualMfgDate ||
      !manualRetailPrice.trim() ||
      !Number.isFinite(retailPrice) ||
      retailPrice < 0 ||
      !fillingInchargeName ||
      !packingInchargeName ||
      !productionInchargeName ||
      !Number.isSafeInteger(masterCartonCount) ||
      masterCartonCount <= 0 ||
      !Number.isSafeInteger(cartonPcs) ||
      cartonPcs <= 0
    ) {
      setError("Enter valid MFG/EXP dates, RP, filling/packing/production incharges, master carton, and pcs per carton before saving.");
      return;
    }

    setSavingManualHeader(true);
    setError("");
    setNotice("");
    try {
      const { error: saveError } = await supabase.rpc("save_madam_salma_manual_report_header", {
        p_party_id: selectedManualParty.id,
        p_product_id: selectedManualProduct.id,
        p_party_name: selectedManualParty.name,
        p_product_name: selectedManualProduct.product_name,
        p_batch_no: manualBatchNo.trim() || null,
        p_retail_price: retailPrice,
        p_filling_incharge: fillingInchargeName,
        p_packing_incharge: packingInchargeName,
        p_production_incharge: productionInchargeName,
        p_mfg_date: manualMfgDate,
        p_exp_date: manualExpDate,
        p_report_date: reportDate,
        p_room_number: Number(roomNumber),
        p_master_carton_count: masterCartonCount,
        p_carton_pcs: cartonPcs,
      });
      if (saveError) throw saveError;
      await fetchManualReports();
      setNotice("Report details saved. Enter and save each hourly production row separately.");
    } catch (saveError: unknown) {
      console.error("Could not save manual production report details:", saveError);
      setError(getErrorMessage(saveError));
    } finally {
      setSavingManualHeader(false);
    }
  };

  if (!authReady || checkingAccess) {
    return (
      <main className="min-h-screen bg-[#0b0f19] p-6 text-slate-100">
        <p className="mx-auto max-w-5xl text-sm text-slate-400">Checking production report access...</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#0b0f19] p-4 text-slate-100 sm:p-6">
        <form onSubmit={(event) => void handleSignIn(event)} className="mx-auto mt-16 max-w-md space-y-4 rounded-2xl border border-slate-800 bg-[#121827] p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-400">Madam Salma</p>
            <h1 className="mt-2 text-2xl font-extrabold text-white">Hourly Production Reports</h1>
            <p className="mt-2 text-sm text-slate-400">Sign in with the authorized production-report account.</p>
          </div>
          {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
          <label className="block text-sm text-slate-300">
            Email
            <input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white" />
          </label>
          <label className="block text-sm text-slate-300">
            Password
            <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white" />
          </label>
          <button type="submit" disabled={signingIn} className="w-full rounded-lg bg-cyan-600 px-4 py-3 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-50">
            {signingIn ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="min-h-screen bg-[#0b0f19] p-4 text-slate-100 sm:p-6">
        <section className="mx-auto mt-16 max-w-xl space-y-4 rounded-2xl border border-slate-800 bg-[#121827] p-6">
          <h1 className="text-2xl font-extrabold text-white">Madam Salma — Hourly Production Reports</h1>
          <p role="alert" className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">
            {error || "This account does not have production-report access yet. Ask an administrator to authorize it."}
          </p>
          <button type="button" onClick={() => void handleSignOut()} className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700">Sign out</button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0b0f19] p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-cyan-400">Madam Salma</p>
            <h1 className="mt-1 text-2xl font-extrabold text-white">
              {view === "manual" ? "Manual Hourly Report" : view === "settings" ? "Rooms & Incharges" : "Hourly Production Reports"}
            </h1>
            <nav className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
              <Link href="/madam-salma" className={`rounded-lg px-3 py-2 ${view === "reports" ? "bg-cyan-700 text-white" : "bg-slate-800 text-slate-300"}`}>Request reports</Link>
              <Link href="/madam-salma/manual" className={`rounded-lg px-3 py-2 ${view === "manual" ? "bg-amber-700 text-white" : "bg-slate-800 text-slate-300"}`}>Manual hourly report</Link>
              <Link href="/madam-salma/settings" className={`rounded-lg px-3 py-2 ${view === "settings" ? "bg-cyan-700 text-white" : "bg-slate-800 text-slate-300"}`}>Rooms & incharges</Link>
            </nav>
            {view === "reports" && <p className="mt-2 text-xs text-slate-400">Only the current unfinished product for the selected room can be reported.</p>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-right text-xs text-slate-400">{reportUserName || session.user.email}<br />{session.user.email}</span>
            <button type="button" onClick={() => void handleSignOut()} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700">Sign out</button>
          </div>
        </header>

        {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300">{notice}</p>}

        {view !== "settings" && <section className="grid gap-4 rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:grid-cols-2 sm:p-6">
          <label className="text-sm text-slate-300">
            Production date
            <input type="date" value={reportDate} onChange={(event) => {
              setReportDate(event.target.value);
              setManualDrafts({});
              setManualBatchNo("");
              setManualMfgDate("");
              setManualExpDate("");
              setManualRetailPrice("");
              setFillingInchargeName("");
              setPackingInchargeName("");
              setProductionInchargeName("");
              setManualMasterCartonCount("");
              setManualCartonPcs("");
              setManualHourCount(1);
            }} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white" />
          </label>
          <label className="text-sm text-slate-300">
            Room
            <select value={roomNumber} onChange={(event) => {
              setRoomNumber(event.target.value);
              setManualDrafts({});
              setManualBatchNo("");
              setManualMfgDate("");
              setManualExpDate("");
              setManualRetailPrice("");
              setFillingInchargeName("");
              setPackingInchargeName("");
              setProductionInchargeName("");
              setManualMasterCartonCount("");
              setManualCartonPcs("");
              setManualHourCount(1);
            }} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white">
              {[1, 2, 3, 4, 5, 6].map((room) => <option key={room} value={room}>Room {room}</option>)}
            </select>
          </label>
        </section>}

        {view === "manual" && <section className="space-y-4 rounded-2xl border border-amber-900/70 bg-[#121827] p-4 sm:p-6">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-amber-300">Manual hourly report</h2>
            <p className="mt-1 text-xs text-slate-400">
              Use this when production starts before a filling request exists. If exactly one request later matches the same party, product, date, and room, these hourly entries will be linked to it.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-slate-300">
              Party
              <select
                value={manualPartyId}
                onChange={(event) => {
                  setManualPartyId(event.target.value);
                  setManualProductId("");
                  setManualBatchNo("");
                  setManualMfgDate("");
                  setManualExpDate("");
                  setManualRetailPrice("");
                  setFillingInchargeName("");
                  setPackingInchargeName("");
                  setProductionInchargeName("");
                  setManualMasterCartonCount("");
                  setManualCartonPcs("");
                  setManualDrafts({});
                  setManualHourCount(1);
                }}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white"
              >
                <option value="">Select party</option>
                {parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-300">
              Product
              <select
                value={manualProductId}
                disabled={!manualPartyId}
                onChange={(event) => {
                  const nextProductId = event.target.value;
                  const nextSetting = masterCartonSettings.find(
                    (setting) => setting.product_id === nextProductId
                  );
                  const existingReport = manualReports.find((report) =>
                    report.party_id === manualPartyId && report.product_id === nextProductId
                  );
                  setManualProductId(nextProductId);
                  setManualDrafts({});
                  setManualHourCount(1);
                  setManualBatchNo(existingReport?.batch_no ?? "");
                  setManualMfgDate(existingReport?.mfg_date ?? "");
                  setManualExpDate(existingReport?.exp_date ?? "");
                  setManualRetailPrice(existingReport?.retail_price == null ? "" : String(existingReport.retail_price));
                  setFillingInchargeName(existingReport?.filling_incharge ?? "");
                  setPackingInchargeName(existingReport?.packing_incharge ?? "");
                  setProductionInchargeName(existingReport?.production_incharge ?? "");
                  setManualMasterCartonCount(
                    String(existingReport?.master_carton_count ?? nextSetting?.carton_count ?? "")
                  );
                  setManualCartonPcs(
                    String(existingReport?.carton_pcs ?? nextSetting?.carton_pcs ?? "")
                  );
                }}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white disabled:opacity-50"
              >
                <option value="">Select product</option>
                {manualProducts.map((product) => <option key={product.id} value={product.id}>{product.product_name}</option>)}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void handleSaveManualHeader()}
                disabled={!selectedManualParty || !selectedManualProduct || savingManualHeader}
                className="w-full rounded-lg bg-cyan-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-cyan-600 disabled:opacity-40"
              >
                {savingManualHeader ? "Saving details..." : "Save report details"}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-4">
              <label className="text-xs text-slate-300">
                MFG date
                <input
                  type="date"
                  value={manualMfgDate}
                  onChange={(event) => setManualMfgDate(event.target.value)}
                  disabled={!selectedManualProduct}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-slate-300">
                EXP date
                <input
                  type="date"
                  value={manualExpDate}
                  onChange={(event) => setManualExpDate(event.target.value)}
                  disabled={!selectedManualProduct}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-slate-300">
                Retail price
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualRetailPrice}
                  onChange={(event) => setManualRetailPrice(event.target.value)}
                  disabled={!selectedManualProduct}
                  placeholder="Enter retail price"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-slate-300">
                Batch / reference (optional)
                <input
                  value={manualBatchNo}
                  onChange={(event) => setManualBatchNo(event.target.value)}
                  placeholder="Enter batch or reference"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white"
                />
              </label>
            </div>
            <label className="text-xs text-slate-300">
              Filling incharge
              <select
                value={fillingInchargeName}
                onChange={(event) => setFillingInchargeName(event.target.value)}
                disabled={!selectedManualProduct}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white disabled:opacity-50"
              >
                <option value="">Select filling incharge</option>
                {incharges.map((incharge) => <option key={incharge.name} value={incharge.name}>{incharge.name}</option>)}
                {fillingInchargeName && !incharges.some((incharge) => incharge.name === fillingInchargeName) && (
                  <option value={fillingInchargeName}>{fillingInchargeName} (saved)</option>
                )}
              </select>
            </label>
            <label className="text-xs text-slate-300">
              Packing incharge
              <select
                value={packingInchargeName}
                onChange={(event) => setPackingInchargeName(event.target.value)}
                disabled={!selectedManualProduct}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white disabled:opacity-50"
              >
                <option value="">Select packing incharge</option>
                {incharges.map((incharge) => <option key={incharge.name} value={incharge.name}>{incharge.name}</option>)}
                {packingInchargeName && !incharges.some((incharge) => incharge.name === packingInchargeName) && (
                  <option value={packingInchargeName}>{packingInchargeName} (saved)</option>
                )}
              </select>
            </label>
            <label className="text-xs text-slate-300">
              Production incharge
              <select
                value={productionInchargeName}
                onChange={(event) => setProductionInchargeName(event.target.value)}
                disabled={!selectedManualProduct}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white disabled:opacity-50"
              >
                <option value="">Select production incharge</option>
                {productionInchargeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                {productionInchargeName && !productionInchargeOptions.includes(productionInchargeName) && (
                  <option value={productionInchargeName}>{productionInchargeName} (saved)</option>
                )}
              </select>
            </label>
            <div className="rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-xs text-slate-300">
              Product size: <span className="font-semibold text-white">{manualProductSize}</span>
              <span className="mx-2 text-slate-600">|</span>
              Weight / 10 pcs: <span className="font-semibold text-white">{manualProductWeight === null ? "—" : `${manualProductWeight} g`}</span>
            </div>
            <label className="text-xs text-slate-300">
              Master carton (Admin)
              <select
                value={manualMasterCartonCount}
                onChange={(event) => {
                  setManualMasterCartonCount(event.target.value);
                  const optionSetting = masterCartonSettings.find((setting) =>
                    setting.product_id === manualProductId &&
                    String(setting.carton_count) === event.target.value
                  );
                  setManualCartonPcs(String(optionSetting?.carton_pcs ?? ""));
                }}
                disabled={!selectedManualProduct}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white disabled:opacity-50"
              >
                <option value="">Select master carton</option>
                {manualNamedCartonOptions.length > 0 && (
                  <optgroup label="Admin carton names (warehouse types)">
                    {manualNamedCartonOptions.map((name) => (
                      <option key={name} value={`named:${name}`} disabled>
                        {name} — warehouse-only option
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Admin numeric carton counts (Filling)">
                {manualMasterCartonCounts.map((count) => {
                  const adminSetting = masterCartonSettings.find((setting) =>
                    setting.product_id === manualProductId && setting.carton_count === count
                  );
                  return (
                    <option key={count} value={count}>
                      Carton #{count}{adminSetting?.carton_pcs ? ` — ${adminSetting.carton_pcs} pcs/carton` : ""}
                    </option>
                  );
                })}
                </optgroup>
              </select>
              {manualNamedCartonOptions.length > 0 && (
                <span className="mt-1 block text-slate-400">
                  Admin carton names are shown above; named types are for warehouse stock. Choose a numeric Filling carton count to save this report.
                </span>
              )}
              {selectedManualProduct && manualMasterCartonCounts.length === 0 && (
                <span className="mt-1 block text-amber-300">
                  No numeric Filling carton-count options found in Admin. Add one in Admin under Master Cartons.
                </span>
              )}
            </label>
            <label className="text-xs text-slate-300">
              Pcs in each master carton
              <input
                type="number"
                min="1"
                step="1"
                value={manualCartonPcs}
                onChange={(event) => setManualCartonPcs(event.target.value)}
                disabled={!selectedManualProduct}
                placeholder="Enter pcs per carton"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-white disabled:opacity-50"
              />
            </label>
          </div>
          <p className="text-xs text-cyan-200">
            Report date: {reportDate} ({new Date(`${reportDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" })}) · Room {roomNumber}
            {selectedManualParty && selectedManualProduct
              ? ` · ${selectedManualParty.name} / ${selectedManualProduct.product_name}`
              : ""}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-700 bg-[#0b0f19] p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Total produced</p>
              <p className="mt-1 text-lg font-bold text-white">{manualTotalProducedPcs.toLocaleString()} pcs</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#0b0f19] p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Total cartons</p>
              <p className="mt-1 text-lg font-bold text-white">{manualTotalCartons.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-[#0b0f19] p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Retail price</p>
              <p className="mt-1 text-lg font-bold text-white">{manualRetailPrice ? Number(manualRetailPrice).toLocaleString() : "—"}</p>
            </div>
          </div>
          {manualProducts.length === 0 && manualPartyId && (
            <p className="text-xs text-amber-300">No product is registered for this party yet. Add a product above, or create it in Admin.</p>
          )}
          {manualInchargesForRoom.length === 0 && (
            <p className="text-xs text-amber-300">
              Assign an incharge to Room {roomNumber} on the <Link href="/madam-salma/settings" className="font-bold underline">Rooms & incharges page</Link> before saving hourly entries.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-xs text-slate-300">
              <thead className="bg-[#0b0f19] uppercase text-slate-400">
                <tr>
                  <th className="p-3">Hour</th>
                  <th className="p-3">Incharge</th>
                  <th className="p-3">Produced pcs</th>
                  <th className="p-3">Pcs / carton</th>
                  <th className="p-3">Cartons</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {visibleManualHours.map((hour) => {
                  const saved = manualReports.find((report) =>
                    report.party_id === manualPartyId &&
                    report.product_id === manualProductId &&
                    report.hour_start.startsWith(hour)
                  );
                  const draft = manualDrafts[hour];
                  const attached = Boolean(saved?.filling_request_id);
                  const matchingRequests = requests.filter((request) =>
                    request.party_id === manualPartyId &&
                    request.product_id === manualProductId
                  );
                  return (
                    <tr key={hour}>
                      <td className="p-3 font-semibold text-white">{getHourLabel(hour)}</td>
                      <td className="p-3">
                        <select
                          value={draft?.incharge_name ?? saved?.incharge_name ?? manualInchargesForRoom[0]?.name ?? ""}
                          onChange={(event) => updateManualDraft(hour, "incharge_name", event.target.value)}
                          disabled={!selectedManualProduct || attached || manualInchargesForRoom.length === 0}
                          className="w-44 rounded border border-slate-700 bg-[#0b0f19] p-2 text-white disabled:opacity-50"
                        >
                          <option value="">Select incharge</option>
                          {manualInchargesForRoom.map((incharge) => <option key={incharge.name} value={incharge.name}>{incharge.name}</option>)}
                          {saved?.incharge_name && !manualInchargesForRoom.some((incharge) => incharge.name === saved.incharge_name) && (
                            <option value={saved.incharge_name}>{saved.incharge_name} (saved)</option>
                          )}
                        </select>
                      </td>
                      <td className="p-3">
                        <input
                          aria-label={`${hour} manual produced pcs`}
                          type="number"
                          min="0"
                          step="1"
                          value={draft?.produced_pcs ?? (saved ? String(saved.produced_pcs) : "")}
                          onChange={(event) => updateManualDraft(hour, "produced_pcs", event.target.value)}
                          disabled={!selectedManualProduct || attached}
                          className="w-24 rounded border border-slate-700 bg-[#0b0f19] p-2 text-white disabled:opacity-50"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          aria-label={`${hour} manual pcs per carton`}
                          type="number"
                          min="1"
                          step="1"
                          value={manualCartonPcs}
                          readOnly
                          disabled={!selectedManualProduct || attached}
                          className="w-24 rounded border border-slate-700 bg-[#0b0f19] p-2 text-white disabled:opacity-50"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          aria-label={`${hour} manual cartons completed`}
                          type="number"
                          min="0"
                          step="1"
                          value={draft?.cartons_completed ?? (saved ? String(saved.cartons_completed) : "")}
                          onChange={(event) => updateManualDraft(hour, "cartons_completed", event.target.value)}
                          disabled={!selectedManualProduct || attached}
                          className="w-24 rounded border border-slate-700 bg-[#0b0f19] p-2 text-white disabled:opacity-50"
                        />
                      </td>
                      <td className="p-3">
                        {attached
                          ? "Linked to filling request"
                          : saved && matchingRequests.length > 1
                            ? "Multiple matching requests; review needed"
                            : saved && matchingRequests.length === 1
                              ? "Saved manually; could not link automatically"
                              : saved
                                ? "Waiting for filling request"
                                : "Not saved"}
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          disabled={!selectedManualProduct || !manualInchargesForRoom.length || attached || savingManualHour !== null}
                          onClick={() => void handleSaveManualReport(hour)}
                          className="rounded bg-amber-700 px-3 py-2 font-bold text-white hover:bg-amber-600 disabled:opacity-40"
                        >
                          {savingManualHour === hour ? "Saving..." : saved ? "Update" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {manualHourCount < HOUR_SLOTS.length && (
            <button
              type="button"
              disabled={!selectedManualProduct}
              onClick={() => setManualHourCount((current) => Math.min(HOUR_SLOTS.length, current + 1))}
              className="rounded-lg border border-amber-700 px-4 py-2 text-sm font-bold text-amber-200 disabled:opacity-40"
            >
              + Add next hour
            </button>
          )}
          {manualReports.some((report) => report.report_date === reportDate && report.room_number === Number(roomNumber) && report.filling_request_id) && (
            <p className="text-xs text-emerald-300">Reports matched to a filling request are read-only here; continue editing them in the request hourly report section below.</p>
          )}
        </section>}

        {view === "settings" && (
          <section className="rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-cyan-300">Rooms (1–6)</h2>
            <p className="mt-1 text-xs text-slate-400">Select a room below to see its assigned incharges. Use the incharge room controls to change assignments.</p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((room) => {
                const assignedNames = incharges
                  .filter((incharge) => incharge.room_numbers.includes(room))
                  .map((incharge) => incharge.name);
                return (
                  <li key={room} className="rounded-lg border border-slate-800 bg-[#0b0f19] p-3">
                    <p className="font-semibold text-white">Room {room}</p>
                    <p className="mt-1 text-xs text-cyan-200">
                      {assignedNames.length > 0 ? assignedNames.join(", ") : "No incharges assigned"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {view === "settings" && <section className="rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-cyan-300">Incharge dropdown</h2>
              <p className="mt-1 text-xs text-slate-400">Assign each incharge to one or more rooms. Hourly entry only lists incharges assigned to the selected room.</p>
            </div>
            <div className="flex gap-2">
              <input aria-label="New incharge name" value={newInchargeName} onChange={(event) => setNewInchargeName(event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-[#0b0f19] px-3 py-2 text-sm text-white" placeholder="Incharge name" />
              <button type="button" disabled={addingIncharge || !newInchargeName.trim()} onClick={() => void handleAddIncharge()} className="rounded-lg border border-cyan-800 px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-50">
                {addingIncharge ? "Adding..." : "Add name"}
              </button>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-800 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300">All incharge names ({incharges.length})</h3>
            {incharges.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">No incharge names added yet.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {incharges.map((incharge) => (
                  <li key={incharge.name} className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-[#0b0f19] p-3">
                    <div className="flex items-center gap-2">
                    {editingInchargeName === incharge.name ? (
                      <>
                        <input
                          aria-label={`Edit ${incharge.name}`}
                          value={inchargeNameDraft}
                          onChange={(event) => setInchargeNameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleSaveInchargeName(incharge.name);
                            if (event.key === "Escape") {
                              setEditingInchargeName(null);
                              setInchargeNameDraft("");
                            }
                          }}
                          className="min-w-0 flex-1 rounded border border-slate-700 bg-[#121827] px-2 py-1.5 text-sm text-white"
                          autoFocus
                        />
                        <button
                          type="button"
                          disabled={savingInchargeName || !inchargeNameDraft.trim()}
                          onClick={() => void handleSaveInchargeName(incharge.name)}
                          className="rounded bg-emerald-800 px-2 py-1.5 text-xs font-bold text-emerald-100 disabled:opacity-50"
                        >
                          {savingInchargeName ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={savingInchargeName}
                          onClick={() => {
                            setEditingInchargeName(null);
                            setInchargeNameDraft("");
                          }}
                          className="rounded bg-slate-800 px-2 py-1.5 text-xs text-slate-200 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{incharge.name}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingInchargeName(incharge.name);
                            setInchargeNameDraft(incharge.name);
                          }}
                          className="rounded border border-cyan-800 px-2 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-950/50"
                        >
                          Edit
                        </button>
                      </>
                    )}
                    </div>
                    {editingInchargeRooms === incharge.name ? (
                      <div className="space-y-2 border-t border-slate-800 pt-2">
                        <p className="text-[10px] font-semibold uppercase text-slate-400">Assigned rooms</p>
                        <div className="flex flex-wrap gap-3">
                          {[1, 2, 3, 4, 5, 6].map((room) => (
                            <label key={room} className="flex items-center gap-1.5 text-xs text-slate-300">
                              <input
                                type="checkbox"
                                checked={inchargeRoomsDraft.includes(room)}
                                onChange={(event) => setInchargeRoomsDraft((current) =>
                                  event.target.checked
                                    ? [...current, room].sort((left, right) => left - right)
                                    : current.filter((value) => value !== room)
                                )}
                                className="accent-cyan-500"
                              />
                              Room {room}
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={savingInchargeName}
                            onClick={() => void handleSaveInchargeRooms(incharge.name)}
                            className="rounded bg-emerald-800 px-2 py-1.5 text-xs font-bold text-emerald-100 disabled:opacity-50"
                          >
                            {savingInchargeName ? "Saving..." : "Save rooms"}
                          </button>
                          <button
                            type="button"
                            disabled={savingInchargeName}
                            onClick={() => {
                              setEditingInchargeRooms(null);
                              setInchargeRoomsDraft([]);
                            }}
                            className="rounded bg-slate-800 px-2 py-1.5 text-xs text-slate-200 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-2">
                        <p className="text-xs text-cyan-200">
                          {incharge.room_numbers.length > 0
                            ? incharge.room_numbers.map((room) => `Room ${room}`).join(", ")
                            : "No rooms assigned"}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingInchargeRooms(incharge.name);
                            setInchargeRoomsDraft(incharge.room_numbers);
                          }}
                          className="rounded border border-cyan-800 px-2 py-1 text-xs font-bold text-cyan-300 hover:bg-cyan-950/50"
                        >
                          Assign rooms
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>}

        {view === "reports" && (loading ? (
          <p className="text-sm text-slate-400">Loading requests and reports...</p>
        ) : requests.length === 0 ? (
          <p className="rounded-xl border border-slate-800 bg-[#121827] p-6 text-sm text-slate-400">No filling requests are scheduled for Room {roomNumber} on {reportDate}.</p>
        ) : !activeProgress ? (
          <p className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-6 text-sm text-emerald-200">All scheduled products for this room and date have reached their requested pcs quantity.</p>
        ) : (
          <>
            <section className="grid gap-3 rounded-2xl border border-cyan-900 bg-cyan-950/20 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-6">
              <div><p className="text-[10px] uppercase text-slate-400">Current product</p><p className="mt-1 font-bold text-white">{activeRequest?.product_name}</p></div>
              <div><p className="text-[10px] uppercase text-slate-400">Batch / Party</p><p className="mt-1 font-semibold text-white">{activeRequest?.batch_no || activeRequest?.req_code || "—"} / {activeRequest?.party_name}</p></div>
              <div><p className="text-[10px] uppercase text-slate-400">MFD / EXP / RP</p><p className="mt-1 font-semibold text-white">{activeRequest?.mfg_date} / {activeRequest?.exp_date} / Rs. {activeRequest?.retail_price}</p></div>
              <div><p className="text-[10px] uppercase text-slate-400">Production progress</p><p className="mt-1 font-bold text-cyan-200">{activeProgress.produced.toLocaleString()} / {activeRequest?.pcs_requested.toLocaleString()} pcs</p><p className="text-xs text-slate-300">{remainingPcs.toLocaleString()} pcs remaining</p></div>
              <div><p className="text-[10px] uppercase text-slate-400">Room / Request status</p><p className="mt-1 font-semibold text-white">Room {activeRequest?.room_number} / {activeRequest?.status}</p></div>
              <div><p className="text-[10px] uppercase text-slate-400">Cartons</p><p className="mt-1 font-bold text-amber-200">{activeProgress.cartons.toLocaleString()} completed</p><p className="text-xs text-slate-300">{remainingCartons === null ? "Enter pcs per carton" : `${remainingCartons.toLocaleString()} cartons remaining`}</p></div>
            </section>

            {!requestReady && (
              <p className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200">
                This is the next unfinished product for Room {roomNumber}, but warehouse materials must be received and verified before hourly reports can be saved.
              </p>
            )}

            <section className="space-y-4 rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
              <div>
                <h2 className="text-sm font-bold text-white">Hourly entry</h2>
                <p className="mt-1 text-xs text-slate-400">Morning: 8:00 AM–1:00 PM · Evening: 2:00 PM–8:00 PM</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs text-slate-300">
                  <thead className="bg-[#0b0f19] uppercase text-slate-400">
                    <tr>
                      <th className="p-3">Hour</th><th className="p-3">Room / Incharge</th><th className="p-3">Produced pcs</th><th className="p-3">Pcs / carton</th><th className="p-3">Cartons this hour</th><th className="p-3">Saved pcs total</th><th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {HOUR_SLOTS.map((hour) => {
                      const saved = reports.find((report) =>
                        report.filling_request_id === activeRequest?.id && report.hour_start.startsWith(hour)
                      );
                      return (
                        <tr key={hour}>
                          <td className="p-3 font-semibold text-white">{getHourLabel(hour)}</td>
                          <td className="p-3">
                            <div className="space-y-1">
                              <span className="block text-[10px] font-semibold text-cyan-300">
                                Room {activeRequest?.room_number ?? roomNumber}
                              </span>
                              <select value={drafts[hour]?.incharge_name ?? ""} onChange={(event) => updateDraft(hour, "incharge_name", event.target.value)} disabled={!requestReady || inchargesForRoom.length === 0} className="w-44 rounded border border-slate-700 bg-[#0b0f19] p-2 text-white disabled:opacity-50">
                                <option value="">Select incharge</option>
                                {inchargesForRoom.map((incharge) => <option key={incharge.name} value={incharge.name}>{incharge.name}</option>)}
                                {saved?.incharge_name && !inchargesForRoom.some((incharge) => incharge.name === saved.incharge_name) && (
                                  <option value={saved.incharge_name}>{saved.incharge_name} (saved report)</option>
                                )}
                              </select>
                            </div>
                          </td>
                          <td className="p-3"><input aria-label={`${hour} produced pcs`} type="number" min="0" step="1" value={drafts[hour]?.produced_pcs ?? ""} onChange={(event) => updateDraft(hour, "produced_pcs", event.target.value)} disabled={!requestReady} className="w-28 rounded border border-slate-700 bg-[#0b0f19] p-2 text-white disabled:opacity-50" /></td>
                          <td className="p-3"><input aria-label={`${hour} pcs per carton`} type="number" min="1" step="1" value={drafts[hour]?.carton_pcs ?? ""} onChange={(event) => updateDraft(hour, "carton_pcs", event.target.value)} disabled={!requestReady} className="w-24 rounded border border-slate-700 bg-[#0b0f19] p-2 text-white disabled:opacity-50" /></td>
                          <td className="p-3"><input aria-label={`${hour} cartons completed`} type="number" min="0" step="1" value={drafts[hour]?.cartons_completed ?? ""} onChange={(event) => updateDraft(hour, "cartons_completed", event.target.value)} disabled={!requestReady} className="w-24 rounded border border-slate-700 bg-[#0b0f19] p-2 text-white disabled:opacity-50" /></td>
                          <td className="p-3">{saved ? `${reports.filter((report) => report.filling_request_id === activeRequest?.id && report.hour_start <= saved.hour_start).reduce((total, report) => total + report.produced_pcs, 0).toLocaleString()} pcs` : "Not saved"}</td>
                          <td className="p-3">
                            <button type="button" disabled={!requestReady || inchargesForRoom.length === 0 || savingHour !== null} onClick={() => void handleSaveReport(hour)} className="rounded bg-emerald-700 px-3 py-2 font-bold text-white hover:bg-emerald-600 disabled:opacity-40">
                              {savingHour === hour ? "Saving..." : saved ? "Update" : "Save"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {inchargesForRoom.length === 0 && (
                <p className="text-xs text-amber-300">
                  No incharges are assigned to Room {activeRequest?.room_number ?? roomNumber}. Assign one on the <Link href="/madam-salma/settings" className="font-bold underline">Rooms & incharges page</Link> before entering an hourly report.
                </p>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
              <h2 className="text-sm font-bold text-white">Requests queued for this room and date</h2>
              {requestProgress.map(({ request, produced }, index) => (
                <div key={request.id} className="flex flex-col justify-between gap-2 rounded-lg border border-slate-800 bg-[#0b0f19] p-3 sm:flex-row sm:items-center">
                  <div>
                    <p className="font-semibold text-white">{index + 1}. {request.product_name} · {request.batch_no || request.req_code || "No batch"}</p>
                    <p className="text-xs text-slate-400">Requested: {request.pcs_requested.toLocaleString()} pcs · Produced: {produced.toLocaleString()} pcs</p>
                  </div>
                  <span className={`text-xs font-bold ${produced >= request.pcs_requested ? "text-emerald-300" : request.id === activeRequest?.id ? "text-cyan-300" : "text-amber-300"}`}>
                    {produced >= request.pcs_requested ? "Complete" : request.id === activeRequest?.id ? "Current product" : "Locked until previous product is complete"}
                  </span>
                </div>
              ))}
            </section>
          </>
        ))}
      </div>
    </main>
  );
}
