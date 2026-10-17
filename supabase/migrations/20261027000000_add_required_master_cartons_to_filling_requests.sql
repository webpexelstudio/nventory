ALTER TABLE public.filling_requests
  ADD COLUMN IF NOT EXISTS master_cartons_required integer
    CHECK (master_cartons_required IS NULL OR master_cartons_required > 0);

UPDATE public.filling_requests
SET master_cartons_required = CEIL(pcs_requested::numeric / master_carton_pcs)::integer
WHERE master_cartons_required IS NULL
  AND pcs_requested > 0
  AND master_carton_pcs > 0;
