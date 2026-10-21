ALTER TABLE public.filling_hourly_production_reports
  ADD COLUMN IF NOT EXISTS incharge_name text;

ALTER TABLE public.filling_hourly_production_reports
  DROP CONSTRAINT IF EXISTS filling_hourly_production_reports_incharge_name_fkey;

ALTER TABLE public.filling_hourly_production_reports
  ADD CONSTRAINT filling_hourly_production_reports_incharge_name_fkey
  FOREIGN KEY (incharge_name)
  REFERENCES public.filling_production_incharges(name)
  ON UPDATE CASCADE;

GRANT UPDATE ON TABLE public.filling_production_incharges TO authenticated;

CREATE POLICY filling_production_incharges_update_authorized
  ON public.filling_production_incharges
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.filling_production_users AS report_user
      WHERE report_user.is_active
        AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.filling_production_users AS report_user
      WHERE report_user.is_active
        AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
    )
  );
