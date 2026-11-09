ALTER TABLE public.party_product_mrps
  ADD COLUMN IF NOT EXISTS batch_no text,
  ADD COLUMN IF NOT EXISTS mfg_date date,
  ADD COLUMN IF NOT EXISTS exp_date date;

NOTIFY pgrst, 'reload schema';
