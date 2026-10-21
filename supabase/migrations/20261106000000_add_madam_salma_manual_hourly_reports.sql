ALTER TABLE public.filling_hourly_production_reports
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS filling_request_id uuid
    REFERENCES public.filling_requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS report_date date,
  ADD COLUMN IF NOT EXISTS hour_start time,
  ADD COLUMN IF NOT EXISTS incharge_name text,
  ADD COLUMN IF NOT EXISTS produced_pcs integer,
  ADD COLUMN IF NOT EXISTS carton_pcs integer,
  ADD COLUMN IF NOT EXISTS cartons_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.madam_salma_manual_hourly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  party_name text NOT NULL,
  product_name text NOT NULL,
  batch_no text,
  retail_price numeric(12, 2) NOT NULL CHECK (retail_price >= 0),
  packing_incharge text NOT NULL REFERENCES public.filling_production_incharges(name),
  production_incharge text NOT NULL REFERENCES public.filling_production_incharges(name),
  mfg_date date NOT NULL,
  exp_date date NOT NULL,
  room_number integer NOT NULL CHECK (room_number BETWEEN 1 AND 6),
  master_carton_count integer NOT NULL CHECK (master_carton_count > 0),
  report_date date NOT NULL,
  hour_start time NOT NULL,
  incharge_name text NOT NULL REFERENCES public.filling_production_incharges(name),
  produced_pcs integer NOT NULL CHECK (produced_pcs >= 0),
  carton_pcs integer NOT NULL CHECK (carton_pcs > 0),
  cartons_completed integer NOT NULL CHECK (cartons_completed >= 0),
  filling_request_id uuid REFERENCES public.filling_requests(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT madam_salma_manual_hourly_slot_unique
    UNIQUE (party_id, product_id, room_number, report_date, hour_start)
);

ALTER TABLE public.madam_salma_manual_hourly_reports
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id),
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id),
  ADD COLUMN IF NOT EXISTS party_name text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS batch_no text,
  ADD COLUMN IF NOT EXISTS retail_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS packing_incharge text REFERENCES public.filling_production_incharges(name),
  ADD COLUMN IF NOT EXISTS production_incharge text REFERENCES public.filling_production_incharges(name),
  ADD COLUMN IF NOT EXISTS mfg_date date,
  ADD COLUMN IF NOT EXISTS exp_date date,
  ADD COLUMN IF NOT EXISTS room_number integer,
  ADD COLUMN IF NOT EXISTS master_carton_count integer,
  ADD COLUMN IF NOT EXISTS report_date date,
  ADD COLUMN IF NOT EXISTS hour_start time,
  ADD COLUMN IF NOT EXISTS incharge_name text REFERENCES public.filling_production_incharges(name),
  ADD COLUMN IF NOT EXISTS produced_pcs integer,
  ADD COLUMN IF NOT EXISTS carton_pcs integer,
  ADD COLUMN IF NOT EXISTS cartons_completed integer,
  ADD COLUMN IF NOT EXISTS filling_request_id uuid
    REFERENCES public.filling_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS madam_salma_manual_hourly_request_idx
  ON public.madam_salma_manual_hourly_reports (filling_request_id, report_date);

CREATE INDEX IF NOT EXISTS madam_salma_manual_hourly_lookup_idx
  ON public.madam_salma_manual_hourly_reports (party_id, product_id, room_number, report_date);

CREATE UNIQUE INDEX IF NOT EXISTS madam_salma_manual_hourly_slot_unique_idx
  ON public.madam_salma_manual_hourly_reports (party_id, product_id, room_number, report_date, hour_start);

ALTER TABLE public.madam_salma_manual_hourly_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.madam_salma_manual_hourly_reports FROM anon, authenticated;
GRANT SELECT ON TABLE public.madam_salma_manual_hourly_reports TO authenticated;

DROP POLICY IF EXISTS madam_salma_manual_hourly_reports_read_authorized
  ON public.madam_salma_manual_hourly_reports;

CREATE POLICY madam_salma_manual_hourly_reports_read_authorized
  ON public.madam_salma_manual_hourly_reports
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

