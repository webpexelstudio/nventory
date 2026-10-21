CREATE TABLE IF NOT EXISTS public.filling_production_users (
  email text PRIMARY KEY,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.filling_production_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.filling_production_users FROM anon, authenticated;
GRANT SELECT ON TABLE public.filling_production_users TO authenticated;

CREATE POLICY filling_production_users_read_self
  ON public.filling_production_users
  FOR SELECT
  TO authenticated
  USING (
    is_active
    AND lower(email) = lower(auth.jwt() ->> 'email')
  );

CREATE TABLE IF NOT EXISTS public.filling_production_incharges (
  name text PRIMARY KEY,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filling_production_incharges_name_not_blank CHECK (btrim(name) <> '')
);

ALTER TABLE public.filling_production_incharges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.filling_production_incharges FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.filling_production_incharges TO authenticated;

CREATE POLICY filling_production_incharges_read_authorized
  ON public.filling_production_incharges
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.filling_production_users AS report_user
      WHERE report_user.is_active
        AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
    )
  );

CREATE POLICY filling_production_incharges_insert_authorized
  ON public.filling_production_incharges
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.filling_production_users AS report_user
      WHERE report_user.is_active
        AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
    )
  );

CREATE TABLE IF NOT EXISTS public.filling_hourly_production_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filling_request_id uuid NOT NULL REFERENCES public.filling_requests(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  hour_start time NOT NULL,
  incharge_name text NOT NULL REFERENCES public.filling_production_incharges(name),
  produced_pcs integer NOT NULL CHECK (produced_pcs >= 0),
  carton_pcs integer NOT NULL CHECK (carton_pcs > 0),
  cartons_completed integer NOT NULL CHECK (cartons_completed >= 0),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filling_hourly_production_reports_slot_unique
    UNIQUE (filling_request_id, report_date, hour_start)
);

CREATE INDEX IF NOT EXISTS filling_hourly_production_reports_request_date_idx
  ON public.filling_hourly_production_reports (filling_request_id, report_date);

ALTER TABLE public.filling_hourly_production_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.filling_hourly_production_reports FROM anon, authenticated;
GRANT SELECT ON TABLE public.filling_hourly_production_reports TO authenticated;

CREATE POLICY filling_hourly_production_reports_read_authorized
  ON public.filling_hourly_production_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.filling_production_users AS report_user
      WHERE report_user.is_active
        AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
    )
  );

