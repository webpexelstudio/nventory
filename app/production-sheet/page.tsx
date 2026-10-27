"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Eye, Share2, X } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/lib/supabase";

const HOUR_SLOTS = [
  "09:00", "10:00", "11:00", "12:00", "13:00",
  "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
];

type OptionType = "room" | "incharge";

interface ProductionOption {
  id: string;
  option_type: OptionType;
  name: string;
}

interface ProductionRow {
  incharge_name: string;
  product_name: string;
  batch_no: string;
  retail_price: string;
  mfg_date: string;
  exp_date: string;
  carton_no: string;
  pcs_per_carton: string;
  pcs_weight: string;
  hourly: Record<string, string>;
}

interface ProductionSheet {
  id: string;
  report_date: string;
  room_name: string;
  packing_incharge: string;
  production_incharge: string;
  daily_target: number;
  rows: ProductionRow[];
  created_at: string;
  updated_at: string;
}

const emptyRow = (): ProductionRow => ({
  incharge_name: "",
  product_name: "",
  batch_no: "",
  retail_price: "",
  mfg_date: "",
  exp_date: "",
  carton_no: "",
  pcs_per_carton: "",
  pcs_weight: "",
  hourly: Object.fromEntries(HOUR_SLOTS.map((hour) => [hour, ""])),
});

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const numericValue = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const rowTotal = (row: ProductionRow) =>
  HOUR_SLOTS.reduce((total, hour) => total + numericValue(row.hourly[hour] ?? ""), 0);

const rowCartons = (row: ProductionRow) => {
  const piecesPerCarton = numericValue(row.pcs_per_carton);
  return piecesPerCarton > 0 ? rowTotal(row) / piecesPerCarton : null;
};

const formatCartons = (cartons: number) =>
  Number(cartons.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });

const reportTotal = (report: ProductionSheet) =>
  (report.rows ?? []).reduce((total, row) => total + rowTotal(row), 0);

const reportCartons = (report: ProductionSheet) =>
  (report.rows ?? []).reduce((total, row) => total + (rowCartons(row) ?? 0), 0);

const formatDay = (date: string) =>
  date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }) : "";

const reportTitle = (report: ProductionSheet) =>
  `Production Report - ${report.room_name} - ${report.report_date}`;

const reportShareText = (report: ProductionSheet) => {
  const productLines = (report.rows ?? []).map((row, index) => {
    const hourly = HOUR_SLOTS
      .map((hour) => {
        const value = row.hourly?.[hour]?.trim();
        return value ? `${hour}: ${value}` : null;
      })
      .filter(Boolean)
      .join(" | ");
    const cartons = rowCartons(row);
    return `${index + 1}. ${row.product_name || "Product"}${row.batch_no ? ` (Batch ${row.batch_no})` : ""} - ${rowTotal(row).toLocaleString()} pcs${cartons === null ? "" : ` · ${formatCartons(cartons)} cartons`}${hourly ? `\n   ${hourly}` : ""}`;
  });

  return [
    `*${reportTitle(report)}*`,
    `Date: ${report.report_date} (${formatDay(report.report_date)})`,
    `Room / floor: ${report.room_name}`,
    `Packing incharge: ${report.packing_incharge}`,
    `Production incharge: ${report.production_incharge}`,
    `Daily target: ${Number(report.daily_target || 0).toLocaleString()} pcs`,
    `Total production: ${reportTotal(report).toLocaleString()} pcs`,
    `Total cartons: ${formatCartons(reportCartons(report))}`,
    "",
    "*Products*",
    ...productLines,
  ].join("\n");
};

const optionLabel: Record<OptionType, string> = {
  room: "Room / Packing floor",
  incharge: "Incharge",
};

