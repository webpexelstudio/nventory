"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getPartyProductMrpErrorMessage } from "@/lib/party-product-mrp";

interface Party {
  id: string;
  name: string;
}

interface Product {
  id: string;
  product_name: string;
  party_id: string;
}

interface SavedMrp {
  party_id: string;
  product_id: string;
  mrp: number;
  batch_qty: number | null;
  batch_no: string | null;
  mfg_date: string | null;
  exp_date: string | null;
  updated_at: string;
}

export default function PartyProductMrpPage() {
  const [parties, setParties] = useState<Party[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [savedMrps, setSavedMrps] = useState<SavedMrp[]>([]);
  const [partyId, setPartyId] = useState("");
  const [productId, setProductId] = useState("");
  const [mrp, setMrp] = useState("");
  const [batchQty, setBatchQty] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [mfgDate, setMfgDate] = useState("");
  const [expDate, setExpDate] = useState("");
  const [mrpExists, setMrpExists] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingMrp, setLoadingMrp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [savedMrpsError, setSavedMrpsError] = useState<string | null>(null);
  const [loadingSavedMrps, setLoadingSavedMrps] = useState(true);
  const lookupSequence = useRef(0);

  const loadSavedMrps = useCallback(async () => {
    setLoadingSavedMrps(true);
    setSavedMrpsError(null);
    try {
      const { data, error: loadError } = await supabase
        .from("party_product_mrps")
        .select("party_id, product_id, mrp, batch_qty, batch_no, mfg_date, exp_date, updated_at")
        .order("updated_at", { ascending: false });
      if (loadError) throw loadError;
      setSavedMrps(data ?? []);
    } catch (loadError) {
      console.error("Could not load saved party product MRPs:", loadError);
      setSavedMrpsError(getPartyProductMrpErrorMessage(loadError, "Could not load saved MRP records."));
    } finally {
      setLoadingSavedMrps(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const loadOptions = async () => {
      setLoadingOptions(true);
      setOptionsError(null);
      try {
        const [partyResult, productResult] = await Promise.all([
          supabase.from("parties").select("id, name").order("name"),
          supabase.from("products").select("id, product_name, party_id").order("product_name"),
        ]);
        if (partyResult.error) throw partyResult.error;
        if (productResult.error) throw productResult.error;
        if (!disposed) {
          setParties(partyResult.data ?? []);
          setProducts(productResult.data ?? []);
        }
      } catch (loadError) {
        if (!disposed) {
          console.error("Could not load parties and products for MRP management:", loadError);
          setOptionsError(getPartyProductMrpErrorMessage(loadError, "Could not load parties and products."));
        }
      } finally {
        if (!disposed) setLoadingOptions(false);
      }
    };

    void loadOptions();
    return () => {
      disposed = true;
      lookupSequence.current += 1;
    };
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadSavedMrps);
  }, [loadSavedMrps]);

  const handleProductChange = async (nextProductId: string) => {
    const sequence = ++lookupSequence.current;
    setProductId(nextProductId);
    setMrp("");
    setBatchQty("");
    setBatchNo("");
    setMfgDate("");
    setExpDate("");
    setMrpExists(false);
    setSaving(false);
    setDeleting(false);
    setError(null);
    setLoadingMrp(Boolean(nextProductId));
    if (!partyId || !nextProductId) {
      setLoadingMrp(false);
      return;
    }

    try {
      const { data, error: loadError } = await supabase
        .from("party_product_mrps")
        .select("mrp, batch_qty, batch_no, mfg_date, exp_date")
        .eq("party_id", partyId)
        .eq("product_id", nextProductId)
        .maybeSingle();
      if (loadError) throw loadError;
      if (sequence === lookupSequence.current) {
        setMrpExists(Boolean(data));
        if (data) {
          setMrp(String(data.mrp));
          setBatchQty(data.batch_qty == null ? "" : String(data.batch_qty));
          setBatchNo(data.batch_no ?? "");
          setMfgDate(data.mfg_date ?? "");
          setExpDate(data.exp_date ?? "");
        }
      }
    } catch (loadError) {
      if (sequence === lookupSequence.current) {
        console.error("Could not load the saved party product MRP:", loadError);
        setError(getPartyProductMrpErrorMessage(loadError, "Could not load the saved MRP."));
      }
    } finally {
      if (sequence === lookupSequence.current) setLoadingMrp(false);
    }
  };

  const handleSave = async () => {
    if (!partyId || !productId || saving || deleting) return;
    const amount = Number(mrp);
    if (!mrp.trim() || !Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) {
      setError("Enter a valid MRP from 0 to 9,999,999,999.99.");
      return;
    }
    const fixedBatchQty = batchQty.trim() ? Number(batchQty) : null;
    if (fixedBatchQty !== null && (!Number.isSafeInteger(fixedBatchQty) || fixedBatchQty <= 0)) {
      setError("Fixed batch quantity must be a whole number greater than zero.");
      return;
    }
    if (mfgDate && expDate && expDate < mfgDate) {
      setError("Expiry date must be on or after the manufacturing date.");
      return;
    }

    const sequence = lookupSequence.current;
    setSaving(true);
    setError(null);
    try {
      const { data, error: saveError } = await supabase
        .from("party_product_mrps")
        .upsert(
          {
            party_id: partyId,
            product_id: productId,
            mrp: amount,
            batch_qty: fixedBatchQty,
            batch_no: batchNo.trim() || null,
            mfg_date: mfgDate || null,
            exp_date: expDate || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "party_id,product_id" }
        )
        .select("mrp, batch_qty, batch_no, mfg_date, exp_date")
        .single();
      if (saveError) throw saveError;
      if (!data) throw new Error("The database did not return the saved MRP.");
      if (sequence === lookupSequence.current) {
        setMrp(String(data.mrp));
        setBatchQty(data.batch_qty == null ? "" : String(data.batch_qty));
        setBatchNo(data.batch_no ?? "");
        setMfgDate(data.mfg_date ?? "");
        setExpDate(data.exp_date ?? "");
        setMrpExists(true);
      }
      await loadSavedMrps();
    } catch (saveError) {
      if (sequence === lookupSequence.current) {
        console.error("Could not save the party product MRP:", saveError);
        setError(getPartyProductMrpErrorMessage(saveError, "Could not save this MRP."));
      }
    } finally {
      if (sequence === lookupSequence.current) setSaving(false);
    }
  };

  const handleDelete = async (targetPartyId = partyId, targetProductId = productId) => {
    if (!targetPartyId || !targetProductId || saving || deleting) return;
    if (!window.confirm("Delete the saved MRP for this party and product?")) return;

    const sequence = lookupSequence.current;
    setDeleting(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from("party_product_mrps")
        .delete()
        .eq("party_id", targetPartyId)
        .eq("product_id", targetProductId);
      if (deleteError) throw deleteError;
      if (sequence === lookupSequence.current) {
        if (partyId === targetPartyId && productId === targetProductId) {
          setMrp("");
          setBatchQty("");
          setBatchNo("");
          setMfgDate("");
          setExpDate("");
          setMrpExists(false);
        }
      }
      await loadSavedMrps();
    } catch (deleteError) {
      if (sequence === lookupSequence.current) {
        console.error("Could not delete the party product MRP:", deleteError);
        setError(getPartyProductMrpErrorMessage(deleteError, "Could not delete this MRP."));
      }
    } finally {
      if (sequence === lookupSequence.current) setDeleting(false);
    }
  };

  const partyProducts = products.filter((product) => product.party_id === partyId);
  const handleEditSavedMrp = (record: SavedMrp) => {
    lookupSequence.current += 1;
    setPartyId(record.party_id);
    setProductId(record.product_id);
    setMrp(String(record.mrp));
    setBatchQty(record.batch_qty == null ? "" : String(record.batch_qty));
    setBatchNo(record.batch_no ?? "");
    setMfgDate(record.mfg_date ?? "");
    setExpDate(record.exp_date ?? "");
    setMrpExists(true);
    setLoadingMrp(false);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="min-h-screen bg-[#0b0f19] p-3 font-sans text-slate-100 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex flex-col items-start justify-between gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              FILLING &amp; PACKAGING INCHARGE PORTAL
            </p>
            <h1 className="mt-1 text-xl font-extrabold text-white sm:text-2xl">Party / Product MRP Form</h1>
          </div>
          <Link
            href="/filling"
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            Back to Filling
          </Link>
        </header>

        <section className="space-y-5 rounded-2xl border border-amber-900/50 bg-[#121827] p-4 shadow-xl sm:p-6">
          <div>
            <h2 className="text-sm font-bold text-amber-300">Save and Manage Product MRP</h2>
            <p className="mt-1 text-xs text-slate-400">
              Choose a party and its product to manage its MRP and fixed batch quantity. Saved prices and quantities are applied automatically in a new filling requisition.
            </p>
          </div>

          {loadingOptions ? (
            <p className="text-xs text-slate-400">Loading parties and products...</p>
          ) : optionsError ? (
            <p role="alert" className="text-xs text-rose-400">{optionsError}</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label htmlFor="mrp-party" className="mb-1 block text-xs text-slate-400">
                    Select Party / Company
                  </label>
                  <select
                    id="mrp-party"
                    value={partyId}
                    onChange={(event) => {
                      setPartyId(event.target.value);
                      setProductId("");
                      setMrp("");
                      setBatchQty("");
                      setBatchNo("");
                      setMfgDate("");
                      setExpDate("");
                      setMrpExists(false);
                      setLoadingMrp(false);
                      setSaving(false);
                      setDeleting(false);
                      setError(null);
                      lookupSequence.current += 1;
                    }}
                    className="w-full rounded-lg border border-slate-800 bg-[#0b0f19] p-3 text-xs text-white"
                  >
                    <option value="">-- Select Party --</option>
                    {parties.map((party) => (
                      <option key={party.id} value={party.id}>{party.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="mrp-product" className="mb-1 block text-xs text-slate-400">
                    Select Product
                  </label>
                  <select
                    id="mrp-product"
                    value={productId}
                    onChange={(event) => void handleProductChange(event.target.value)}
                    disabled={!partyId}
                    className="w-full rounded-lg border border-slate-800 bg-[#0b0f19] p-3 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">-- Select Product --</option>
                    {partyProducts.map((product) => (
                      <option key={product.id} value={product.id}>{product.product_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="mrp-amount" className="mb-1 block text-xs text-amber-400">MRP (PKR)</label>
                  <input
                    id="mrp-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={mrp}
                    onChange={(event) => {
                      setMrp(event.target.value);
                      setError(null);
                    }}
                    placeholder="e.g. 450"
                    disabled={!productId || loadingMrp}
                    className="w-full rounded-lg border border-slate-800 bg-[#0b0f19] p-3 text-xs font-mono font-bold text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label htmlFor="mrp-batch-qty" className="mb-1 block text-xs text-amber-400">
                    Fixed Batch Quantity (Pcs)
                  </label>
                  <input
                    id="mrp-batch-qty"
                    type="number"
                    min="1"
                    step="1"
                    value={batchQty}
                    onChange={(event) => {
                      setBatchQty(event.target.value);
                      setError(null);
                    }}
                    placeholder="Optional"
                    disabled={!productId || loadingMrp}
                    className="w-full rounded-lg border border-slate-800 bg-[#0b0f19] p-3 text-xs font-mono font-bold text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    When set, every requisition for this product must use this quantity.
                  </p>
                </div>
                <div>
                  <label htmlFor="mrp-batch" className="mb-1 block text-xs text-slate-400">Batch Number</label>
                  <input
                    id="mrp-batch"
                    type="text"
                    value={batchNo}
                    onChange={(event) => {
                      setBatchNo(event.target.value);
                      setError(null);
                    }}
                    placeholder="e.g. BATCH-1234"
                    disabled={!productId || loadingMrp}
                    className="w-full rounded-lg border border-slate-800 bg-[#0b0f19] p-3 text-xs font-mono text-white disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label htmlFor="mrp-mfg-date" className="mb-1 block text-xs text-slate-400">
                    Manufacturing Date
                  </label>
                  <input
                    id="mrp-mfg-date"
                    type="date"
                    value={mfgDate}
                    onChange={(event) => {
                      setMfgDate(event.target.value);
                      setError(null);
                    }}
                    disabled={!productId || loadingMrp}
                    className="w-full rounded-lg border border-slate-800 bg-[#0b0f19] p-3 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div>
                  <label htmlFor="mrp-exp-date" className="mb-1 block text-xs text-slate-400">Expiry Date</label>
                  <input
                    id="mrp-exp-date"
                    type="date"
                    min={mfgDate || undefined}
                    value={expDate}
                    onChange={(event) => {
                      setExpDate(event.target.value);
                      setError(null);
                    }}
                    disabled={!productId || loadingMrp}
                    className="w-full rounded-lg border border-slate-800 bg-[#0b0f19] p-3 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!partyId || !productId || loadingMrp || saving || deleting}
                  className="rounded-lg border border-amber-700/70 bg-amber-950/40 px-4 py-2 text-xs font-bold text-amber-200 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving..." : mrpExists ? "Update MRP" : "Save MRP"}
                </button>
                {mrpExists && (
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={loadingMrp || saving || deleting}
                    className="rounded-lg border border-rose-800/70 bg-rose-950/30 px-4 py-2 text-xs font-bold text-rose-200 hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deleting ? "Deleting..." : "Delete MRP"}
                  </button>
                )}
                {loadingMrp && <span className="text-xs text-slate-400">Loading saved MRP...</span>}
                {mrpExists && !loadingMrp && (
                  <span className="text-xs text-emerald-400">MRP saved for this party and product.</span>
                )}
              </div>
              {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
            </>
          )}
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-800 bg-[#121827] p-4 shadow-xl sm:p-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-sm font-bold text-white">Saved Party / Product MRP Records</h2>
              <p className="mt-1 text-xs text-slate-400">
                Every saved record appears here. Use Edit to load it into the form or Delete to remove it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadSavedMrps()}
              disabled={loadingSavedMrps}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              {loadingSavedMrps ? "Refreshing..." : "Refresh List"}
            </button>
          </div>

          {savedMrpsError && <p role="alert" className="text-xs text-rose-400">{savedMrpsError}</p>}
          {loadingSavedMrps ? (
            <p className="text-xs text-slate-400">Loading saved records...</p>
          ) : savedMrps.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-[#0b0f19] p-4 text-xs text-slate-400">
              No MRP records have been saved yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[850px] text-left text-xs">
                <thead className="bg-[#0b0f19] text-slate-400">
                  <tr>
                    <th className="px-3 py-3 font-semibold">Party</th>
                    <th className="px-3 py-3 font-semibold">Product</th>
                    <th className="px-3 py-3 font-semibold">MRP (PKR)</th>
                    <th className="px-3 py-3 font-semibold">Batch Qty</th>
                    <th className="px-3 py-3 font-semibold">Batch No.</th>
                    <th className="px-3 py-3 font-semibold">MFG Date</th>
                    <th className="px-3 py-3 font-semibold">EXP Date</th>
                    <th className="px-3 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {savedMrps.map((record) => (
                    <tr key={`${record.party_id}-${record.product_id}`} className="text-slate-200">
                      <td className="px-3 py-3 font-semibold">
                        {parties.find((party) => party.id === record.party_id)?.name ?? "Unknown party"}
                      </td>
                      <td className="px-3 py-3">
                        {products.find((product) => product.id === record.product_id)?.product_name ?? "Unknown product"}
                      </td>
                      <td className="px-3 py-3 font-mono font-bold text-amber-300">
                        {Number(record.mrp).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 font-mono">
                        {record.batch_qty == null ? "—" : `${Number(record.batch_qty).toLocaleString()} Pcs`}
                      </td>
                      <td className="px-3 py-3">{record.batch_no || "—"}</td>
                      <td className="px-3 py-3">{record.mfg_date || "—"}</td>
                      <td className="px-3 py-3">{record.exp_date || "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditSavedMrp(record)}
                            className="rounded border border-amber-700/70 px-2.5 py-1.5 font-bold text-amber-200 hover:bg-amber-950/50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(record.party_id, record.product_id)}
                            disabled={saving || deleting}
                            className="rounded border border-rose-800/70 px-2.5 py-1.5 font-bold text-rose-200 hover:bg-rose-950/50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
