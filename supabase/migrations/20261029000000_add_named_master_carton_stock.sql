ALTER TABLE public.master_carton_options
  ADD COLUMN IF NOT EXISTS carton_name text;

ALTER TABLE public.master_carton_options
  DROP CONSTRAINT IF EXISTS master_carton_options_carton_count_check;

UPDATE public.master_carton_options
SET carton_name = btrim(carton_count::text)
WHERE carton_count IS NOT NULL
  AND carton_count::text !~ '^[0-9]+$'
  AND (carton_name IS NULL OR btrim(carton_name) = '');

ALTER TABLE public.master_carton_options
  ALTER COLUMN carton_count TYPE integer
    USING CASE
      WHEN carton_count::text ~ '^[0-9]+$' THEN carton_count::text::integer
      ELSE NULL
    END,
  ALTER COLUMN carton_count DROP NOT NULL;

ALTER TABLE public.master_carton_options
  DROP CONSTRAINT IF EXISTS master_carton_options_count_or_name_check,
  ADD CONSTRAINT master_carton_options_count_or_name_check
    CHECK (
      (carton_count IS NOT NULL AND carton_count > 0 AND carton_name IS NULL)
      OR
      (carton_count IS NULL AND carton_name IS NOT NULL AND btrim(carton_name) <> '')
    );

CREATE UNIQUE INDEX IF NOT EXISTS master_carton_options_carton_name_key
  ON public.master_carton_options (lower(btrim(carton_name)))
  WHERE carton_name IS NOT NULL;

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS carton_name text;

ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS carton_name text;

UPDATE public.inventory AS stock
SET carton_name = option.carton_name,
    carton_count = NULL
FROM public.master_carton_options AS option
WHERE stock.component_type = 'master_carton'
  AND btrim(stock.carton_count::text) = '1'
  AND lower(btrim(stock.product_name)) = lower(btrim(option.carton_name))
  AND stock.carton_name IS NULL;

UPDATE public.inventory_logs AS movement
SET carton_name = option.carton_name,
    carton_count = NULL
FROM public.master_carton_options AS option
WHERE lower(btrim(movement.component_type)) = 'master_carton'
  AND btrim(movement.carton_count::text) = '1'
  AND lower(btrim(movement.product_name)) = lower(btrim(option.carton_name))
  AND movement.carton_name IS NULL;
