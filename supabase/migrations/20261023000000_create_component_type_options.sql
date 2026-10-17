CREATE TABLE IF NOT EXISTS public.component_type_options (
  component_type text PRIMARY KEY
    CHECK (component_type = lower(trim(component_type)) AND length(trim(component_type)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.component_type_options
  TO anon, authenticated;
