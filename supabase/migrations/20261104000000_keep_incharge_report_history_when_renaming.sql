ALTER TABLE public.filling_production_incharges
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.filling_hourly_production_reports
  ADD COLUMN IF NOT EXISTS incharge_name text;

ALTER TABLE public.filling_hourly_production_reports
  DROP CONSTRAINT IF EXISTS filling_hourly_production_reports_incharge_name_fkey;

ALTER TABLE public.filling_hourly_production_reports
  ADD CONSTRAINT filling_hourly_production_reports_incharge_name_fkey
  FOREIGN KEY (incharge_name)
  REFERENCES public.filling_production_incharges(name);

DROP POLICY IF EXISTS filling_production_incharges_update_authorized
  ON public.filling_production_incharges;
REVOKE UPDATE ON TABLE public.filling_production_incharges FROM authenticated;

CREATE OR REPLACE FUNCTION public.rename_filling_production_incharge(
  p_old_name text,
  p_new_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_users AS report_user
    WHERE report_user.is_active
      AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
  ) THEN
    RAISE EXCEPTION 'You are not authorized to rename production incharges.';
  END IF;

  IF p_old_name IS NULL OR p_new_name IS NULL OR btrim(p_new_name) = '' THEN
    RAISE EXCEPTION 'Enter a valid incharge name.';
  END IF;

  IF p_old_name = btrim(p_new_name) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.filling_production_incharges
    WHERE name = p_old_name
      AND is_active
  ) THEN
    RAISE EXCEPTION 'The active incharge name was not found.';
  END IF;

  INSERT INTO public.filling_production_incharges (name, created_by)
  VALUES (btrim(p_new_name), auth.uid())
  ON CONFLICT (name) DO UPDATE
  SET is_active = true;

  UPDATE public.filling_production_incharges
  SET is_active = false
  WHERE name = p_old_name;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_filling_production_incharge(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_filling_production_incharge(text, text)
  TO authenticated;
