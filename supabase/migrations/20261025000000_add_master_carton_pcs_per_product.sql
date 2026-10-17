ALTER TABLE public.master_carton_product_settings
  ADD COLUMN IF NOT EXISTS carton_pcs integer
    CHECK (carton_pcs IS NULL OR carton_pcs > 0);