CREATE OR REPLACE FUNCTION public.try_attach_madam_salma_manual_hourly_reports(
  p_party_id uuid,
  p_product_id uuid,
  p_report_date date,
  p_room_number integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched_request public.filling_requests%ROWTYPE;
  matching_request_count integer;
  manual_pcs integer;
  manual_cartons integer;
  manual_carton_pcs integer;
  saved_pcs integer;
  saved_cartons integer;
  saved_carton_pcs integer;
  has_incomplete_earlier_request boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_party_id::text || ':' || p_product_id::text || ':' ||
      p_report_date::text || ':' || p_room_number::text,
      0
    )
  );

  SELECT COUNT(*)::integer
  INTO matching_request_count
  FROM public.filling_requests AS request
  WHERE request.party_id = p_party_id
    AND request.product_id = p_product_id
    AND request.required_date = p_report_date
    AND request.room_number = p_room_number;

  IF matching_request_count <> 1 THEN
    RETURN;
  END IF;

  SELECT *
  INTO matched_request
  FROM public.filling_requests AS request
  WHERE request.party_id = p_party_id
    AND request.product_id = p_product_id
    AND request.required_date = p_report_date
    AND request.room_number = p_room_number
  LIMIT 1
  FOR UPDATE;

  IF matched_request.status NOT IN ('RECEIVED_BY_FILLING_INCHARGE', 'RECEIVED_AND_VERIFIED') THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.madam_salma_manual_hourly_reports AS manual_report
    WHERE manual_report.party_id = p_party_id
      AND manual_report.product_id = p_product_id
      AND manual_report.report_date = p_report_date
      AND manual_report.room_number = p_room_number
      AND manual_report.filling_request_id IS NULL
      AND (
        manual_report.mfg_date IS DISTINCT FROM matched_request.mfg_date
        OR manual_report.exp_date IS DISTINCT FROM matched_request.exp_date
      )
  ) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.filling_requests AS earlier_request
    WHERE earlier_request.required_date = matched_request.required_date
      AND earlier_request.room_number = matched_request.room_number
      AND (earlier_request.created_at, earlier_request.id) <
          (matched_request.created_at, matched_request.id)
      AND COALESCE((
        SELECT SUM(report.produced_pcs)
        FROM public.filling_hourly_production_reports AS report
        WHERE report.filling_request_id = earlier_request.id
          AND report.report_date = p_report_date
      ), 0) < earlier_request.pcs_requested
  )
  INTO has_incomplete_earlier_request;

  IF has_incomplete_earlier_request THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.madam_salma_manual_hourly_reports AS manual_report
    JOIN public.filling_hourly_production_reports AS saved_report
      ON saved_report.filling_request_id = matched_request.id
     AND saved_report.report_date = p_report_date
     AND saved_report.hour_start = manual_report.hour_start
    WHERE manual_report.party_id = p_party_id
      AND manual_report.product_id = p_product_id
      AND manual_report.report_date = p_report_date
      AND manual_report.room_number = p_room_number
      AND manual_report.filling_request_id IS NULL
  ) THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(manual_report.produced_pcs), 0)::integer,
    COALESCE(SUM(manual_report.cartons_completed), 0)::integer,
    MIN(manual_report.carton_pcs)
  INTO manual_pcs, manual_cartons, manual_carton_pcs
  FROM public.madam_salma_manual_hourly_reports AS manual_report
  WHERE manual_report.party_id = p_party_id
    AND manual_report.product_id = p_product_id
    AND manual_report.report_date = p_report_date
    AND manual_report.room_number = p_room_number
    AND manual_report.filling_request_id IS NULL;

  IF manual_carton_pcs IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.madam_salma_manual_hourly_reports AS manual_report
    WHERE manual_report.party_id = p_party_id
      AND manual_report.product_id = p_product_id
      AND manual_report.report_date = p_report_date
      AND manual_report.room_number = p_room_number
      AND manual_report.filling_request_id IS NULL
      AND manual_report.carton_pcs <> manual_carton_pcs
  ) THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(saved_report.produced_pcs), 0)::integer,
    COALESCE(SUM(saved_report.cartons_completed), 0)::integer,
    MIN(saved_report.carton_pcs)
  INTO saved_pcs, saved_cartons, saved_carton_pcs
  FROM public.filling_hourly_production_reports AS saved_report
  WHERE saved_report.filling_request_id = matched_request.id
    AND saved_report.report_date = p_report_date;

  IF saved_carton_pcs IS NOT NULL AND saved_carton_pcs <> manual_carton_pcs THEN
    RETURN;
  END IF;

  IF saved_pcs + manual_pcs > matched_request.pcs_requested
     OR saved_cartons + manual_cartons >
       CEIL((saved_pcs + manual_pcs)::numeric / manual_carton_pcs)::integer
     OR saved_cartons + manual_cartons >
       CEIL(matched_request.pcs_requested::numeric / manual_carton_pcs)::integer THEN
    RETURN;
  END IF;

  UPDATE public.madam_salma_manual_hourly_reports
  SET filling_request_id = matched_request.id,
      updated_at = now()
  WHERE party_id = p_party_id
    AND product_id = p_product_id
    AND report_date = p_report_date
    AND room_number = p_room_number
    AND filling_request_id IS NULL;

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
  SELECT
    matched_request.id,
    manual_report.report_date,
    manual_report.hour_start,
    manual_report.incharge_name,
    manual_report.produced_pcs,
    manual_report.carton_pcs,
    manual_report.cartons_completed,
    manual_report.created_by,
    now()
  FROM public.madam_salma_manual_hourly_reports AS manual_report
  WHERE manual_report.party_id = p_party_id
    AND manual_report.product_id = p_product_id
    AND manual_report.report_date = p_report_date
    AND manual_report.room_number = p_room_number
    AND manual_report.filling_request_id = matched_request.id;
