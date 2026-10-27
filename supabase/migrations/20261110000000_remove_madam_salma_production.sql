DROP TRIGGER IF EXISTS attach_madam_salma_manual_reports
  ON public.filling_requests;

DROP TRIGGER IF EXISTS retry_madam_salma_manual_report_links
  ON public.filling_hourly_production_reports;

DROP TRIGGER IF EXISTS sync_madam_salma_manual_report
  ON public.filling_hourly_production_reports;

DROP FUNCTION IF EXISTS public.try_attach_madam_salma_manual_hourly_reports(
  uuid, uuid, date, integer
);
DROP FUNCTION IF EXISTS public.attach_madam_salma_manual_reports_to_request();
DROP FUNCTION IF EXISTS public.retry_madam_salma_manual_report_links();
DROP FUNCTION IF EXISTS public.sync_madam_salma_manual_report_from_request_report();
DROP FUNCTION IF EXISTS public.add_madam_salma_manual_product(uuid, text);

DROP FUNCTION IF EXISTS public.save_madam_salma_manual_report_header(
  uuid, uuid, text, text, text, numeric, text, text, date, date, date,
  integer, integer, integer
);
DROP FUNCTION IF EXISTS public.save_madam_salma_manual_report_header(
  uuid, uuid, text, text, text, numeric, text, text, text, date, date, date,
  integer, integer, integer
);

DROP FUNCTION IF EXISTS public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, date, integer, time, text, integer, integer, integer
);
DROP FUNCTION IF EXISTS public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, date, date, date, integer, integer, time, text,
  integer, integer, integer
);
DROP FUNCTION IF EXISTS public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, numeric, text, text, date, date, date, integer,
  integer, time, text, integer, integer, integer
);
DROP FUNCTION IF EXISTS public.save_madam_salma_manual_hourly_report(
  uuid, uuid, text, text, text, numeric, text, text, text, date, date, date,
  integer, integer, time, text, integer, integer, integer
);

DELETE FROM public.filling_hourly_production_reports AS report
USING public.madam_salma_manual_hourly_reports AS manual_report
WHERE manual_report.filling_request_id = report.filling_request_id
  AND manual_report.report_date = report.report_date
  AND manual_report.hour_start = report.hour_start;

DROP TABLE IF EXISTS public.madam_salma_manual_report_headers;
DROP TABLE IF EXISTS public.madam_salma_manual_hourly_reports;

DELETE FROM public.filling_production_users
WHERE lower(email) = 'madam_salma@gmail.com';

CREATE OR REPLACE FUNCTION public.sync_product_name_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_party_name text;
BEGIN
  IF NEW.product_name IS NOT DISTINCT FROM OLD.product_name THEN
    RETURN NEW;
  END IF;

  SELECT name
  INTO old_party_name
  FROM public.parties
  WHERE id = OLD.party_id;

  UPDATE public.inventory
  SET product_name = NEW.product_name
  WHERE product_id = NEW.id
     OR (
       product_id IS NULL
       AND product_name = OLD.product_name
       AND (
         party_id = OLD.party_id
         OR (
           party_id IS NULL
           AND old_party_name IS NOT NULL
           AND lower(btrim(party_name)) = lower(btrim(old_party_name))
         )
       )
     );

  UPDATE public.filling_requests
  SET product_name = NEW.product_name
  WHERE product_id = NEW.id
     OR (
       product_id IS NULL
       AND party_id = OLD.party_id
       AND product_name = OLD.product_name
     );

  UPDATE public.filling_material_returns
  SET product_name = NEW.product_name
  WHERE product_id = NEW.id;

  IF old_party_name IS NOT NULL THEN
    UPDATE public.inventory_logs
    SET product_name = NEW.product_name
    WHERE product_name = OLD.product_name
      AND lower(btrim(party_name)) = lower(btrim(old_party_name));
  END IF;

  RETURN NEW;
END;
$$;
