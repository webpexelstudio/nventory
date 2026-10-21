CREATE TABLE IF NOT EXISTS public.madam_salma_manual_report_headers (
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  party_name text NOT NULL,
  product_name text NOT NULL,
  batch_no text,
  retail_price numeric(12, 2) NOT NULL CHECK (retail_price >= 0),
  packing_incharge text NOT NULL,
  production_incharge text NOT NULL,
  mfg_date date NOT NULL,
  exp_date date NOT NULL CHECK (exp_date >= mfg_date),
  room_number integer NOT NULL CHECK (room_number BETWEEN 1 AND 6),
  master_carton_count integer NOT NULL CHECK (master_carton_count > 0),
  carton_pcs integer NOT NULL CHECK (carton_pcs > 0),
  report_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, product_id, room_number, report_date)
);

ALTER TABLE public.madam_salma_manual_report_headers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.madam_salma_manual_report_headers FROM anon, authenticated;
GRANT SELECT ON TABLE public.madam_salma_manual_report_headers TO authenticated;

DROP POLICY IF EXISTS madam_salma_manual_report_headers_read_authorized
  ON public.madam_salma_manual_report_headers;

CREATE POLICY madam_salma_manual_report_headers_read_authorized
  ON public.madam_salma_manual_report_headers
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

CREATE OR REPLACE FUNCTION public.save_madam_salma_manual_report_header(
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
    WHERE name = p_packing_incharge AND is_active
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_incharges
    WHERE name = p_production_incharge AND is_active
  ) THEN
    RAISE EXCEPTION 'Choose active packing and production incharges.';
  END IF;

  INSERT INTO public.madam_salma_manual_report_headers (
    party_id, product_id, party_name, product_name, batch_no, retail_price,
    packing_incharge, production_incharge, mfg_date, exp_date, room_number,
    master_carton_count, carton_pcs, report_date, created_by, updated_at
  )
  VALUES (
    p_party_id, p_product_id, btrim(p_party_name), btrim(p_product_name),
    NULLIF(btrim(p_batch_no), ''), p_retail_price, btrim(p_packing_incharge),
    btrim(p_production_incharge), p_mfg_date, p_exp_date, p_room_number,
    p_master_carton_count, p_carton_pcs, p_report_date, auth.uid(), now()
  )
  ON CONFLICT (party_id, product_id, room_number, report_date)
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
    carton_pcs = EXCLUDED.carton_pcs,
    updated_at = now();

  UPDATE public.madam_salma_manual_hourly_reports
  SET batch_no = NULLIF(btrim(p_batch_no), ''),
      retail_price = p_retail_price,
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
  uuid, uuid, text, text, text, numeric, text, text, date, date, date, integer, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_madam_salma_manual_report_header(
  uuid, uuid, text, text, text, numeric, text, text, date, date, date, integer, integer, integer
) TO authenticated;
