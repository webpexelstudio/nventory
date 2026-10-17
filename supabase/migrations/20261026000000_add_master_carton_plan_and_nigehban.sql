ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS plan_type text,
  ADD COLUMN IF NOT EXISTS nigehban_quantity integer
    CHECK (nigehban_quantity IS NULL OR nigehban_quantity >= 0);