END;
$$;

REVOKE ALL ON FUNCTION public.try_attach_madam_salma_manual_hourly_reports(uuid, uuid, date, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.attach_madam_salma_manual_reports_to_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate record;
BEGIN
  IF NEW.required_date IS NOT NULL AND NEW.room_number IS NOT NULL THEN
    FOR candidate IN
      SELECT
        manual_report.party_id,
        manual_report.product_id,
        manual_report.report_date,
        manual_report.room_number
      FROM public.madam_salma_manual_hourly_reports AS manual_report
      JOIN public.filling_requests AS request
        ON request.party_id = manual_report.party_id
       AND request.product_id = manual_report.product_id
       AND request.required_date = manual_report.report_date
       AND request.room_number = manual_report.room_number
      WHERE manual_report.filling_request_id IS NULL
        AND manual_report.report_date = NEW.required_date
        AND manual_report.room_number = NEW.room_number
      GROUP BY
        manual_report.party_id,
        manual_report.product_id,
        manual_report.report_date,
        manual_report.room_number
      ORDER BY MIN(request.created_at)
    LOOP
      PERFORM public.try_attach_madam_salma_manual_hourly_reports(
        candidate.party_id,
        candidate.product_id,
        candidate.report_date,
        candidate.room_number
    );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attach_madam_salma_manual_reports
  ON public.filling_requests;

CREATE TRIGGER attach_madam_salma_manual_reports
  AFTER INSERT OR UPDATE OF party_id, product_id, required_date, room_number, status
  ON public.filling_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.attach_madam_salma_manual_reports_to_request();

CREATE OR REPLACE FUNCTION public.retry_madam_salma_manual_report_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_room integer;
  candidate record;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT request.room_number
  INTO target_room
  FROM public.filling_requests AS request
  WHERE request.id = NEW.filling_request_id;

  IF target_room IS NULL THEN
    RETURN NEW;
  END IF;

  FOR candidate IN
    SELECT
      manual_report.party_id,
      manual_report.product_id,
      manual_report.report_date,
      manual_report.room_number
    FROM public.madam_salma_manual_hourly_reports AS manual_report
    JOIN public.filling_requests AS request
      ON request.party_id = manual_report.party_id
     AND request.product_id = manual_report.product_id
     AND request.required_date = manual_report.report_date
     AND request.room_number = manual_report.room_number
    WHERE manual_report.filling_request_id IS NULL
      AND manual_report.report_date = NEW.report_date
      AND manual_report.room_number = target_room
    GROUP BY
      manual_report.party_id,
      manual_report.product_id,
      manual_report.report_date,
      manual_report.room_number
    ORDER BY MIN(request.created_at)
  LOOP
    PERFORM public.try_attach_madam_salma_manual_hourly_reports(
      candidate.party_id,
      candidate.product_id,
      candidate.report_date,
      candidate.room_number
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_madam_salma_manual_report_links()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS retry_madam_salma_manual_report_links
  ON public.filling_hourly_production_reports;

CREATE TRIGGER retry_madam_salma_manual_report_links
  AFTER INSERT OR UPDATE OF produced_pcs, cartons_completed
  ON public.filling_hourly_production_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.retry_madam_salma_manual_report_links();

DROP FUNCTION IF EXISTS public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, date, integer, time, text, integer, integer, integer
);
DROP FUNCTION IF EXISTS public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, date, date, date, integer, integer, time, text, integer, integer, integer
);

