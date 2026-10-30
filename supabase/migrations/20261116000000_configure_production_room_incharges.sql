ALTER TABLE public.production_sheet_options
  ADD COLUMN IF NOT EXISTS assigned_incharge text;

NOTIFY pgrst, 'reload schema';
