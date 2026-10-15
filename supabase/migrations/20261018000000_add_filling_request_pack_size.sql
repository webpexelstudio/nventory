ALTER TABLE public.filling_requests
  ADD COLUMN IF NOT EXISTS pack_size numeric,
  ADD COLUMN IF NOT EXISTS pack_unit text;

WITH selected_capacity AS (
  SELECT DISTINCT ON (product_id)
    product_id,
    ml_capacity,
    capacity_unit
  FROM public.product_bom
  WHERE ml_capacity > 0
  ORDER BY
    product_id,
    CASE
      WHEN lower(component_type) = 'bottle' THEN 0
      WHEN lower(component_type) = 'tube' THEN 1
      ELSE 2
    END,
    component_type
)
UPDATE public.filling_requests AS request
SET
  pack_size = selected_capacity.ml_capacity,
  pack_unit = COALESCE(selected_capacity.capacity_unit, 'ML')
FROM selected_capacity
WHERE request.product_id = selected_capacity.product_id
  AND request.pack_size IS NULL;
