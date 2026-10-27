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

DROP TRIGGER IF EXISTS sync_product_name_changes
  ON public.products;

CREATE TRIGGER sync_product_name_changes
  AFTER UPDATE OF product_name ON public.products
  FOR EACH ROW
  WHEN (OLD.product_name IS DISTINCT FROM NEW.product_name)
  EXECUTE FUNCTION public.sync_product_name_changes();