export default function ProductionSheetPage() {
  const [reports, setReports] = useState<ProductionSheet[]>([]);
  const [options, setOptions] = useState<ProductionOption[]>([]);
  const [reportDate, setReportDate] = useState(today());
  const [roomName, setRoomName] = useState("");
  const [packingIncharge, setPackingIncharge] = useState("");
  const [productionIncharge, setProductionIncharge] = useState("");
  const [dailyTarget, setDailyTarget] = useState("");
  const [rows, setRows] = useState<ProductionRow[]>([emptyRow()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newOptionType, setNewOptionType] = useState<OptionType>("room");
  const [newOptionName, setNewOptionName] = useState("");
  const [viewingReport, setViewingReport] = useState<ProductionSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const totalProduction = useMemo(
    () => rows.reduce((total, row) => total + rowTotal(row), 0),
    [rows],
  );

  const fetchData = useCallback(async () => Promise.all([
      supabase.from("production_data_sheets").select("*").order("report_date", { ascending: false }).order("updated_at", { ascending: false }),
      supabase.from("production_sheet_options").select("*").order("name"),
    ]), []);

  const applyFetchedData = useCallback((
    reportsResult: Awaited<ReturnType<typeof fetchData>>[0],
    optionsResult: Awaited<ReturnType<typeof fetchData>>[1],
  ) => {
    setError(null);
    if (reportsResult.error || optionsResult.error) {
      const details = [reportsResult.error, optionsResult.error]
        .filter(Boolean)
        .map((item) => item?.message)
        .join("; ");
      const missingTables: string[] = [];
      if (reportsResult.error?.message.includes("Could not find the table")) {
        missingTables.push("production_data_sheets");
      }
      if (optionsResult.error?.message.includes("Could not find the table")) {
        missingTables.push("production_sheet_options");
      }
      if (missingTables.length > 0) {
        setError(
          `Supabase API cannot find ${missingTables.join(" and ")}. Confirm the full migration ran in the same Supabase project configured for this app, and that both tables exist in public. In SQL Editor run: SELECT to_regclass('public.production_data_sheets'), to_regclass('public.production_sheet_options'); if either result is null, run supabase/migrations/20261111000000_create_production_data_sheets.sql. If both exist, run NOTIFY pgrst, 'reload schema'; check that public is enabled under Supabase Settings > API > Exposed schemas, then refresh this page. API error: ${details}`,
        );
      } else {
        setError(`Production sheets could not be loaded: ${details}`);
      }
      setLoading(false);
      return;
    }
    setReports((reportsResult.data ?? []) as ProductionSheet[]);
    setOptions((optionsResult.data ?? []) as ProductionOption[]);
    setLoading(false);
  }, []);

  const loadData = async () => {
    applyFetchedData(...await fetchData());
  };

  useEffect(() => {
    let active = true;
    void fetchData().then((result) => {
      if (active) applyFetchedData(...result);
    }).catch((fetchError: unknown) => {
      if (!active) return;
      setError(`Production sheets could not be loaded: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [applyFetchedData, fetchData]);

  useEffect(() => {
    if (!viewingReport) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewingReport(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [viewingReport]);

  const clearForm = () => {
    setEditingId(null);
    setReportDate(today());
    setRoomName("");
    setPackingIncharge("");
    setProductionIncharge("");
    setDailyTarget("");
    setRows([emptyRow()]);
  };

  const updateRow = (index: number, update: Partial<ProductionRow>) => {
    setRows((current) => current.map((row, rowIndex) =>
      rowIndex === index ? { ...row, ...update } : row,
    ));
  };

  const editReport = (report: ProductionSheet) => {
    setEditingId(report.id);
    setReportDate(report.report_date);
    setRoomName(report.room_name);
    setPackingIncharge(report.packing_incharge);
    setProductionIncharge(report.production_incharge);
    setDailyTarget(String(report.daily_target ?? ""));
    setRows(report.rows.length ? report.rows : [emptyRow()]);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = {
      report_date: reportDate,
      room_name: roomName.trim(),
      packing_incharge: packingIncharge.trim(),
      production_incharge: productionIncharge.trim(),
      daily_target: numericValue(dailyTarget),
      rows,
      updated_at: new Date().toISOString(),
    };
    const result = editingId
      ? await supabase.from("production_data_sheets").update(payload).eq("id", editingId)
      : await supabase.from("production_data_sheets").insert(payload);

    if (result.error) {
      setError(`Report could not be saved: ${result.error.message}`);
      setSaving(false);
      return;
    }
    setNotice(editingId ? "Production sheet updated." : "Production sheet saved.");
    clearForm();
    await loadData();
    setSaving(false);
  };

  const deleteReport = async (report: ProductionSheet) => {
    if (!window.confirm(`Delete the production sheet for ${report.room_name} on ${report.report_date}?`)) return;
    setError(null);
    const { error: deleteError } = await supabase
      .from("production_data_sheets")
      .delete()
      .eq("id", report.id);
    if (deleteError) {
      setError(`Report could not be deleted: ${deleteError.message}`);
      return;
    }
    if (editingId === report.id) clearForm();
    setNotice("Production sheet deleted.");
    await loadData();
  };

  const addOption = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newOptionName.trim();
    if (!name) return;
    setError(null);
    const { error: insertError } = await supabase
      .from("production_sheet_options")
      .insert({ option_type: newOptionType, name });
    if (insertError) {
      setError(`Option could not be added: ${insertError.message}`);
      return;
    }
    setNewOptionName("");
    setNotice(`${optionLabel[newOptionType]} added.`);
    await loadData();
  };

  const deleteOption = async (option: ProductionOption) => {
    if (!window.confirm(`Remove ${option.name} from the options list? Existing reports will be kept.`)) return;
    const { error: deleteError } = await supabase
      .from("production_sheet_options")
      .delete()
      .eq("id", option.id);
    if (deleteError) {
      setError(`Option could not be removed: ${deleteError.message}`);
      return;
    }
    await loadData();
  };

  const hourlyTotals = HOUR_SLOTS.map((hour) =>
    rows.reduce((total, row) => total + numericValue(row.hourly[hour] ?? ""), 0),
  );

  const createReportPdf = (report: ProductionSheet) => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm" });
    const total = reportTotal(report);
    const pageWidth = doc.internal.pageSize.getWidth();
    const hourlyHeaders = HOUR_SLOTS.map((hour) => hour === "14:00" ? "BREAK" : hour);
    const body = (report.rows ?? []).map((row, index) => [
      index + 1,
      row.incharge_name || "-",
      row.product_name || "-",
      row.batch_no || "-",
      row.retail_price || "-",
      row.mfg_date || "-",
      row.exp_date || "-",
      row.carton_no || "-",
      row.pcs_per_carton || "-",
      row.pcs_weight || "-",
      ...HOUR_SLOTS.map((hour) => hour === "14:00" ? "BREAK" : row.hourly?.[hour] || "-"),
      rowTotal(row).toLocaleString(),
      rowCartons(row) === null ? "-" : formatCartons(rowCartons(row) ?? 0),
    ]);

    doc.setProperties({ title: reportTitle(report), subject: "Hourly production report" });
    doc.setFillColor(8, 145, 178);
    doc.rect(0, 0, pageWidth, 32, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("HOURLY PRODUCTION REPORT", 14, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`${report.room_name}  |  ${report.report_date} (${formatDay(report.report_date)})`, 14, 21);
    doc.text(
      `Packing: ${report.packing_incharge}  |  Production: ${report.production_incharge}  |  Target: ${Number(report.daily_target || 0).toLocaleString()} pcs  |  Total: ${total.toLocaleString()} pcs`,
      14,
      27,
    );
    autoTable(doc, {
      startY: 37,
      head: [[
        "#", "Incharge", "Product", "Batch", "Retail", "MFG", "EXP", "C/No",
        "P/Carton", "P/C weight", ...hourlyHeaders, "Total pcs", "Cartons made",
      ]],
      body,
      theme: "grid",
      styles: { fontSize: 5.5, cellPadding: 1.2, overflow: "linebreak" },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 5.5 },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: { 0: { cellWidth: 6 }, 2: { cellWidth: 24 }, 3: { cellWidth: 15 } },
    });

    const fileName = `production_report_${report.report_date}_${report.room_name}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    return { doc, fileName };
  };

  const downloadReportPdf = (report: ProductionSheet) => {
    const { doc, fileName } = createReportPdf(report);
    doc.save(`${fileName}.pdf`);
  };

  const shareReport = async (report: ProductionSheet) => {
    const text = reportShareText(report);
    const { doc, fileName } = createReportPdf(report);
    const file = new File([doc.output("blob")], `${fileName}.pdf`, { type: "application/pdf" });

    if (navigator.share) {
      try {
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title: reportTitle(report), text, files: [file] });
        } else {
          await navigator.share({ title: reportTitle(report), text });
        }
      } catch (shareError) {
        if (shareError instanceof Error && shareError.name === "AbortError") return;
        setError(`Report could not be shared: ${shareError instanceof Error ? shareError.message : String(shareError)}`);
      }
      return;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="min-h-screen bg-[#0b0f19] p-3 font-sans text-slate-100 sm:p-6">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-cyan-400">Production Records</p>
            <h1 className="mt-1 text-xl font-extrabold sm:text-2xl">Hourly Production Data Sheet</h1>
          </div>
          <nav className="flex flex-wrap gap-2">
            <Link href="/inventory-viewer" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold hover:bg-slate-700">Inventory Viewer</Link>
            <button type="button" onClick={() => void loadData()} className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-bold hover:bg-cyan-600">Refresh</button>
          </nav>
        </header>

        {error && <p role="alert" className="rounded-lg border border-rose-700 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-emerald-700 bg-emerald-950/50 p-3 text-sm text-emerald-200">{notice}</p>}

        <form onSubmit={saveReport} className="space-y-5 rounded-xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <h2 className="text-lg font-bold">{editingId ? "Edit production sheet" : "Create production sheet"}</h2>
            {editingId && <button type="button" onClick={clearForm} className="self-start text-xs font-bold text-slate-300 underline">Cancel edit</button>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="text-xs font-semibold text-slate-300">Date
              <input type="date" required value={reportDate} onChange={(event) => setReportDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2 text-sm text-white" />
            </label>
            <label className="text-xs font-semibold text-slate-300">Day
              <input readOnly value={formatDay(reportDate)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-slate-300" />
            </label>
            <label className="text-xs font-semibold text-slate-300">Room / floor
              <input list="production-rooms" required value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Packing Ground Floor" className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2 text-sm text-white" />
              <datalist id="production-rooms">{options.filter((option) => option.option_type === "room").map((option) => <option key={option.id} value={option.name} />)}</datalist>
            </label>
            <label className="text-xs font-semibold text-slate-300">Packing incharge
              <input list="production-incharges" required value={packingIncharge} onChange={(event) => setPackingIncharge(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2 text-sm text-white" />
            </label>
            <label className="text-xs font-semibold text-slate-300">Production incharge
              <input list="production-incharges" required value={productionIncharge} onChange={(event) => setProductionIncharge(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2 text-sm text-white" />
            </label>
            <datalist id="production-incharges">{options.filter((option) => option.option_type === "incharge").map((option) => <option key={option.id} value={option.name} />)}</datalist>
            <label className="text-xs font-semibold text-slate-300">Daily target (pcs)
              <input type="number" min="0" value={dailyTarget} onChange={(event) => setDailyTarget(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2 text-sm text-white" />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold">Product rows</h3>
              <p className="text-xs text-slate-400">Hourly cells accept quantities or notes such as STICKER / -; numeric values are totaled. Cartons made = total pcs ÷ pcs per carton.</p>
            </div>
            <button type="button" onClick={() => setRows((current) => [...current, emptyRow()])} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold hover:bg-emerald-600">+ Add product row</button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="min-w-[1900px] border-collapse text-left text-xs">
              <thead className="bg-slate-800 text-slate-200">
                <tr>
                  <th className="p-2">#</th><th className="p-2">Incharge name</th><th className="p-2">Product name & size</th><th className="p-2">Batch no</th><th className="p-2">Retail price</th><th className="p-2">MFG</th><th className="p-2">EXP</th><th className="p-2">C/No</th><th className="p-2">P/Carton</th><th className="p-2">P/C weight</th>
                  {HOUR_SLOTS.map((hour) => <th key={hour} className={`min-w-20 p-2 text-center ${hour === "14:00" ? "bg-blue-900/70" : ""}`}>{hour === "14:00" ? "2 PM BREAK" : `${Number(hour.slice(0, 2)) % 12 || 12}:00 ${Number(hour.slice(0, 2)) < 12 ? "AM" : "PM"}`}</th>)}
                  <th className="p-2 text-right">Total pcs</th><th className="p-2 text-right">Cartons made</th><th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-t border-slate-800 align-top">
                    <td className="p-2 text-slate-400">{index + 1}</td>
                    <td className="p-1"><input list="production-incharges" aria-label={`Row ${index + 1} incharge`} value={row.incharge_name} onChange={(event) => updateRow(index, { incharge_name: event.target.value })} className="w-28 rounded border border-slate-700 bg-[#0b0f19] p-2" /></td>
                    <td className="p-1"><input required aria-label={`Row ${index + 1} product name`} value={row.product_name} onChange={(event) => updateRow(index, { product_name: event.target.value })} className="w-44 rounded border border-slate-700 bg-[#0b0f19] p-2" /></td>
                    <td className="p-1"><input value={row.batch_no} onChange={(event) => updateRow(index, { batch_no: event.target.value })} className="w-24 rounded border border-slate-700 bg-[#0b0f19] p-2" /></td>
                    <td className="p-1"><input value={row.retail_price} onChange={(event) => updateRow(index, { retail_price: event.target.value })} className="w-24 rounded border border-slate-700 bg-[#0b0f19] p-2" /></td>
                    <td className="p-1"><input type="date" value={row.mfg_date} onChange={(event) => updateRow(index, { mfg_date: event.target.value })} className="w-32 rounded border border-slate-700 bg-[#0b0f19] p-2" /></td>
                    <td className="p-1"><input type="date" value={row.exp_date} onChange={(event) => updateRow(index, { exp_date: event.target.value })} className="w-32 rounded border border-slate-700 bg-[#0b0f19] p-2" /></td>
                    <td className="p-1"><input value={row.carton_no} onChange={(event) => updateRow(index, { carton_no: event.target.value })} className="w-20 rounded border border-slate-700 bg-[#0b0f19] p-2" /></td>
                    <td className="p-1"><input type="number" min="0" value={row.pcs_per_carton} onChange={(event) => updateRow(index, { pcs_per_carton: event.target.value })} className="w-20 rounded border border-slate-700 bg-[#0b0f19] p-2" /></td>
                    <td className="p-1"><input value={row.pcs_weight} onChange={(event) => updateRow(index, { pcs_weight: event.target.value })} className="w-20 rounded border border-slate-700 bg-[#0b0f19] p-2" /></td>
                    {HOUR_SLOTS.map((hour) => (
                      <td key={hour} className={`p-1 ${hour === "14:00" ? "bg-blue-950/50" : ""}`}>
                        {hour === "14:00"
                          ? <span className="block p-2 text-center text-slate-500">BREAK</span>
                          : <input aria-label={`Row ${index + 1} ${hour}`} value={row.hourly[hour] ?? ""} onChange={(event) => updateRow(index, { hourly: { ...row.hourly, [hour]: event.target.value } })} className="w-20 rounded border border-slate-700 bg-[#0b0f19] p-2 text-right" />}
                      </td>
                    ))}
                    <td className="p-2 text-right font-bold text-amber-300">{rowTotal(row).toLocaleString()}</td>
                    <td className="p-2 text-right font-bold text-cyan-300">{rowCartons(row) === null ? "—" : formatCartons(rowCartons(row) ?? 0)}</td>
                    <td className="p-1"><button type="button" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="rounded border border-rose-800 px-2 py-2 text-rose-300 disabled:opacity-40">Remove</button></td>
                  </tr>
                ))}
                <tr className="border-t border-slate-600 bg-blue-950/70 font-bold">
                  <td colSpan={10} className="p-2 text-right">HOURLY TOTAL</td>
                  {hourlyTotals.map((total, index) => <td key={HOUR_SLOTS[index]} className="p-2 text-right">{HOUR_SLOTS[index] === "14:00" ? "BREAK" : total.toLocaleString()}</td>)}
                  <td className="p-2 text-right text-amber-300">{totalProduction.toLocaleString()}</td>
                  <td className="p-2 text-right text-cyan-300">{formatCartons(rows.reduce((total, row) => total + (rowCartons(row) ?? 0), 0))}</td><td />
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <p className="font-bold">Total production: <span className="text-amber-300">{totalProduction.toLocaleString()} pcs</span>
              {numericValue(dailyTarget) > 0 && <span className="ml-3 text-slate-300">Target: {numericValue(dailyTarget).toLocaleString()} pcs · {((totalProduction / numericValue(dailyTarget)) * 100).toFixed(2)}%</span>}
            </p>
            <button type="submit" disabled={saving} className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-bold hover:bg-cyan-600 disabled:opacity-50">{saving ? "Saving..." : editingId ? "Update sheet" : "Save sheet"}</button>
          </div>
        </form>

        <section className="space-y-3 rounded-xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-bold">Saved production records</h2><p className="text-xs text-slate-400">Admin and Inventory Viewer can open, edit, or delete saved sheets.</p></div>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{reports.length} reports</span>
          </div>
          {loading ? <p className="text-sm text-slate-400">Loading production records...</p> : reports.length === 0 ? <p className="text-sm text-slate-400">No production sheets saved yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-400"><tr><th className="p-2">Date</th><th className="p-2">Day</th><th className="p-2">Room / floor</th><th className="p-2">Packing incharge</th><th className="p-2">Production incharge</th><th className="p-2 text-right">Total pcs</th><th className="p-2">Actions</th></tr></thead>
                <tbody>{reports.map((report) => {
                  const total = reportTotal(report);
                  return <tr key={report.id} className="border-t border-slate-800"><td className="p-2">{report.report_date}</td><td className="p-2">{formatDay(report.report_date)}</td><td className="p-2">{report.room_name}</td><td className="p-2">{report.packing_incharge}</td><td className="p-2">{report.production_incharge}</td><td className="p-2 text-right font-bold text-amber-300">{total.toLocaleString()}</td><td className="whitespace-nowrap p-2"><button type="button" onClick={() => setViewingReport(report)} className="mr-2 inline-flex items-center gap-1 rounded bg-slate-700 px-3 py-1.5 text-xs font-bold hover:bg-slate-600"><Eye size={14} />View</button><button type="button" onClick={() => void shareReport(report)} className="mr-2 inline-flex items-center gap-1 rounded bg-emerald-800 px-3 py-1.5 text-xs font-bold hover:bg-emerald-700"><Share2 size={14} />Share</button><button type="button" onClick={() => editReport(report)} className="mr-2 rounded bg-cyan-800 px-3 py-1.5 text-xs font-bold">Edit</button><button type="button" onClick={() => void deleteReport(report)} className="rounded bg-rose-900 px-3 py-1.5 text-xs font-bold">Delete</button></td></tr>;
                })}</tbody>
              </table>
            </div>
          )}
        </section>

        {viewingReport && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
            onClick={(event) => {
              if (event.target === event.currentTarget) setViewingReport(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="production-report-title"
              className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0f172a] shadow-2xl shadow-black/50"
            >
              <div className="bg-gradient-to-r from-cyan-950 via-slate-900 to-indigo-950 p-5 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Production report</p>
                    <h2 id="production-report-title" className="mt-2 text-2xl font-extrabold text-white sm:text-3xl">{viewingReport.room_name}</h2>
                    <p className="mt-1 text-sm text-slate-300">{viewingReport.report_date} · {formatDay(viewingReport.report_date)}</p>
                  </div>
                  <button type="button" onClick={() => setViewingReport(null)} aria-label="Close report preview" className="rounded-full border border-slate-600 p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white">
                    <X size={18} />
                  </button>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-slate-400">Total production</p><p className="mt-1 text-xl font-extrabold text-amber-300">{reportTotal(viewingReport).toLocaleString()} <span className="text-xs font-semibold">pcs</span></p></div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-slate-400">Cartons (equivalent)</p><p className="mt-1 text-xl font-extrabold text-cyan-300">{formatCartons(reportCartons(viewingReport))}</p></div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-slate-400">Daily target</p><p className="mt-1 text-xl font-extrabold text-white">{Number(viewingReport.daily_target || 0).toLocaleString()} <span className="text-xs font-semibold">pcs</span></p></div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-slate-400">Packing incharge</p><p className="mt-1 truncate font-bold text-white">{viewingReport.packing_incharge}</p></div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-slate-400">Production incharge</p><p className="mt-1 truncate font-bold text-white">{viewingReport.production_incharge}</p></div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void shareReport(viewingReport)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500"><Share2 size={16} />Share report</button>
                  <button type="button" onClick={() => downloadReportPdf(viewingReport)} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700"><Download size={16} />Download PDF</button>
                </div>
              </div>
              <div className="p-4 sm:p-6">
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div><h3 className="font-bold text-white">Product breakdown</h3><p className="text-xs text-slate-400">{viewingReport.rows?.length ?? 0} product rows · hourly quantities and notes</p></div>
                  <span className="text-xs font-semibold text-slate-400">14:00 is the break</span>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-700">
                  <table className="w-full min-w-[1500px] border-collapse text-left text-xs">
                    <thead className="bg-slate-800 text-slate-300">
                      <tr>
                        <th className="p-2">#</th><th className="p-2">Incharge</th><th className="p-2">Product / size</th><th className="p-2">Batch</th><th className="p-2">Retail</th><th className="p-2">MFG</th><th className="p-2">EXP</th><th className="p-2">C/No</th><th className="p-2">P/Carton</th><th className="p-2">P/C weight</th>
                        {HOUR_SLOTS.map((hour) => <th key={hour} className={`min-w-20 p-2 text-center ${hour === "14:00" ? "bg-blue-900/70" : ""}`}>{hour === "14:00" ? "BREAK" : hour}</th>)}
                        <th className="p-2 text-right">Total pcs</th><th className="p-2 text-right">Cartons made</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(viewingReport.rows ?? []).map((row, index) => (
                        <tr key={`${row.product_name}-${index}`} className="border-t border-slate-800 text-slate-200">
                          <td className="p-2 text-slate-500">{index + 1}</td><td className="p-2">{row.incharge_name || "—"}</td><td className="p-2 font-semibold text-white">{row.product_name || "—"}</td><td className="p-2">{row.batch_no || "—"}</td><td className="p-2">{row.retail_price || "—"}</td><td className="p-2">{row.mfg_date || "—"}</td><td className="p-2">{row.exp_date || "—"}</td><td className="p-2">{row.carton_no || "—"}</td><td className="p-2">{row.pcs_per_carton || "—"}</td><td className="p-2">{row.pcs_weight || "—"}</td>
                          {HOUR_SLOTS.map((hour) => <td key={hour} className={`p-2 text-center ${hour === "14:00" ? "bg-blue-950/40 text-slate-500" : ""}`}>{hour === "14:00" ? "—" : row.hourly?.[hour] || "—"}</td>)}
                          <td className="p-2 text-right font-bold text-amber-300">{rowTotal(row).toLocaleString()}</td><td className="p-2 text-right font-bold text-cyan-300">{rowCartons(row) === null ? "—" : formatCartons(rowCartons(row) ?? 0)}</td>
                        </tr>
                      ))}
                      {(viewingReport.rows ?? []).length === 0 && <tr><td colSpan={24} className="p-8 text-center text-slate-400">No product rows in this report.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        )}

        <section className="space-y-3 rounded-xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
          <h2 className="text-lg font-bold">Manage room and incharge options</h2>
          <p className="text-xs text-slate-400">Options are suggestions; removing one does not change saved reports.</p>
          <form onSubmit={addOption} className="flex flex-col gap-2 sm:flex-row">
            <select value={newOptionType} onChange={(event) => setNewOptionType(event.target.value as OptionType)} className="rounded-lg border border-slate-700 bg-[#0b0f19] p-2 text-sm">
              <option value="room">Room / floor</option><option value="incharge">Incharge</option>
            </select>
            <input required value={newOptionName} onChange={(event) => setNewOptionName(event.target.value)} placeholder="Enter a name" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-[#0b0f19] p-2 text-sm" />
            <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold">Add option</button>
          </form>
          <div className="flex flex-wrap gap-2">
            {options.map((option) => <span key={option.id} className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs">{optionLabel[option.option_type]}: {option.name}<button type="button" onClick={() => void deleteOption(option)} aria-label={`Remove ${option.name}`} className="font-bold text-rose-300">×</button></span>)}
            {options.length === 0 && <p className="text-xs text-slate-500">No saved options yet. You can also type a room or incharge directly in the sheet.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
