CREATE TABLE IF NOT EXISTS public.master_carton_product_settings (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  carton_count integer NOT NULL CHECK (carton_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.master_carton_product_settings
  TO anon, authenticated;

INSERT INTO public.master_carton_product_settings (product_id, carton_count)
SELECT DISTINCT ON (product_id)
  product_id,
  master_carton_count
FROM public.filling_requests
WHERE product_id IS NOT NULL
  AND master_carton_count IS NOT NULL
  AND master_carton_count > 0
ORDER BY product_id, created_at DESC NULLS LAST;
