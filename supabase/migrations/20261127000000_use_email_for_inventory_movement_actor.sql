CREATE OR REPLACE FUNCTION public.record_inventory_movement(
  p_action_type text,
  p_party_id uuid,
  p_product_id uuid,
  p_component_type text,
  p_quantity integer,
  p_remarks text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_party_name text;
  v_product_name text;
  v_actor_name text;
  v_stock_id uuid;
  v_available numeric := 0;
  v_remaining numeric;
  v_stock record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_app_role('admin', 'warehouse', 'inventory_viewer') THEN
    RAISE EXCEPTION 'You are not allowed to record inventory movements.';
  END IF;

  IF p_action_type IS NULL OR upper(btrim(p_action_type)) NOT IN ('IN', 'OUT') THEN
    RAISE EXCEPTION 'Movement type must be IN or OUT.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be a whole number greater than zero.';
  END IF;
  IF nullif(btrim(p_component_type), '') IS NULL THEN
    RAISE EXCEPTION 'Component type is required.';
  END IF;

  SELECT name
  INTO v_party_name
  FROM public.parties
  WHERE id = p_party_id;
  IF v_party_name IS NULL THEN
    RAISE EXCEPTION 'Selected party could not be found.';
  END IF;

  SELECT product_name
  INTO v_product_name
  FROM public.products
  WHERE id = p_product_id
    AND party_id = p_party_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Selected product does not belong to the selected party.';
  END IF;

  v_actor_name := coalesce(
    nullif(btrim(auth.jwt() ->> 'email'), ''),
    'office@gmail.com'
  );

  IF upper(btrim(p_action_type)) = 'IN' THEN
    SELECT id
    INTO v_stock_id
    FROM public.inventory
    WHERE (party_id = p_party_id OR (party_id IS NULL AND lower(btrim(party_name)) = lower(btrim(v_party_name))))
      AND (product_id = p_product_id OR (product_id IS NULL AND lower(btrim(product_name)) = lower(btrim(v_product_name))))
      AND lower(btrim(component_type)) = lower(btrim(p_component_type))
      AND carton_count IS NULL
      AND carton_name IS NULL
    ORDER BY id
    LIMIT 1
    FOR UPDATE;

    IF v_stock_id IS NULL THEN
      INSERT INTO public.inventory (
        party_id,
        party_name,
        product_id,
        product_name,
        component_type,
        quantity
      )
      VALUES (
        p_party_id,
        v_party_name,
        p_product_id,
        v_product_name,
        btrim(p_component_type),
        p_quantity
      );
    ELSE
      UPDATE public.inventory
      SET quantity = quantity + p_quantity
      WHERE id = v_stock_id;
    END IF;
  ELSE
    FOR v_stock IN
      SELECT id, quantity
      FROM public.inventory
      WHERE (party_id = p_party_id OR (party_id IS NULL AND lower(btrim(party_name)) = lower(btrim(v_party_name))))
        AND (product_id = p_product_id OR (product_id IS NULL AND lower(btrim(product_name)) = lower(btrim(v_product_name))))
        AND lower(btrim(component_type)) = lower(btrim(p_component_type))
        AND carton_count IS NULL
        AND carton_name IS NULL
        AND quantity > 0
      ORDER BY id
      FOR UPDATE
    LOOP
      v_available := v_available + v_stock.quantity;
    END LOOP;

    IF v_available < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock. Available quantity: %.', v_available;
    END IF;

    v_remaining := p_quantity;
    FOR v_stock IN
      SELECT id, quantity
      FROM public.inventory
      WHERE (party_id = p_party_id OR (party_id IS NULL AND lower(btrim(party_name)) = lower(btrim(v_party_name))))
        AND (product_id = p_product_id OR (product_id IS NULL AND lower(btrim(product_name)) = lower(btrim(v_product_name))))
        AND lower(btrim(component_type)) = lower(btrim(p_component_type))
        AND carton_count IS NULL
        AND carton_name IS NULL
        AND quantity > 0
      ORDER BY id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining = 0;
      UPDATE public.inventory
      SET quantity = quantity - least(v_stock.quantity, v_remaining)
      WHERE id = v_stock.id;
      v_remaining := v_remaining - least(v_stock.quantity, v_remaining);
    END LOOP;
  END IF;

  INSERT INTO public.inventory_logs (
    action_type,
    party_id,
    party_name,
    product_id,
    product_name,
    component_type,
    quantity,
    remarks,
    created_at
  )
  VALUES (
    upper(btrim(p_action_type)),
    p_party_id,
    v_party_name,
    p_product_id,
    v_product_name,
    btrim(p_component_type),
    p_quantity,
    'By: ' || v_actor_name ||
      CASE WHEN nullif(btrim(p_remarks), '') IS NULL THEN '' ELSE ' | ' || btrim(p_remarks) END,
    now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_inventory_movement(text, uuid, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_movement(text, uuid, uuid, text, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';