CREATE OR REPLACE FUNCTION public.save_madam_salma_manual_hourly_report(
  p_party_id uuid,
  p_product_id uuid,
  p_party_name text,
  p_product_name text,
  p_batch_no text,
  p_retail_price numeric,
  p_packing_incharge text,
  p_production_incharge text,
  p_mfg_date date,
  p_exp_date date,
  p_report_date date,
  p_room_number integer,
  p_master_carton_count integer,
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
  existing_report public.madam_salma_manual_hourly_reports%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_users AS report_user
    WHERE report_user.is_active
      AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
  ) THEN
    RAISE EXCEPTION 'You are not authorized to save manual production reports.';
  END IF;

  IF p_party_id IS NULL OR p_product_id IS NULL
     OR p_party_name IS NULL OR btrim(p_party_name) = ''
     OR p_product_name IS NULL OR btrim(p_product_name) = ''
     OR p_retail_price IS NULL OR p_retail_price < 0
     OR p_packing_incharge IS NULL OR btrim(p_packing_incharge) = ''
     OR p_production_incharge IS NULL OR btrim(p_production_incharge) = ''
     OR p_mfg_date IS NULL OR p_exp_date IS NULL
     OR p_exp_date < p_mfg_date
     OR p_report_date IS NULL
     OR p_room_number IS NULL OR p_hour_start IS NULL
     OR p_room_number NOT BETWEEN 1 AND 6
     OR p_master_carton_count IS NULL OR p_master_carton_count <= 0
     OR p_hour_start NOT IN (
       TIME '08:00', TIME '09:00', TIME '10:00', TIME '11:00', TIME '12:00',
       TIME '14:00', TIME '15:00', TIME '16:00', TIME '17:00', TIME '18:00',
       TIME '19:00'
     )
     OR p_incharge_name IS NULL OR btrim(p_incharge_name) = ''
     OR p_produced_pcs IS NULL OR p_produced_pcs < 0
     OR p_carton_pcs IS NULL OR p_carton_pcs <= 0
     OR p_cartons_completed IS NULL OR p_cartons_completed < 0 THEN
    RAISE EXCEPTION 'Enter valid party, product, room, hour, incharge, and production quantities.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.filling_production_incharges
    WHERE name = p_packing_incharge AND is_active
  ) OR NOT EXISTS (
    SELECT 1 FROM public.filling_production_incharges
    WHERE name = p_production_incharge AND is_active
  ) THEN
    RAISE EXCEPTION 'Choose active packing and production incharges.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.id = p_product_id
      AND product.party_id = p_party_id
  ) THEN
    RAISE EXCEPTION 'The selected product does not belong to the selected party.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.master_carton_options AS carton_option
    WHERE carton_option.carton_count = p_master_carton_count
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.master_carton_product_settings AS carton_setting
    WHERE carton_setting.product_id = p_product_id
      AND carton_setting.carton_count = p_master_carton_count
  ) THEN
    RAISE EXCEPTION 'Choose a master carton option configured in Admin for this product.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.filling_production_incharges AS incharge
    JOIN public.filling_production_incharge_rooms AS assignment
      ON assignment.incharge_name = incharge.name
    WHERE incharge.name = p_incharge_name
      AND incharge.is_active
      AND assignment.room_number = p_room_number
  ) THEN
    RAISE EXCEPTION 'Assign this active incharge to the selected room before saving.';
  END IF;

  SELECT *
  INTO existing_report
  FROM public.madam_salma_manual_hourly_reports
  WHERE party_id = p_party_id
    AND product_id = p_product_id
    AND room_number = p_room_number
    AND report_date = p_report_date
    AND hour_start = p_hour_start
  FOR UPDATE;

  IF existing_report.filling_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'This report is already linked to a filling request. Edit it from the request hourly report section.';
  END IF;

  UPDATE public.madam_salma_manual_hourly_reports
  SET retail_price = p_retail_price,
      packing_incharge = btrim(p_packing_incharge),
      production_incharge = btrim(p_production_incharge),
      updated_at = now()
  WHERE party_id = p_party_id
    AND product_id = p_product_id
    AND room_number = p_room_number
    AND report_date = p_report_date
    AND filling_request_id IS NULL;

  INSERT INTO public.madam_salma_manual_hourly_reports (
    party_id, product_id, party_name, product_name, batch_no, retail_price,
    packing_incharge, production_incharge, mfg_date, exp_date, room_number,
    master_carton_count, report_date, hour_start, incharge_name,
    produced_pcs, carton_pcs, cartons_completed, created_by, updated_at
  )
  VALUES (
    p_party_id, p_product_id, btrim(p_party_name), btrim(p_product_name), NULLIF(btrim(p_batch_no), ''),
    p_retail_price, btrim(p_packing_incharge), btrim(p_production_incharge),
    p_mfg_date, p_exp_date, p_room_number, p_master_carton_count, p_report_date, p_hour_start, btrim(p_incharge_name),
    p_produced_pcs, p_carton_pcs, p_cartons_completed, auth.uid(), now()
  )
  ON CONFLICT (party_id, product_id, room_number, report_date, hour_start)
  DO UPDATE SET
    party_name = EXCLUDED.party_name,
    product_name = EXCLUDED.product_name,
    batch_no = EXCLUDED.batch_no,
    retail_price = EXCLUDED.retail_price,
    packing_incharge = EXCLUDED.packing_incharge,
    production_incharge = EXCLUDED.production_incharge,
    mfg_date = EXCLUDED.mfg_date,
    exp_date = EXCLUDED.exp_date,
    master_carton_count = EXCLUDED.master_carton_count,
    incharge_name = EXCLUDED.incharge_name,
    produced_pcs = EXCLUDED.produced_pcs,
    carton_pcs = EXCLUDED.carton_pcs,
    cartons_completed = EXCLUDED.cartons_completed,
    updated_at = now()
  WHERE public.madam_salma_manual_hourly_reports.filling_request_id IS NULL;

  PERFORM public.try_attach_madam_salma_manual_hourly_reports(
    p_party_id, p_product_id, p_report_date, p_room_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, numeric, text, text, date, date, date, integer, integer, time, text, integer, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, numeric, text, text, date, date, date, integer, integer, time, text, integer, integer, integer
) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_madam_salma_manual_report_from_request_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.madam_salma_manual_hourly_reports
  SET incharge_name = NEW.incharge_name,
      produced_pcs = NEW.produced_pcs,
      carton_pcs = NEW.carton_pcs,
      cartons_completed = NEW.cartons_completed,
      updated_at = now()
  WHERE filling_request_id = NEW.filling_request_id
    AND report_date = NEW.report_date
    AND hour_start = NEW.hour_start;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_madam_salma_manual_report_from_request_report()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_madam_salma_manual_report
  ON public.filling_hourly_production_reports;

