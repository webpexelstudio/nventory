ALTER TABLE public.party_product_mrps
  ADD COLUMN IF NOT EXISTS batch_qty integer
    CHECK (batch_qty IS NULL OR batch_qty > 0);

CREATE OR REPLACE FUNCTION public.prevent_duplicate_filling_request_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  normalized_batch text := lower(btrim(NEW.batch_no));
  configured_batch_qty integer;
BEGIN
  IF TG_OP = 'INSERT'
    OR NEW.pcs_requested IS DISTINCT FROM OLD.pcs_requested
    OR NEW.party_id IS DISTINCT FROM OLD.party_id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    SELECT mrp.batch_qty
    INTO configured_batch_qty
    FROM public.party_product_mrps AS mrp
    WHERE mrp.party_id = NEW.party_id
      AND mrp.product_id = NEW.product_id;

    IF configured_batch_qty IS NOT NULL
      AND NEW.pcs_requested IS DISTINCT FROM configured_batch_qty THEN
      RAISE EXCEPTION 'The fixed batch quantity for this product is % Pcs.', configured_batch_qty
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF normalized_batch IS NULL OR normalized_batch = '' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_batch, 0));

  IF EXISTS (
    SELECT 1
    FROM public.filling_requests AS request
    WHERE lower(btrim(request.batch_no)) = normalized_batch
      AND request.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'This batch number has already been issued. Enter a new batch number.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_filling_request_batch
  ON public.filling_requests;

CREATE TRIGGER prevent_duplicate_filling_request_batch
  BEFORE INSERT OR UPDATE OF batch_no, pcs_requested, party_id, product_id
  ON public.filling_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_filling_request_batch();

NOTIFY pgrst, 'reload schema';
