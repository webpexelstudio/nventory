ALTER TABLE public.admin_daily_task_options
  ADD COLUMN IF NOT EXISTS value text;

CREATE UNIQUE INDEX IF NOT EXISTS admin_daily_task_options_category_value_idx
  ON public.admin_daily_task_options (category, value)
  WHERE value IS NOT NULL;

NOTIFY pgrst, 'reload schema';