CREATE OR REPLACE FUNCTION public.save_filling_hourly_production_report(
  p_filling_request_id uuid,
  p_report_date date,
  p_hour_start time,
  p_incharge_name text,
  p_produced_pcs integer,
  p_carton_pcs integer,
  p_cartons_completed integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  filling_request public.filling_requests%ROWTYPE;
  existing_report public.filling_hourly_production_reports%ROWTYPE;
  previous_produced_pcs integer;
  previous_cartons integer;
  previous_carton_pcs integer;
  required_cartons integer;
  has_incomplete_earlier_request boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_users AS report_user
    WHERE report_user.is_active
      AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
  ) THEN
    RAISE EXCEPTION 'You are not authorized to save production reports.';
  END IF;

  IF p_report_date IS NULL OR p_hour_start IS NULL OR p_incharge_name IS NULL
     OR p_produced_pcs IS NULL OR p_carton_pcs IS NULL OR p_cartons_completed IS NULL THEN
    RAISE EXCEPTION 'Complete all hourly report fields.';
  END IF;

  IF p_hour_start NOT IN (
    TIME '08:00', TIME '09:00', TIME '10:00', TIME '11:00', TIME '12:00',
    TIME '14:00', TIME '15:00', TIME '16:00', TIME '17:00', TIME '18:00',
    TIME '19:00'
  ) THEN
    RAISE EXCEPTION 'Choose a valid hourly production slot.';
  END IF;

  IF p_produced_pcs < 0 OR p_cartons_completed < 0 OR p_carton_pcs <= 0
     OR btrim(p_incharge_name) = '' THEN
    RAISE EXCEPTION 'Enter valid production and carton quantities and an incharge name.';
  END IF;

  SELECT *
  INTO filling_request
  FROM public.filling_requests
  WHERE id = p_filling_request_id
  FOR UPDATE;

  IF NOT FOUND OR filling_request.required_date <> p_report_date THEN
    RAISE EXCEPTION 'The filling request is not scheduled for this report date.';
  END IF;

  IF filling_request.room_number IS NULL OR filling_request.pcs_requested <= 0 THEN
    RAISE EXCEPTION 'The filling request is missing its room or requested quantity.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_report_date::text || ':' || filling_request.room_number::text,
      0
    )
  );

  IF filling_request.status NOT IN ('RECEIVED_BY_FILLING_INCHARGE', 'RECEIVED_AND_VERIFIED') THEN
    RAISE EXCEPTION 'This filling request is not yet ready for production reporting.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.filling_requests AS earlier_request
    WHERE earlier_request.required_date = filling_request.required_date
      AND earlier_request.room_number = filling_request.room_number
      AND (earlier_request.created_at, earlier_request.id) <
          (filling_request.created_at, filling_request.id)
      AND COALESCE((
        SELECT SUM(report.produced_pcs)
        FROM public.filling_hourly_production_reports AS report
        WHERE report.filling_request_id = earlier_request.id
          AND report.report_date = p_report_date
      ), 0) < earlier_request.pcs_requested
  )
  INTO has_incomplete_earlier_request;

  IF has_incomplete_earlier_request THEN
    RAISE EXCEPTION 'Finish the earlier product assigned to this room before reporting this request.';
  END IF;

  SELECT *
  INTO existing_report
  FROM public.filling_hourly_production_reports
  WHERE filling_request_id = p_filling_request_id
    AND report_date = p_report_date
    AND hour_start = p_hour_start
  FOR UPDATE;

  SELECT
    COALESCE(SUM(report.produced_pcs), 0)::integer,
    COALESCE(SUM(report.cartons_completed), 0)::integer,
    MIN(report.carton_pcs)
  INTO previous_produced_pcs, previous_cartons, previous_carton_pcs
  FROM public.filling_hourly_production_reports AS report
  WHERE report.filling_request_id = p_filling_request_id
    AND report.report_date = p_report_date
    AND (existing_report.id IS NULL OR report.id <> existing_report.id);

  IF previous_carton_pcs IS NOT NULL AND previous_carton_pcs <> p_carton_pcs THEN
    RAISE EXCEPTION 'Use the same pcs-per-carton value for every hour of this request.';
  END IF;

  IF previous_produced_pcs + p_produced_pcs > filling_request.pcs_requested THEN
    RAISE EXCEPTION 'Reported pcs cannot exceed the requested quantity.';
  END IF;

  required_cartons := CEIL(filling_request.pcs_requested::numeric / p_carton_pcs)::integer;
  IF previous_cartons + p_cartons_completed >
     CEIL((previous_produced_pcs + p_produced_pcs)::numeric / p_carton_pcs)::integer THEN
    RAISE EXCEPTION 'Completed cartons cannot exceed cartons supported by the reported pcs.';
  END IF;

  IF previous_cartons + p_cartons_completed > required_cartons THEN
    RAISE EXCEPTION 'Reported cartons cannot exceed the cartons required for this request.';
  END IF;

  INSERT INTO public.filling_hourly_production_reports (
    filling_request_id,
    report_date,
    hour_start,
    incharge_name,
    produced_pcs,
    carton_pcs,
    cartons_completed,
    created_by,
    updated_at
  )
  VALUES (
    p_filling_request_id,
    p_report_date,
    p_hour_start,
    btrim(p_incharge_name),
    p_produced_pcs,
    p_carton_pcs,
    p_cartons_completed,
    auth.uid(),
    now()
  )
  ON CONFLICT (filling_request_id, report_date, hour_start)
  DO UPDATE SET
    incharge_name = EXCLUDED.incharge_name,
    produced_pcs = EXCLUDED.produced_pcs,
    carton_pcs = EXCLUDED.carton_pcs,
    cartons_completed = EXCLUDED.cartons_completed,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.save_filling_hourly_production_report(
  uuid, date, time, text, integer, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_filling_hourly_production_report(
  uuid, date, time, text, integer, integer, integer
) TO authenticated;
