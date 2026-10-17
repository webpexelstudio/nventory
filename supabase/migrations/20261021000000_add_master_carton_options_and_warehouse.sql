CREATE TABLE IF NOT EXISTS public.master_carton_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carton_count integer NOT NULL UNIQUE CHECK (carton_count > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON TABLE public.master_carton_options TO anon, authenticated;

ALTER TABLE public.filling_requests
  ADD COLUMN IF NOT EXISTS master_carton_warehouse text,
  ADD COLUMN IF NOT EXISTS master_carton_warehouse_party_id uuid
    REFERENCES public.parties(id);
