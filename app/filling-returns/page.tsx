"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  FillingMaterialReturn,
  FillingMaterialReturnComponent,
  FillingMaterialReturnDestination,
  FillingMaterialReturnKind,
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

interface ComponentRow {
  component_type: string;
  quantity: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const FILLING_RETURNS_ENABLED = false;

function FillingReturnsFeature() {
  const [parties, setParties] = useState<Party[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [records, setRecords] = useState<FillingMaterialReturn[]>([]);
  const [partyId, setPartyId] = useState("");
  const [productId, setProductId] = useState("");
  const [componentTypes, setComponentTypes] = useState<string[]>([]);
  const [kind, setKind] = useState<FillingMaterialReturnKind>("RETURN");
  const [destination, setDestination] = useState<FillingMaterialReturnDestination>("WAREHOUSE");
  const [batchNo, setBatchNo] = useState("");
  const [partyReturnDate, setPartyReturnDate] = useState(today);
  const [components, setComponents] = useState<ComponentRow[]>([
    { component_type: "", quantity: "" },
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedParty = parties.find((party) => party.id === partyId);
  const selectedProduct = products.find((product) => product.id === productId);
  const filteredProducts = useMemo(
    () => products.filter((product) => product.party_id === partyId),
    [partyId, products]
  );

  const fetchPageData = useCallback(async () => {
    const [partyResult, productResult, recordResult] = await Promise.all([
      supabase.from("parties").select("id, name").order("name"),
      supabase.from("products").select("id, product_name, party_id").order("product_name"),
      supabase.from("filling_material_returns").select("*").order("created_at", { ascending: false }),
    ]);

    const requestError = partyResult.error ?? productResult.error ?? recordResult.error;
    if (requestError) {
      if (isFillingMaterialReturnsTableMissing(requestError)) {
        return {
          parties: partyResult.data ?? [],
          products: productResult.data ?? [],
          records: [] as FillingMaterialReturn[],
          fillingMaterialReturnsTableMissing: true,
        };
      }
      throw requestError;
    }

    return {
      parties: partyResult.data ?? [],
      products: productResult.data ?? [],
      records: (recordResult.data ?? []) as FillingMaterialReturn[],
      fillingMaterialReturnsTableMissing: false,
    };
  }, []);

  const applyPageData = useCallback((data: Awaited<ReturnType<typeof fetchPageData>>) => {
    setError(data.fillingMaterialReturnsTableMissing ? getFillingMaterialReturnsSetupMessage() : "");
    setParties(data.parties);
    setProducts(data.products);
    setRecords(data.records);
  }, []);

  const refreshData = async () => {
    applyPageData(await fetchPageData());
  };

  useEffect(() => {
    let active = true;
    void fetchPageData()
      .then((data) => {
        if (active) applyPageData(data);
      })
      .catch((fetchError: unknown) => {
        if (!active) return;
        console.error("Could not load filling return records:", fetchError);
        setError(
          isFillingMaterialReturnsTableMissing(fetchError)
            ? getFillingMaterialReturnsSetupMessage()
            : fetchError instanceof Error
              ? fetchError.message
              : "Could not load filling return records."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyPageData, fetchPageData]);

  const updateComponent = (index: number, field: keyof ComponentRow, value: string) => {
    setComponents((rows) =>
      rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row)
    );
  };

  const handleProductChange = async (nextProductId: string) => {
    setProductId(nextProductId);
    setComponentTypes([]);
    setComponents([{ component_type: "", quantity: "" }]);
    setError("");
    if (!nextProductId) return;

    const { data, error: bomError } = await supabase
      .from("product_bom")
      .select("component_type")
      .eq("product_id", nextProductId);
    if (bomError) {
      setError(`Could not load product components: ${bomError.message}`);
      return;
    }

    const types = Array.from(new Set((data ?? [])
      .map((item) => item.component_type?.trim())
      .filter((value): value is string => Boolean(value))));
    setComponentTypes(types);
    if (types.length > 0) {
      setComponents(types.map((component_type) => ({ component_type, quantity: "" })));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!selectedParty || !selectedProduct) {
      setError("Please select a party and product.");
      return;
    }
    if (
      components.length === 0 ||
      components.some((component) =>
        !component.component_type.trim() ||
        !Number.isSafeInteger(Number(component.quantity)) ||
        Number(component.quantity) <= 0
      )
    ) {
      setError("Enter a component name and a whole-number quantity greater than zero for every row.");
      return;
    }
    if (destination === "PARTY" && !partyReturnDate) {
      setError("Select the date the items are being returned to the party.");
      return;
    }

    const normalizedComponents: FillingMaterialReturnComponent[] = components.map((component) => ({
      component_type: component.component_type.trim().toLowerCase(),
      quantity: Number(component.quantity),
    }));
    const duplicateType = normalizedComponents.some((component, index) =>
      normalizedComponents.findIndex((item) => item.component_type === component.component_type) !== index
    );
    if (duplicateType) {
      setError("Use one row per component type; combine duplicate quantities.");
      return;
    }

    setSaving(true);
    try {
      const { error: saveError } = await supabase.from("filling_material_returns").insert({
        kind,
        destination,
        party_id: selectedParty.id,
        party_name: selectedParty.name,
        product_id: selectedProduct.id,
        product_name: selectedProduct.product_name,
        batch_no: batchNo.trim() || null,
        components: normalizedComponents,
        party_return_date: destination === "PARTY" ? partyReturnDate : null,
        status: destination === "PARTY" ? "RETURNED_TO_PARTY" : "PENDING_WAREHOUSE",
      });
      if (saveError) throw saveError;

      setNotice(destination === "PARTY"
        ? `${kind === "DAMAGED" ? "Damaged items" : "Usable return"} recorded as returned to the party.`
        : kind === "RETURN"
          ? "Return request saved. Warehouse will add it to inventory after receiving it."
          : "Damage record saved for warehouse receipt. Damaged items will not be added to usable stock.");
      setPartyId("");
      setProductId("");
      setComponentTypes([]);
      setDestination("WAREHOUSE");
      setBatchNo("");
      setPartyReturnDate(today());
      setComponents([{ component_type: "", quantity: "" }]);
      try {
        await refreshData();
      } catch (refreshError: unknown) {
        console.error("Return record saved, but refreshing the list failed:", refreshError);
        setError(
          refreshError instanceof Error
            ? `Record saved, but the list could not be refreshed: ${refreshError.message}`
            : "Record saved, but the list could not be refreshed."
        );
      }

    } catch (saveError: unknown) {
      console.error("Could not save filling return record:", saveError);
      setError(
        isFillingMaterialReturnsTableMissing(saveError)
          ? getFillingMaterialReturnsSetupMessage()
          : saveError instanceof Error
            ? saveError.message
            : "Could not save this record."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0b0f19] p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Filling Department</p>
            <h1 className="mt-1 text-2xl font-extrabold text-white">Material Returns & Damage</h1>
            <p className="mt-1 text-xs text-slate-400">
              Usable returns enter inventory only after warehouse receipt. Damaged items never enter usable stock.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2 text-xs">
            <Link className="rounded-lg bg-slate-800 px-3 py-2 hover:bg-slate-700" href="/filling">Filling</Link>
          </nav>
        </header>

        {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300">{notice}</p>}

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
          <h2 className="text-sm font-bold text-white">Create a return or damage record</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-slate-300">
              Record type
              <select value={kind} onChange={(event) => setKind(event.target.value as FillingMaterialReturnKind)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white">
                <option value="RETURN">Usable return</option>
                <option value="DAMAGED">Damaged</option>
              </select>
            </label>
            <label className="text-xs text-slate-300">
              Destination
              <select value={destination} onChange={(event) => setDestination(event.target.value as FillingMaterialReturnDestination)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white">
                <option value="WAREHOUSE">Warehouse</option>
                <option value="PARTY">Party</option>
              </select>
            </label>
            <label className="text-xs text-slate-300">
              Party
              <select required value={partyId} onChange={(event) => { setPartyId(event.target.value); setProductId(""); setComponentTypes([]); setComponents([{ component_type: "", quantity: "" }]); }} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white">
                <option value="">Select party</option>
                {parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-300">
              Product
              <select required value={productId} onChange={(event) => void handleProductChange(event.target.value)} disabled={!partyId} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white disabled:opacity-50">
                <option value="">Select product</option>
                {filteredProducts.map((product) => <option key={product.id} value={product.id}>{product.product_name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-300">
              Batch number (optional)
              <input value={batchNo} onChange={(event) => setBatchNo(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white" placeholder="Batch / filling request no." />
            </label>
            {destination === "PARTY" && (
              <label className="text-xs text-slate-300">
                Date returned to party
                <input required type="date" value={partyReturnDate} onChange={(event) => setPartyReturnDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-white" />
              </label>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase text-cyan-300">Components and quantities</h3>
              <button type="button" disabled={componentTypes.length === 0} onClick={() => setComponents((rows) => [...rows, { component_type: "", quantity: "" }])} className="rounded-lg border border-cyan-800 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-950/40 disabled:opacity-40">Add component</button>
            </div>
            {productId && componentTypes.length === 0 && (
              <p className="text-xs text-amber-300">No components are configured for this product in its BOM.</p>
            )}
            {components.map((component, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <select aria-label={`Component ${index + 1}`} required value={component.component_type} onChange={(event) => updateComponent(index, "component_type", event.target.value)} disabled={componentTypes.length === 0} className="min-w-0 rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-sm text-white disabled:opacity-50">
                  <option value="">Select component</option>
                  {componentTypes.map((componentType) => <option key={componentType} value={componentType}>{componentType}</option>)}
                </select>
                <input aria-label={`Quantity ${index + 1}`} type="number" min="1" step="1" value={component.quantity} onChange={(event) => updateComponent(index, "quantity", event.target.value)} className="min-w-0 rounded-lg border border-slate-700 bg-[#0b0f19] p-3 text-sm text-white" placeholder="Quantity (pcs)" />
                <button type="button" aria-label={`Remove component ${index + 1}`} disabled={components.length === 1} onClick={() => setComponents((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="rounded-lg px-3 text-slate-400 hover:bg-rose-950 hover:text-rose-300 disabled:opacity-30">Remove</button>
              </div>
            ))}
          </div>

          <button type="submit" disabled={saving || loading} className="rounded-lg bg-cyan-600 px-5 py-3 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50">
            {saving ? "Saving..." : "Save return / damage record"}
          </button>
        </form>

        <section className="space-y-4 rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-white">Returns and damage status</h2>
            <button type="button" onClick={() => void refreshData().catch((fetchError: unknown) => setError(fetchError instanceof Error ? fetchError.message : "Refresh failed."))} className="rounded-lg bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700">Refresh</button>
          </div>
          {loading ? <p className="text-sm text-slate-400">Loading records...</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-xs text-slate-300">
                <thead className="bg-[#0b0f19] uppercase text-slate-400">
                  <tr>
                    <th className="p-3">Date / Batch</th><th className="p-3">Party / Product</th><th className="p-3">Destination</th><th className="p-3">Components / Qty</th><th className="p-3">Party return date</th><th className="p-3">Status</th><th className="p-3">Warehouse received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td className="p-3"><span className="font-mono text-purple-300">{record.batch_no || "—"}</span><div className="mt-1 text-[10px] text-slate-500">{new Date(record.created_at).toLocaleDateString()}</div></td>
                      <td className="p-3"><div className="font-semibold text-white">{record.party_name}</div><div className="text-emerald-300">{record.product_name}</div></td>
                      <td className="p-3">{record.destination === "PARTY" ? "Party" : "Warehouse"}</td>
                      <td className="p-3"><span className={`font-bold ${record.kind === "DAMAGED" ? "text-rose-300" : "text-cyan-300"}`}>{record.kind === "DAMAGED" ? "DAMAGED" : "RETURN"}</span>{record.components.map((component, index) => <div key={`${component.component_type}-${index}`} className="mt-1">{component.component_type}: {component.quantity} pcs</div>)}</td>
                      <td className="p-3">{record.party_return_date ? new Date(`${record.party_return_date}T00:00:00`).toLocaleDateString() : "—"}</td>
                      <td className="p-3"><span className={`inline-block rounded px-2 py-1 text-[10px] font-bold ${record.kind === "DAMAGED" ? "bg-rose-950 text-rose-300" : "bg-amber-950 text-amber-300"}`}>{getFillingMaterialReturnStatusLabel(record)}</span></td>
                      <td className="p-3">{record.received_at ? new Date(record.received_at).toLocaleString() : "Pending"}</td>
                    </tr>
                  ))}
                  {records.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No return or damage records yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function FillingReturnsPage() {
  if (FILLING_RETURNS_ENABLED) return <FillingReturnsFeature />;

  return (
    <main className="min-h-screen bg-[#0b0f19] p-4 text-slate-100 sm:p-6">
      <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-cyan-400">Filling Department</p>
        <h1 className="mt-3 text-3xl font-extrabold text-white">Returns &amp; Damage</h1>
        <p className="mt-4 rounded-xl border border-slate-700 bg-[#121827] px-6 py-4 text-lg font-semibold text-amber-300">
          Coming Soon
        </p>
        <Link className="mt-6 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700" href="/filling">
          Back to Filling
        </Link>
      </div>
    </main>
  );
}
