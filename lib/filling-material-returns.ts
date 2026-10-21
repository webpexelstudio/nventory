export type FillingMaterialReturnKind = "RETURN" | "DAMAGED";

export type FillingMaterialReturnDestination = "WAREHOUSE" | "PARTY";

export type FillingMaterialReturnStatus =
  | "PENDING_WAREHOUSE"
  | "RECEIVED_BY_WAREHOUSE"
  | "RETURNED_TO_PARTY";

export interface FillingMaterialReturnComponent {
  component_type: string;
  quantity: number;
}

export interface FillingMaterialReturn {
  id: string;
  kind: FillingMaterialReturnKind;
  destination: FillingMaterialReturnDestination;
  party_id: string;
  party_name: string;
  product_id: string;
  product_name: string;
  batch_no: string | null;
  components: FillingMaterialReturnComponent[];
  party_return_date: string | null;
  status: FillingMaterialReturnStatus;
  created_at: string;
  received_at: string | null;
}

export const getFillingMaterialReturnStatusLabel = (
  record: FillingMaterialReturn
) => {
  if (record.destination === "PARTY") {
    if (record.status === "RECEIVED_BY_WAREHOUSE") {
      return "Damaged — received by warehouse, returning to party";
    }
    return record.kind === "DAMAGED"
      ? "Damaged items returned to party"
      : "Usable return sent to party";
  }

  if (record.kind === "DAMAGED") {
    return record.status === "RECEIVED_BY_WAREHOUSE"
      ? "Damaged — received by warehouse, not added to stock"
      : "Damaged — waiting for warehouse, not added to stock";
  }

  return record.status === "RECEIVED_BY_WAREHOUSE"
    ? "Return received — added to inventory"
    : "Return waiting for warehouse";
};

export const isFillingMaterialReturnsTableMissing = (
  error: unknown,
  tableName = "filling_material_returns"
) => {
  if (typeof error !== "object" || error === null) return false;

  const details = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };

  const message = [
    details.message,
    details.details,
    details.hint,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  const relationReference = `"${tableName}"`;
  return (
    details.code === "42P01" ||
    details.code === "PGRST205" ||
    details.code === "PGRST204" ||
    (message.includes("relation") && (message.includes(tableName) || message.includes(relationReference))) ||
    (message.includes("does not exist") && message.includes(tableName)) ||
    (message.includes("schema cache") && message.includes(tableName))
  );
};

export const getFillingMaterialReturnsSetupMessage = () =>
  "The filling return tracking table is not available yet. Run the Supabase migration at supabase/migrations/20261030000000_create_filling_material_returns.sql and refresh the page.";
