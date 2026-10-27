CREATE TABLE IF NOT EXISTS public.production_data_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  room_name text NOT NULL CHECK (btrim(room_name) <> ''),
  packing_incharge text NOT NULL CHECK (btrim(packing_incharge) <> ''),
  production_incharge text NOT NULL CHECK (btrim(production_incharge) <> ''),
  daily_target integer NOT NULL DEFAULT 0 CHECK (daily_target >= 0),
  rows jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rows) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_data_sheets_report_date_idx
  ON public.production_data_sheets (report_date DESC, updated_at DESC);

ALTER TABLE public.production_data_sheets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_data_sheets TO anon, authenticated;

DROP POLICY IF EXISTS production_data_sheets_open_access
  ON public.production_data_sheets;

CREATE POLICY production_data_sheets_open_access
  ON public.production_data_sheets
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.production_sheet_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_type text NOT NULL CHECK (option_type IN ('room', 'incharge')),
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (option_type, name)
);

ALTER TABLE public.production_sheet_options ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_sheet_options TO anon, authenticated;

DROP POLICY IF EXISTS production_sheet_options_open_access
  ON public.production_sheet_options;

CREATE POLICY production_sheet_options_open_access
  ON public.production_sheet_options
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
