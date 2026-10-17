ALTER TABLE public.filling_requests
  ADD COLUMN IF NOT EXISTS master_carton_count integer
    CHECK (master_carton_count > 0),
  ADD COLUMN IF NOT EXISTS master_carton_pcs integer
    CHECK (master_carton_pcs > 0),
  ADD COLUMN IF NOT EXISTS plan_pcs integer NOT NULL DEFAULT 0
    CHECK (plan_pcs >= 0),
  ADD COLUMN IF NOT EXISTS nigehban_pcs integer NOT NULL DEFAULT 0
    CHECK (nigehban_pcs >= 0),
  ADD COLUMN IF NOT EXISTS source_warehouse text,
  ADD COLUMN IF NOT EXISTS source_warehouse_party_id uuid REFERENCES public.parties(id);
