export const getPartyProductMrpErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === "object" && error !== null) {
    const details = error as { code?: unknown; message?: unknown; details?: unknown };
    const message = `${details.message ?? ""} ${details.details ?? ""}`.trim();
    const normalizedMessage = message.toLowerCase();
    if (normalizedMessage.includes("party_product_mrps")) {
      if (normalizedMessage.includes("batch_qty")) {
        return "Fixed batch quantity is not available yet. Apply supabase/migrations/20261125000000_add_batch_qty_and_prevent_duplicate_filling_batches.sql in Supabase, then refresh this page.";
      }
      if (
        details.code === "PGRST205" ||
        normalizedMessage.includes("could not find the table") ||
        normalizedMessage.includes("relation") && normalizedMessage.includes("does not exist")
      ) {
        return "MRP table is not available yet. Apply supabase/migrations/20261122000000_create_party_product_mrps.sql and supabase/migrations/20261123000000_add_batch_dates_to_party_product_mrps.sql in Supabase, then refresh this page.";
      }
      if (
        details.code === "PGRST204" ||
        details.code === "42703" ||
        normalizedMessage.includes("schema cache") ||
        normalizedMessage.includes("column")
      ) {
        return "MRP batch/date columns are not available yet. Apply supabase/migrations/20261123000000_add_batch_dates_to_party_product_mrps.sql and supabase/migrations/20261125000000_add_batch_qty_and_prevent_duplicate_filling_batches.sql in Supabase, then refresh this page.";
      }
    }
    if (message) return message;
  }
  return error instanceof Error ? error.message : fallback;
};
