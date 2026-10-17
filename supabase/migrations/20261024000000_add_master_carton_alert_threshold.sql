ALTER TABLE public.master_carton_options
  ADD COLUMN IF NOT EXISTS alert_threshold integer CHECK (alert_threshold IS NULL OR alert_threshold >= 0);

UPDATE public.master_carton_options
SET alert_threshold = 0
WHERE alert_threshold IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.master_carton_options
  TO anon, authenticated;