CREATE TRIGGER sync_madam_salma_manual_report
  AFTER UPDATE OF incharge_name, produced_pcs, carton_pcs, cartons_completed
  ON public.filling_hourly_production_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_madam_salma_manual_report_from_request_report();

CREATE OR REPLACE FUNCTION public.add_madam_salma_manual_product(
  p_party_id uuid,
  p_product_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_product_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_users AS report_user
    WHERE report_user.is_active
      AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
  ) THEN
    RAISE EXCEPTION 'You are not authorized to add products from the production report.';
  END IF;

  IF p_party_id IS NULL OR p_product_name IS NULL OR btrim(p_product_name) = '' THEN
    RAISE EXCEPTION 'Select a party and enter a product name.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.parties WHERE id = p_party_id) THEN
    RAISE EXCEPTION 'The selected party was not found.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_party_id::text || ':' || lower(btrim(p_product_name)),
    0
  ));

  IF EXISTS (
    SELECT 1
    FROM public.products AS product
    WHERE product.party_id = p_party_id
      AND lower(btrim(product.product_name)) = lower(btrim(p_product_name))
  ) THEN
    RAISE EXCEPTION 'A product with this name already exists for the selected party.';
  END IF;

  INSERT INTO public.products (product_name, party_id)
  VALUES (btrim(p_product_name), p_party_id)
  RETURNING id INTO new_product_id;

  RETURN new_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_madam_salma_manual_product(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_madam_salma_manual_product(uuid, text)
  TO authenticated;
