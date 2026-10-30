ALTER TABLE public.filling_material_returns
  ADD COLUMN IF NOT EXISTS destination text;

ALTER TABLE public.filling_material_returns
  DROP CONSTRAINT IF EXISTS filling_material_returns_status_check;

UPDATE public.filling_material_returns
SET destination = CASE WHEN kind = 'DAMAGED' THEN 'PARTY' ELSE 'WAREHOUSE' END,
    status = CASE
      WHEN kind = 'DAMAGED' AND status = 'PENDING_WAREHOUSE' THEN 'RETURNED_TO_PARTY'
      ELSE status
    END
WHERE destination IS NULL;

ALTER TABLE public.filling_material_returns
  ALTER COLUMN destination SET DEFAULT 'WAREHOUSE',
  ALTER COLUMN destination SET NOT NULL,
  DROP CONSTRAINT IF EXISTS filling_material_returns_destination_check,
  DROP CONSTRAINT IF EXISTS party_destination_requires_return_date,
  DROP CONSTRAINT IF EXISTS damaged_material_requires_return_date,
  DROP CONSTRAINT IF EXISTS filling_material_returns_status_check,
  ADD CONSTRAINT filling_material_returns_destination_check
    CHECK (destination IN ('WAREHOUSE', 'PARTY')),
  ADD CONSTRAINT party_destination_requires_return_date
    CHECK (destination <> 'PARTY' OR party_return_date IS NOT NULL),
  ADD CONSTRAINT filling_material_returns_status_check
    CHECK (status IN ('PENDING_WAREHOUSE', 'RECEIVED_BY_WAREHOUSE', 'RETURNED_TO_PARTY'));

CREATE OR REPLACE FUNCTION public.receive_filling_material_return(p_return_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  material_return public.filling_material_returns%ROWTYPE;
  component jsonb;
  component_type text;
  component_quantity integer;
  inventory_id public.inventory.id%TYPE;
  inventory_party_id public.inventory.party_id%TYPE;
  inventory_product_id public.inventory.product_id%TYPE;
BEGIN
  SELECT *
  INTO material_return
  FROM public.filling_material_returns
  WHERE id::text = p_return_id::text
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return or damage record was not found.';
  END IF;

  IF material_return.status <> 'PENDING_WAREHOUSE' THEN
    RAISE EXCEPTION 'This record has already been processed.';
  END IF;

  IF material_return.destination <> 'WAREHOUSE' THEN
    RAISE EXCEPTION 'This record is being returned to the party, not received by the warehouse.';
  END IF;

  IF material_return.kind = 'RETURN' THEN
    FOR component IN SELECT value FROM jsonb_array_elements(material_return.components)
    LOOP
      component_type := lower(btrim(component ->> 'component_type'));
      component_quantity := (component ->> 'quantity')::integer;

      IF component_type = '' OR component_quantity <= 0 THEN
        RAISE EXCEPTION 'A component has an invalid type or quantity.';
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtextextended(
          material_return.party_id::text || ':' ||
          material_return.product_id::text || ':' ||
          component_type,
          0
        )
      );

      SELECT stock.id
      INTO inventory_id
      FROM public.inventory AS stock
      WHERE (stock.party_id::text = material_return.party_id::text OR
             (stock.party_id IS NULL AND lower(stock.party_name) = lower(material_return.party_name)))
        AND (stock.product_id::text = material_return.product_id::text OR
             (stock.product_id IS NULL AND lower(stock.product_name) = lower(material_return.product_name)))
        AND lower(btrim(stock.component_type)) = component_type
      ORDER BY CASE WHEN stock.party_id::text = material_return.party_id::text THEN 1 ELSE 0 END DESC,
               CASE WHEN stock.product_id::text = material_return.product_id::text THEN 1 ELSE 0 END DESC
      LIMIT 1
      FOR UPDATE;

      IF inventory_id IS NULL THEN
        inventory_party_id := material_return.party_id;
        inventory_product_id := material_return.product_id;

        INSERT INTO public.inventory (
          party_id, party_name, product_id, product_name, component_type, quantity
        )
        VALUES (
          inventory_party_id,
          material_return.party_name,
          inventory_product_id,
          material_return.product_name,
          component_type,
          component_quantity
        );
      ELSE
        UPDATE public.inventory
        SET quantity = quantity + component_quantity
        WHERE id::text = inventory_id::text;
      END IF;

      INSERT INTO public.inventory_logs (
        action_type, party_name, product_name, component_type, quantity, remarks, created_at
      )
      VALUES (
        'IN',
        material_return.party_name,
        material_return.product_name,
        component_type,
        component_quantity,
        'Filling return received for batch ' || COALESCE(material_return.batch_no, 'N/A'),
        now()
      );
    END LOOP;
  END IF;

  UPDATE public.filling_material_returns
  SET status = 'RECEIVED_BY_WAREHOUSE',
      received_at = now()
  WHERE id::text = p_return_id::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_filling_material_return(uuid) TO anon, authenticated;
