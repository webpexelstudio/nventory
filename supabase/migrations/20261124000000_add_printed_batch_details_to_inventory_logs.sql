ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_no text,
  ADD COLUMN IF NOT EXISTS mfg_date date,
  ADD COLUMN IF NOT EXISTS exp_date date,
  ADD COLUMN IF NOT EXISTS mrp numeric(12, 2)
    CHECK (mrp IS NULL OR mrp >= 0);

ALTER TABLE public.inventory_logs
  DROP CONSTRAINT IF EXISTS inventory_logs_batch_dates_check;

ALTER TABLE public.inventory_logs
  ADD CONSTRAINT inventory_logs_batch_dates_check
  CHECK (mfg_date IS NULL OR exp_date IS NULL OR exp_date >= mfg_date);

NOTIFY pgrst, 'reload schema';
