ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS carton_count integer
    CHECK (carton_count IS NULL OR carton_count > 0);

ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS carton_count integer
    CHECK (carton_count IS NULL OR carton_count > 0);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.inventory
  TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.inventory_logs
  TO anon, authenticated;
