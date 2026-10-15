"use client";

import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/lib/supabase";

interface TransportationRent {
  id: string;
  driver: string;
  vehicle: string | null;
  rent_date: string;
  amount: number;
  company: string;
  payment_status: "pending" | "paid";
  paid_at: string | null;
}

interface TransportationRentPanelProps {
  mode: "admin" | "viewer";
}

interface Company {
  id: string;
  name: string;
}

interface TransportationDriver {
  id: string;
  name: string;
}

interface TransportationVehicle {
  id: string;
  name: string;
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
};

const formatDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString();

const formatAmount = (value: number) =>
  `PKR ${Number(value).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

export default function TransportationRentPanel({ mode }: TransportationRentPanelProps) {
  const [rents, setRents] = useState<TransportationRent[]>([]);
  const [drivers, setDrivers] = useState<TransportationDriver[]>([]);
  const [vehicles, setVehicles] = useState<TransportationVehicle[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [driverName, setDriverName] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [isAddingVehicle, setIsAddingVehicle] = useState(false);
  const [editingDriver, setEditingDriver] = useState<TransportationDriver | null>(null);
  const [rentDate, setRentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [company, setCompany] = useState("");
  const [tripDetails, setTripDetails] = useState<{ id: string; name: string }[]>([]);
  const [selectedTripDetail, setSelectedTripDetail] = useState("");
  const [newTripDetail, setNewTripDetail] = useState("");
  const [isAddingTripDetail, setIsAddingTripDetail] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeTab, setActiveTab] = useState<"pending" | "paid">("pending");
  const [filterDriver, setFilterDriver] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRent, setEditingRent] = useState<TransportationRent | null>(null);

  const fetchRents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from("transportation_rents")
        .select("*")
        .order("rent_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;
      setRents((data ?? []) as TransportationRent[]);
      setError(null);
    } catch (fetchError) {
      setError(getErrorMessage(fetchError, "Could not load transportation rents."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const rentsQuery = Promise.resolve(
      supabase
        .from("transportation_rents")
        .select("*")
        .order("rent_date", { ascending: false })
        .order("created_at", { ascending: false })
    );
    const companiesQuery =
      mode === "admin"
        ? Promise.resolve(supabase.from("parties").select("id, name").order("name"))
        : Promise.resolve(null);
    const driversQuery =
      mode === "admin"
        ? Promise.resolve(supabase.from("transportation_drivers").select("id, name").order("name"))
        : Promise.resolve(null);
    const tripDetailsQuery =
      mode === "admin"
        ? Promise.resolve(supabase.from("transportation_trip_details").select("id, name").order("name"))
        : Promise.resolve(null);
    const vehiclesQuery =
      mode === "admin"
        ? Promise.resolve(supabase.from("transportation_vehicles").select("id, name").order("name"))
        : Promise.resolve(null);

    void Promise.all([rentsQuery, companiesQuery, driversQuery, tripDetailsQuery, vehiclesQuery])
      .then(([rentResult, companyResult, driverResult, tripDetailsResult, vehicleResult]) => {
        if (!isMounted) return;
        if (rentResult.error) {
          setError(rentResult.error.message);
        } else {
          setRents((rentResult.data ?? []) as TransportationRent[]);
        }
        if (companyResult?.error) {
          setError(companyResult.error.message);
        } else if (companyResult?.data) {
          setCompanies(companyResult.data as Company[]);
        }
        if (driverResult?.error) {
          setError(driverResult.error.message);
        } else if (driverResult?.data) {
          setDrivers(driverResult.data as TransportationDriver[]);
        }
        if (tripDetailsResult?.error) {
          setError(tripDetailsResult.error.message);
        } else if (tripDetailsResult?.data) {
          setTripDetails(tripDetailsResult.data);
        }
        if (vehicleResult?.error) {
          setError(vehicleResult.error.message);
        } else if (vehicleResult?.data) {
          setVehicles(vehicleResult.data as TransportationVehicle[]);
        }
      })
      .catch((fetchError: unknown) => {
        if (isMounted) {
          setError(getErrorMessage(fetchError, "Could not load transportation rents."));
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [mode]);

  const handleAddRent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountValue = Number(amount);
    const selectedCompany = companies.find((item) => item.id === company);
    const selectedDriver = drivers.find((item) => item.id === selectedDriverId);
    const selectedVehicle = vehicles.find((item) => item.id === selectedVehicleId);
    if (
      !selectedDriver ||
      !selectedVehicle ||
      !rentDate ||
      !selectedCompany ||
      !Number.isFinite(amountValue) ||
      amountValue <= 0
    ) {
      setError("Select a driver, vehicle, and registered company, choose a date, and enter an amount greater than zero.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { error: insertError } = await supabase.from("transportation_rents").insert({
        driver: selectedDriver.name,
        vehicle: selectedVehicle.name,
        rent_date: rentDate,
        amount: amountValue,
        company: selectedTripDetail
          ? `${selectedCompany.name} — ${selectedTripDetail}`
          : selectedCompany.name,
        payment_status: "pending",
      });
      if (insertError) throw insertError;

      setSelectedDriverId("");
      setSelectedVehicleId("");
      setRentDate(new Date().toISOString().slice(0, 10));
      setAmount("");
      setCompany("");
      setSelectedTripDetail("");
      setIsAddingTripDetail(false);
      setActiveTab("pending");
      await fetchRents();
    } catch (insertError) {
      setError(getErrorMessage(insertError, "Could not save this rent."));
      setLoading(false);
    }
  };

  const handleAddVehicle = async () => {
    const name = vehicleName.trim();
    if (!name) {
      setError("Enter a vehicle name.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from("transportation_vehicles")
        .insert({ name })
        .select("id, name")
        .single();
      if (insertError) throw insertError;

      setVehicles((current) =>
        [...current, data as TransportationVehicle].sort((a, b) => a.name.localeCompare(b.name))
      );
      setSelectedVehicleId(data.id);
      setVehicleName("");
      setIsAddingVehicle(false);
    } catch (insertError) {
      setError(getErrorMessage(insertError, "Could not save this vehicle. It may already exist."));
    } finally {
      setLoading(false);
    }
  };

  const handleAddTripDetail = async () => {
    const name = newTripDetail.trim();
    if (!name) {
      setError("Enter a trip detail to save.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from("transportation_trip_details")
        .insert({ name })
        .select("id, name")
        .single();
      if (insertError) throw insertError;

      setTripDetails((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTripDetail(data.name);
      setNewTripDetail("");
      setIsAddingTripDetail(false);
    } catch (insertError) {
      setError(getErrorMessage(insertError, "Could not save this trip detail. It may already exist."));
    } finally {
      setLoading(false);
    }
  };

  const handleAddDriver = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = driverName.trim();
    if (!name) {
      setError("Enter a driver name.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from("transportation_drivers")
        .insert({ name })
        .select("id, name")
        .single();
      if (insertError) throw insertError;

      setDrivers((current) => [...current, data as TransportationDriver].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedDriverId(data.id);
      setDriverName("");
    } catch (insertError) {
      setError(getErrorMessage(insertError, "Could not add this driver. The name may already exist."));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateDriver = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingDriver || !editingDriver.name.trim()) {
      setError("Enter a driver name.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: updateError } = await supabase
        .from("transportation_drivers")
        .update({ name: editingDriver.name.trim() })
        .eq("id", editingDriver.id)
        .select("id, name")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("This driver could not be found. Refresh and try again.");

      setDrivers((current) =>
        current
          .map((item) => (item.id === data.id ? (data as TransportationDriver) : item))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditingDriver(null);
    } catch (updateError) {
      setError(getErrorMessage(updateError, "Could not update this driver. The name may already exist."));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDriver = async (driverToDelete: TransportationDriver) => {
    if (!confirm(`Delete driver "${driverToDelete.name}" from the driver list? Existing rent records will remain unchanged.`)) return;

    setLoading(true);
    setError(null);
    try {
      const { data, error: deleteError } = await supabase
        .from("transportation_drivers")
        .delete()
        .eq("id", driverToDelete.id)
        .select("id")
        .maybeSingle();
      if (deleteError) throw deleteError;
      if (!data) throw new Error("This driver could not be found. Refresh and try again.");

      setDrivers((current) => current.filter((item) => item.id !== driverToDelete.id));
      if (selectedDriverId === driverToDelete.id) setSelectedDriverId("");
      if (editingDriver?.id === driverToDelete.id) setEditingDriver(null);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Could not delete this driver."));
    } finally {
      setLoading(false);
    }
  };

  const handlePay = async (rentId: string) => {
    if (!confirm("Mark this transportation rent as paid?")) return;

    setLoading(true);
    setError(null);
    try {
      const { data, error: updateError } = await supabase
        .from("transportation_rents")
        .update({ payment_status: "paid", paid_at: new Date().toISOString() })
        .eq("id", rentId)
        .eq("payment_status", "pending")
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!data) throw new Error("This rent is no longer pending. Refresh the list and try again.");

      await fetchRents();
      setActiveTab("paid");
    } catch (updateError) {
      setError(getErrorMessage(updateError, "Could not mark this rent as paid."));
      setLoading(false);
    }
  };

  const handleUpdateRent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingRent) return;

    const amountValue = Number(editingRent.amount);
    if (
      !editingRent.driver.trim() ||
      !editingRent.rent_date ||
      !editingRent.company.trim() ||
      !Number.isFinite(amountValue) ||
      amountValue <= 0
    ) {
      setError("Enter a driver, date, company/details, and an amount greater than zero.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: updateError } = await supabase
        .from("transportation_rents")
        .update({
          driver: editingRent.driver.trim(),
          vehicle: editingRent.vehicle?.trim() || null,
          rent_date: editingRent.rent_date.slice(0, 10),
          amount: amountValue,
          company: editingRent.company.trim(),
        })
        .eq("id", editingRent.id)
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!data) throw new Error("This rent could not be found. Refresh the list and try again.");

      setEditingRent(null);
      await fetchRents();
    } catch (updateError) {
      setError(getErrorMessage(updateError, "Could not update this rent."));
      setLoading(false);
    }
  };

  const handleDeleteRent = async (rent: TransportationRent) => {
    if (!confirm(`Delete the rent for ${rent.driver} on ${formatDate(rent.rent_date)}? This cannot be undone.`)) return;

    setLoading(true);
    setError(null);
    try {
      const { data, error: deleteError } = await supabase
        .from("transportation_rents")
        .delete()
        .eq("id", rent.id)
        .select("id")
        .maybeSingle();

      if (deleteError) throw deleteError;
      if (!data) throw new Error("This rent could not be found. Refresh the list and try again.");

      if (editingRent?.id === rent.id) setEditingRent(null);
      await fetchRents();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Could not delete this rent."));
      setLoading(false);
    }
  };

  const pendingRents = rents.filter((rent) => rent.payment_status === "pending");
  const paidRents = rents.filter((rent) => rent.payment_status === "paid");
  const statusFilteredRents = mode === "viewer" ? rents : activeTab === "pending" ? pendingRents : paidRents;
  const availableRentDrivers = Array.from(new Set(rents.map((rent) => rent.driver.trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b)
  );
  const visibleRents = statusFilteredRents.filter((rent) => {
    const rentDateValue = rent.rent_date.slice(0, 10);
    if (filterDriver && rent.driver.trim().toLowerCase() !== filterDriver.toLowerCase()) return false;
    if (filterStartDate && rentDateValue < filterStartDate) return false;
    if (filterEndDate && rentDateValue > filterEndDate) return false;
    return true;
  });
  const rentsByDriver = new Map<string, { name: string; rents: TransportationRent[] }>();
  visibleRents.forEach((rent) => {
    const key = rent.driver.trim().toLowerCase();
    const driverGroup = rentsByDriver.get(key) ?? { name: rent.driver.trim(), rents: [] };
    driverGroup.rents.push(rent);
    rentsByDriver.set(key, driverGroup);
  });
  const driverRentGroups = Array.from(rentsByDriver.values()).sort((a, b) => a.name.localeCompare(b.name));
  const filteredRentTotal = visibleRents.reduce((total, rent) => total + Number(rent.amount), 0);
  const pendingTotal = pendingRents.reduce((total, rent) => total + Number(rent.amount), 0);
  const paidTotal = paidRents.reduce((total, rent) => total + Number(rent.amount), 0);
  const pendingByDriver = new Map<string, { name: string; amount: number; count: number }>();
  drivers.forEach((item) => {
    pendingByDriver.set(item.name.toLowerCase(), { name: item.name, amount: 0, count: 0 });
  });
  pendingRents.forEach((rent) => {
    const key = rent.driver.trim().toLowerCase();
    const driverSummary = pendingByDriver.get(key) ?? { name: rent.driver.trim(), amount: 0, count: 0 };
    driverSummary.amount += Number(rent.amount);
    driverSummary.count += 1;
    pendingByDriver.set(key, driverSummary);
  });
  const driverPendingSummaries = Array.from(pendingByDriver.values()).sort((a, b) => a.name.localeCompare(b.name));

  const exportTransportationExcel = () => {
    const workbook = XLSX.utils.book_new();
    const rentSheet = XLSX.utils.json_to_sheet(
      visibleRents.map((rent) => ({
        Date: formatDate(rent.rent_date),
        Driver: rent.driver,
        Vehicle: rent.vehicle || "",
        "Amount (PKR)": Number(rent.amount),
        "Company / Trip Details": rent.company,
        Status: rent.payment_status,
        "Paid Date": rent.paid_at ? new Date(rent.paid_at).toLocaleDateString() : "",
      }))
    );
    const summarySheet = XLSX.utils.json_to_sheet(
      driverPendingSummaries.map((summary) => ({
        Driver: summary.name,
        "Pending Rents": summary.count,
        "Pending Amount (PKR)": summary.amount,
      }))
    );
    XLSX.utils.book_append_sheet(workbook, rentSheet, "Transportation Rents");
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Pending by Driver");
    const suffix = mode === "admin" ? activeTab : "all";
    XLSX.writeFile(workbook, `Transportation_Rents_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportTransportationPdf = () => {
    const summaryRows = Math.max(1, Math.ceil(driverPendingSummaries.length / 3));
    const pageHeight = Math.max(
      320,
      180 + summaryRows * 26 + visibleRents.length * 8 + driverRentGroups.length * 32
    );
    const doc = new jsPDF({ unit: "mm", format: [297, pageHeight] });
    const reportStatus = mode === "admin" ? activeTab.toUpperCase() : "ALL";
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(`TRANSPORTATION RENTS - ${reportStatus}`, 14, 18);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 25);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("PENDING RENT BY DRIVER", 14, 32);

    const summaryStartY = 36;
    const cardGap = 5;
    const cardWidth = (297 - 28 - cardGap * 2) / 3;
    const cardHeight = 22;
    driverPendingSummaries.forEach((summary, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 14 + column * (cardWidth + cardGap);
      const y = summaryStartY + row * (cardHeight + 4);

      doc.setDrawColor(180, 83, 9);
      doc.setFillColor(255, 247, 237);
      doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, "FD");
      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(summary.name, x + 4, y + 6, { maxWidth: cardWidth - 8 });
      doc.setTextColor(180, 83, 9);
      doc.setFontSize(10);
      doc.text(
        Number(summary.amount).toLocaleString("en-PK", { maximumFractionDigits: 2 }) + " PKR",
        x + 4,
        y + 13,
        { maxWidth: cardWidth - 8 }
      );
      doc.setTextColor(71, 85, 105);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`${summary.count} pending ${summary.count === 1 ? "rent" : "rents"}`, x + 4, y + 19);
    });

    if (driverPendingSummaries.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text("No drivers found.", 14, summaryStartY + 8);
    }

    const totalCardY = summaryStartY + summaryRows * (cardHeight + 4);
    doc.setDrawColor(8, 145, 178);
    doc.setFillColor(236, 254, 255);
    doc.roundedRect(14, totalCardY, 269, 20, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(8, 80, 105);
    doc.text("TOTAL RENT", 18, totalCardY + 8);
    doc.setFontSize(12);
    doc.setTextColor(8, 145, 178);
    doc.text(`${formatAmount(filteredRentTotal)} PKR`, 18, totalCardY + 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`${visibleRents.length} rent records`, 279, totalCardY + 12, { align: "right" });

    let detailsTitleY = totalCardY + 29;
    if (detailsTitleY > pageHeight - 20) {
      doc.addPage();
      detailsTitleY = 16;
    }
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`RENT DETAILS - ${reportStatus}`, 14, detailsTitleY);
    let detailsY = detailsTitleY + 8;
    driverRentGroups.forEach((group) => {
      const driverTotal = group.rents.reduce((total, rent) => total + Number(rent.amount), 0);
      if (detailsY > pageHeight - 30) {
        doc.addPage();
        detailsY = 16;
      }

      autoTable(doc, {
        startY: detailsY,
        head: [
          [{
            content: `DRIVER: ${group.name}  |  ${group.rents.length} RENTS  |  TOTAL: ${formatAmount(driverTotal)}`,
            colSpan: 5,
            styles: { fillColor: [236, 254, 255], textColor: [8, 80, 105], fontSize: 10, halign: "left" },
          }],
          ["Date", "Vehicle", "Amount (PKR)", "Company / Trip Details", "Status"],
        ],
        body: group.rents.map((rent) => [
          formatDate(rent.rent_date),
          rent.vehicle || "—",
          Number(rent.amount).toLocaleString("en-PK", { maximumFractionDigits: 2 }),
          rent.company,
          rent.payment_status.toUpperCase(),
        ]),
        foot: [["", "DRIVER TOTAL", driverTotal.toLocaleString("en-PK", { maximumFractionDigits: 2 }), "", ""]],
        theme: "grid",
        tableLineWidth: 0.6,
        tableLineColor: [8, 80, 105],
        headStyles: { fillColor: [8, 145, 178], textColor: [255, 255, 255] },
        footStyles: { fillColor: [236, 254, 255], textColor: [8, 80, 105], fontStyle: "bold" },
        styles: { fontSize: 8, fontStyle: "bold", cellPadding: 1.5, minCellHeight: 7, overflow: "ellipsize" },
      });
      detailsY += group.rents.length * 8 + 32;
    });

    const suffix = mode === "admin" ? activeTab : "all";
    doc.save(`transportation_rents_${suffix}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <section className="space-y-5">
      {mode === "admin" && (
        <>
          <section className="rounded-2xl border border-slate-800 bg-[#121827] p-4">
            <h2 className="mb-3 text-sm font-bold text-white">Manage Drivers</h2>
            <form onSubmit={handleAddDriver} className="mb-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={driverName}
                onChange={(event) => setDriverName(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                placeholder="New driver name"
                aria-label="New driver name"
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-600 disabled:opacity-50"
              >
                Add Driver
              </button>
            </form>
            {drivers.length > 0 ? (
              <ul className="divide-y divide-slate-800">
                {drivers.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-slate-200">{item.name}</span>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingDriver({ ...item })}
                        disabled={loading}
                        className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-600 disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteDriver(item)}
                        disabled={loading}
                        className="rounded-lg bg-rose-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">No drivers yet. Add a driver to use it on a rent entry.</p>
            )}
          </section>

          <form
            onSubmit={handleAddRent}
            className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:grid-cols-2 lg:grid-cols-7"
          >
            <label className="text-xs text-slate-400">
              Driver
              <select
                value={selectedDriverId}
                onChange={(event) => setSelectedDriverId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                required
              >
                <option value="">-- Select Driver --</option>
                {drivers.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Vehicle
              <select
                value={selectedVehicleId}
                onChange={(event) => {
                  if (event.target.value === "__add_vehicle__") {
                    setIsAddingVehicle(true);
                    setSelectedVehicleId("");
                  } else {
                    setIsAddingVehicle(false);
                    setSelectedVehicleId(event.target.value);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                required
              >
                <option value="">-- Select Vehicle --</option>
                {vehicles.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
                <option value="__add_vehicle__">+ Add new vehicle…</option>
              </select>
              {isAddingVehicle && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={vehicleName}
                    onChange={(event) => setVehicleName(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-cyan-700 bg-[#0b0f19] p-2 text-sm text-white"
                    placeholder="e.g. Suzuki or Shehzore"
                    aria-label="New vehicle name"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddVehicle()}
                    disabled={loading}
                    className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-bold text-white hover:bg-cyan-600 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </label>
            <label className="text-xs text-slate-400">
              Date
              <input
                type="date"
                value={rentDate}
                onChange={(event) => setRentDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                required
              />
            </label>
            <label className="text-xs text-slate-400">
              Amount (PKR)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                placeholder="e.g. 4000"
                required
              />
            </label>
            <label className="text-xs text-slate-400">
              Company
              <select
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                required
              >
                <option value="">-- Select Company --</option>
                {companies.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              {companies.length === 0 && !loading && (
                <span className="mt-1 block text-[10px] text-amber-300">Add a company in Admin → Parties first.</span>
              )}
            </label>
            <label className="text-xs text-slate-400">
              Trip Details (Optional)
              <select
                value={isAddingTripDetail ? "__add_trip_detail__" : selectedTripDetail}
                onChange={(event) => {
                  if (event.target.value === "__add_trip_detail__") {
                    setIsAddingTripDetail(true);
                    setSelectedTripDetail("");
                  } else {
                    setIsAddingTripDetail(false);
                    setSelectedTripDetail(event.target.value);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
              >
                <option value="">-- Select Trip Detail (Optional) --</option>
                {tripDetails.map((item) => (
                  <option key={item.id} value={item.name}>{item.name}</option>
                ))}
                <option value="__add_trip_detail__">+ Add new trip detail…</option>
              </select>
              {isAddingTripDetail && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={newTripDetail}
                    onChange={(event) => setNewTripDetail(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-cyan-700 bg-[#0b0f19] p-2 text-sm text-white"
                    placeholder="Enter trip detail"
                    aria-label="New trip detail"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddTripDetail()}
                    disabled={loading}
                    className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-bold text-white hover:bg-cyan-600 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </label>
            <button
              type="submit"
              disabled={loading}
              className="self-end rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              Add Rent
            </button>
          </form>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4">
              <div className="text-xs font-semibold uppercase text-amber-300">Pending Rents</div>
              <div className="mt-1 text-xl font-bold text-white">{pendingRents.length} · {formatAmount(pendingTotal)}</div>
            </div>
            <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-4">
              <div className="text-xs font-semibold uppercase text-emerald-300">Paid Rents</div>
              <div className="mt-1 text-xl font-bold text-white">{paidRents.length} · {formatAmount(paidTotal)}</div>
            </div>
          </div>

          <div className="flex gap-2">
            {(["pending", "paid"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-2 text-xs font-bold capitalize ${
                  activeTab === tab ? "bg-cyan-700 text-white" : "bg-[#121827] text-slate-400 hover:text-white"
                }`}
              >
                {tab === "pending" ? `Pending (${pendingRents.length})` : `Payments (${paidRents.length})`}
              </button>
            ))}
          </div>
        </>
      )}

      {mode === "viewer" && (
        <div>
          <h2 className="text-lg font-bold text-white">Transportation Rents</h2>
          <p className="mt-1 text-xs text-slate-400">Read-only view of pending and paid transportation charges.</p>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Rent Details</h2>
          <p className="mt-1 text-xs text-slate-400">
            Exporting {mode === "admin" ? activeTab : "all"} rent records with driver, vehicle, amount and company details.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportTransportationExcel}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-600"
          >
            Export Excel
          </button>
          <button
            type="button"
            onClick={exportTransportationPdf}
            className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white hover:bg-rose-600"
          >
            Export PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-[#121827] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-400">
          Filter by Driver
          <select
            value={filterDriver}
            onChange={(event) => setFilterDriver(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
          >
            <option value="">All Drivers</option>
            {availableRentDrivers.map((name) => (
              <option key={name.toLowerCase()} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Date From
          <input
            type="date"
            value={filterStartDate}
            max={filterEndDate || undefined}
            onChange={(event) => setFilterStartDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
          />
        </label>
        <label className="text-xs text-slate-400">
          Date To
          <input
            type="date"
            value={filterEndDate}
            min={filterStartDate || undefined}
            onChange={(event) => setFilterEndDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
          />
        </label>
        <div className="flex items-end justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setFilterDriver("");
              setFilterStartDate("");
              setFilterEndDate("");
            }}
            className="rounded-lg border border-slate-700 px-3 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800"
          >
            Clear Filters
          </button>
          <span className="pb-2 text-right text-xs text-slate-400">
            {visibleRents.length} rents · {formatAmount(filteredRentTotal)}
          </span>
        </div>
      </div>

      {driverRentGroups.length > 0 ? (
        <div className="space-y-4">
          {driverRentGroups.map((group) => {
            const driverTotal = group.rents.reduce((total, rent) => total + Number(rent.amount), 0);
            return (
              <section key={group.name.toLowerCase()} className="overflow-hidden rounded-2xl border border-slate-800 bg-[#121827]">
                <div className="flex flex-col gap-1 border-b border-slate-800 bg-[#0b0f19] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="font-bold text-white">{group.name}</h3>
                  <span className="text-xs font-semibold text-amber-300">
                    {group.rents.length} rents · {formatAmount(driverTotal)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs text-slate-300">
                    <thead className="bg-[#0b0f19]/60 text-slate-400">
                      <tr>
                        <th className="p-3">S.No</th>
                        <th className="p-3">Date</th>
                        <th className="p-3">Vehicle</th>
                        <th className="p-3">Paid To (PKR)</th>
                        <th className="p-3">Company / Details</th>
                        <th className="p-3">Status</th>
                        {mode === "admin" && <th className="p-3 text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {group.rents.map((rent, index) => (
                        <tr key={rent.id} className="hover:bg-slate-800/40">
                          <td className="p-3">{index + 1}</td>
                          <td className="whitespace-nowrap p-3">{formatDate(rent.rent_date)}</td>
                          <td className="p-3 text-slate-200">{rent.vehicle || "—"}</td>
                          <td className="whitespace-nowrap p-3 font-mono font-bold text-amber-300">{formatAmount(Number(rent.amount))}</td>
                          <td className="p-3">{rent.company}</td>
                          <td className="p-3">
                            <span className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${
                              rent.payment_status === "paid"
                                ? "bg-emerald-950 text-emerald-300"
                                : "bg-amber-950 text-amber-300"
                            }`}>
                              {rent.payment_status}
                            </span>
                            {rent.paid_at && (
                              <div className="mt-1 whitespace-nowrap text-[10px] text-slate-500">
                                {new Date(rent.paid_at).toLocaleDateString()}
                              </div>
                            )}
                          </td>
                          {mode === "admin" && (
                            <td className="p-3 text-right">
                              <div className="flex justify-end gap-2">
                                {activeTab === "pending" && (
                                  <button
                                    type="button"
                                    onClick={() => void handlePay(rent.id)}
                                    disabled={loading}
                                    className="rounded-lg bg-emerald-700 px-3 py-1.5 font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
                                  >
                                    Pay
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setEditingRent({ ...rent })}
                                  disabled={loading}
                                  className="rounded-lg bg-blue-700 px-3 py-1.5 font-bold text-white hover:bg-blue-600 disabled:opacity-50"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteRent(rent)}
                                  disabled={loading}
                                  className="rounded-lg bg-rose-800 px-3 py-1.5 font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-[#121827] p-6 text-center text-sm text-slate-500">
          {loading ? "Loading transportation rents…" : mode === "viewer" ? "No transportation rents have been added." : activeTab === "pending" ? "No pending rents match these filters." : "No paid rents match these filters."}
        </div>
      )}

      {mode === "admin" && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-bold text-white">Pending Rent by Driver</h2>
            <p className="mt-1 text-xs text-slate-400">Each driver’s unpaid rent total.</p>
          </div>
          {driverPendingSummaries.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {driverPendingSummaries.map((summary) => (
                <article
                  key={summary.name.toLowerCase()}
                  className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4"
                >
                  <h3 className="font-bold text-white">{summary.name}</h3>
                  <p className="mt-2 text-xl font-extrabold text-amber-300">{formatAmount(summary.amount)}</p>
                  <p className="mt-1 text-xs text-slate-400">{summary.count} pending {summary.count === 1 ? "rent" : "rents"}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-[#121827] p-4 text-sm text-slate-500">
              No drivers or pending rents to summarize.
            </div>
          )}
        </section>
      )}

      {mode === "admin" && editingDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={handleUpdateDriver}
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-[#121827] p-5 shadow-2xl"
          >
            <h2 className="text-lg font-bold text-white">Edit Driver Name</h2>
            <label className="block text-xs text-slate-400">
              Driver Name
              <input
                value={editingDriver.name}
                onChange={(event) => setEditingDriver({ ...editingDriver, name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                required
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingDriver(null)}
                disabled={loading}
                className="rounded-lg bg-slate-700 px-4 py-2 text-xs font-bold text-white hover:bg-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? "Saving…" : "Save Driver"}
              </button>
            </div>
          </form>
        </div>
      )}

      {mode === "admin" && editingRent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={handleUpdateRent}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-700 bg-[#121827] p-5 shadow-2xl"
          >
            <div>
              <h2 className="text-lg font-bold text-white">Edit Transportation Rent</h2>
              <p className="mt-1 text-xs text-slate-400">
                Payment status will remain {editingRent.payment_status}.
              </p>
            </div>
            <label className="block text-xs text-slate-400">
              Driver
              <input
                value={editingRent.driver}
                onChange={(event) => setEditingRent({ ...editingRent, driver: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                required
              />
            </label>
            <label className="block text-xs text-slate-400">
              Vehicle
              <input
                value={editingRent.vehicle ?? ""}
                onChange={(event) => setEditingRent({ ...editingRent, vehicle: event.target.value || null })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                placeholder="e.g. Suzuki or Shehzore"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Date
              <input
                type="date"
                value={editingRent.rent_date.slice(0, 10)}
                onChange={(event) => setEditingRent({ ...editingRent, rent_date: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                required
              />
            </label>
            <label className="block text-xs text-slate-400">
              Amount (PKR)
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={editingRent.amount}
                onChange={(event) => setEditingRent({ ...editingRent, amount: Number(event.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                required
              />
            </label>
            <label className="block text-xs text-slate-400">
              Company / Details
              <input
                value={editingRent.company}
                onChange={(event) => setEditingRent({ ...editingRent, company: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0b0f19] p-2.5 text-sm text-white"
                required
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingRent(null)}
                disabled={loading}
                className="rounded-lg bg-slate-700 px-4 py-2 text-xs font-bold text-white hover:bg-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
