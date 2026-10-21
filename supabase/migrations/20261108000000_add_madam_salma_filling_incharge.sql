ALTER TABLE public.madam_salma_manual_report_headers
  ADD COLUMN IF NOT EXISTS filling_incharge text;

ALTER TABLE public.madam_salma_manual_hourly_reports
  ADD COLUMN IF NOT EXISTS filling_incharge text;

ALTER TABLE public.madam_salma_manual_hourly_reports
  DROP CONSTRAINT IF EXISTS madam_salma_manual_hourly_reports_production_incharge_fkey;

CREATE OR REPLACE FUNCTION public.save_madam_salma_manual_report_header(
  p_party_id uuid,
  p_product_id uuid,
  p_party_name text,
  p_product_name text,
  p_batch_no text,
  p_retail_price numeric,
  p_filling_incharge text,
  p_packing_incharge text,
  p_production_incharge text,
  p_mfg_date date,
  p_exp_date date,
  p_report_date date,
  p_room_number integer,
  p_master_carton_count integer,
  p_carton_pcs integer
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
    RAISE EXCEPTION 'You are not authorized to save production report details.';
  END IF;

  IF p_party_id IS NULL
     OR p_product_id IS NULL
     OR p_party_name IS NULL OR btrim(p_party_name) = ''
     OR p_product_name IS NULL OR btrim(p_product_name) = ''
     OR p_retail_price IS NULL OR p_retail_price < 0
     OR p_filling_incharge IS NULL OR btrim(p_filling_incharge) = ''
     OR p_packing_incharge IS NULL OR btrim(p_packing_incharge) = ''
     OR p_production_incharge IS NULL OR btrim(p_production_incharge) = ''
     OR p_mfg_date IS NULL OR p_exp_date IS NULL OR p_exp_date < p_mfg_date
     OR p_report_date IS NULL
     OR p_room_number IS NULL OR p_room_number NOT BETWEEN 1 AND 6
     OR p_master_carton_count IS NULL OR p_master_carton_count <= 0
     OR p_carton_pcs IS NULL OR p_carton_pcs <= 0 THEN
    RAISE EXCEPTION 'Enter valid party, product, dates, incharges, carton, and price details.';
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
    FROM public.filling_production_incharges
    WHERE name = p_filling_incharge AND is_active
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_incharges
    WHERE name = p_packing_incharge AND is_active
  ) THEN
    RAISE EXCEPTION 'Choose active filling and packing incharges.';
  END IF;

  IF lower(btrim(p_production_incharge)) NOT IN ('asim', 'mussarat')
     AND NOT EXISTS (
       SELECT 1
       FROM public.filling_production_incharges
       WHERE name = p_production_incharge
         AND is_active
     ) THEN
    RAISE EXCEPTION 'Choose an active production incharge.';
  END IF;

  INSERT INTO public.madam_salma_manual_report_headers (
    party_id, product_id, party_name, product_name, batch_no, retail_price,
    filling_incharge, packing_incharge, production_incharge, mfg_date, exp_date,
    room_number, master_carton_count, carton_pcs, report_date, created_by, updated_at
  )
  VALUES (
    p_party_id, p_product_id, btrim(p_party_name), btrim(p_product_name),
    NULLIF(btrim(p_batch_no), ''), p_retail_price, btrim(p_filling_incharge),
    btrim(p_packing_incharge), btrim(p_production_incharge), p_mfg_date, p_exp_date,
    p_room_number, p_master_carton_count, p_carton_pcs, p_report_date, auth.uid(), now()
  )
  ON CONFLICT (party_id, product_id, room_number, report_date)
  DO UPDATE SET
    party_name = EXCLUDED.party_name,
    product_name = EXCLUDED.product_name,
    batch_no = EXCLUDED.batch_no,
    retail_price = EXCLUDED.retail_price,
    filling_incharge = EXCLUDED.filling_incharge,
    packing_incharge = EXCLUDED.packing_incharge,
    production_incharge = EXCLUDED.production_incharge,
    mfg_date = EXCLUDED.mfg_date,
    exp_date = EXCLUDED.exp_date,
    master_carton_count = EXCLUDED.master_carton_count,
    carton_pcs = EXCLUDED.carton_pcs,
    updated_at = now();

  UPDATE public.madam_salma_manual_hourly_reports
  SET batch_no = NULLIF(btrim(p_batch_no), ''),
      retail_price = p_retail_price,
      filling_incharge = btrim(p_filling_incharge),
      packing_incharge = btrim(p_packing_incharge),
      production_incharge = btrim(p_production_incharge),
      mfg_date = p_mfg_date,
      exp_date = p_exp_date,
      master_carton_count = p_master_carton_count,
      carton_pcs = p_carton_pcs,
      updated_at = now()
  WHERE party_id = p_party_id
    AND product_id = p_product_id
    AND room_number = p_room_number
    AND report_date = p_report_date
    AND filling_request_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.save_madam_salma_manual_report_header(
  uuid, uuid, text, text, text, numeric, text, text, text, date, date, date, integer, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_madam_salma_manual_report_header(
  uuid, uuid, text, text, text, numeric, text, text, text, date, date, date, integer, integer, integer
) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_madam_salma_manual_hourly_report(
  p_party_id uuid,
  p_product_id uuid,
  p_party_name text,
  p_product_name text,
  p_batch_no text,
  p_retail_price numeric,
  p_filling_incharge text,
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
  production_incharge_was_active boolean;
  restore_production_incharge_status boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_users AS report_user
    WHERE report_user.is_active
      AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
  ) THEN
    RAISE EXCEPTION 'You are not authorized to save manual production reports.';
  END IF;

  IF p_filling_incharge IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_incharges
    WHERE name = p_filling_incharge AND is_active
  ) THEN
    RAISE EXCEPTION 'Choose an active filling incharge.';
  END IF;

  IF lower(btrim(p_production_incharge)) IN ('asim', 'mussarat') THEN
    SELECT is_active
    INTO production_incharge_was_active
    FROM public.filling_production_incharges
    WHERE name = btrim(p_production_incharge)
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.filling_production_incharges (name, created_by)
      VALUES (btrim(p_production_incharge), auth.uid());
      restore_production_incharge_status := true;
    ELSIF NOT production_incharge_was_active THEN
      UPDATE public.filling_production_incharges
      SET is_active = true
      WHERE name = btrim(p_production_incharge);
      restore_production_incharge_status := true;
    END IF;
  END IF;

  PERFORM public.save_madam_salma_manual_hourly_report(
    p_party_id, p_product_id, p_party_name, p_product_name, p_batch_no,
    p_retail_price, p_packing_incharge, p_production_incharge,
    p_mfg_date, p_exp_date, p_report_date, p_room_number,
    p_master_carton_count, p_hour_start, p_incharge_name,
    p_produced_pcs, p_carton_pcs, p_cartons_completed
  );

  IF restore_production_incharge_status THEN
    UPDATE public.filling_production_incharges
    SET is_active = false
    WHERE name = btrim(p_production_incharge);
  END IF;

  UPDATE public.madam_salma_manual_hourly_reports
  SET filling_incharge = btrim(p_filling_incharge),
      updated_at = now()
  WHERE party_id = p_party_id
    AND product_id = p_product_id
    AND room_number = p_room_number
    AND report_date = p_report_date
    AND hour_start = p_hour_start;
END;
$$;

REVOKE ALL ON FUNCTION public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, numeric, text, text, text, date, date, date,
  integer, integer, time, text, integer, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, numeric, text, text, text, date, date, date,
  integer, integer, time, text, integer, integer, integer
) TO authenticated;
