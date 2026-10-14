import Link from "next/link";
import TransportationRentPanel from "@/components/TransportationRentPanel";

export default function TransportationRentPage() {
  return (
    <main className="min-h-screen space-y-6 bg-[#0b0f19] p-3 font-sans text-slate-100 sm:p-6">
      <header className="mx-auto flex max-w-7xl flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Admin · Transportation</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">Transportation Charges & Payments</h1>
        </div>
        <Link
          href="/admin"
          className="w-fit rounded-lg border border-slate-700 bg-[#121827] px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800"
        >
          Back to Admin
        </Link>
      </header>
      <div className="mx-auto max-w-7xl">
        <TransportationRentPanel mode="admin" />
      </div>
    </main>
  );
}
