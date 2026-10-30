WITH ranked_settings AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY product_id
      ORDER BY created_at DESC NULLS LAST, ctid DESC
    ) AS duplicate_rank
  FROM public.master_carton_product_settings
)
DELETE FROM public.master_carton_product_settings AS setting
USING ranked_settings
WHERE setting.ctid = ranked_settings.ctid
  AND ranked_settings.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS master_carton_product_settings_product_id_key
  ON public.master_carton_product_settings (product_id);

NOTIFY pgrst, 'reload schema';
