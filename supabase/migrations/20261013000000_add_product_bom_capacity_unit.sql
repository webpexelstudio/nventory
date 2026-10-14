ALTER TABLE public.product_bom
ADD COLUMN IF NOT EXISTS capacity_unit text NOT NULL DEFAULT 'ML';
