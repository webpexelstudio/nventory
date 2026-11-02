CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'warehouse', 'filling', 'client')),
  party_id uuid REFERENCES public.parties(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_client_party_check
    CHECK ((role = 'client' AND party_id IS NOT NULL) OR role <> 'client')
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT profile.role
  FROM public.user_profiles AS profile
  WHERE profile.user_id = (SELECT auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.current_app_party_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT profile.party_id
  FROM public.user_profiles AS profile
  WHERE profile.user_id = (SELECT auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.has_app_role(VARIADIC allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(public.current_app_role() = ANY (allowed_roles), false)
$$;

CREATE OR REPLACE FUNCTION public.is_current_party(party_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_app_role() = 'client'
    AND btrim(party_id) = public.current_app_party_id()::text
$$;

CREATE OR REPLACE FUNCTION public.is_current_party_name(party_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_app_role() = 'client'
    AND (
      SELECT count(*) = 1 AND bool_or(party.id = public.current_app_party_id())
      FROM public.parties AS party
      WHERE lower(party.name) = lower(btrim(party_name))
    )
$$;

REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_app_party_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_app_role(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_current_party(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_current_party_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_party_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_app_role(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_party(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_party_name(text) TO authenticated;

DROP POLICY IF EXISTS user_profiles_read_self_or_admin ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_admin_manage ON public.user_profiles;

CREATE POLICY user_profiles_read_self_or_admin
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.has_app_role('admin'));

CREATE POLICY user_profiles_admin_manage
  ON public.user_profiles
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

DO $$
DECLARE
  app_table text;
  policy_row record;
  app_tables text[] := ARRAY[
    'component_type_options',
    'filling_material_returns',
    'filling_requests',
    'inventory',
    'inventory_logs',
    'master_carton_options',
    'master_carton_product_settings',
    'parties',
    'party_access',
    'product_bom',
    'production_data_sheets',
    'production_sheet_options',
    'products',
    'transportation_drivers',
    'transportation_rents',
    'transportation_trip_details',
    'transportation_vehicles'
  ];
BEGIN
  FOREACH app_table IN ARRAY app_tables
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', app_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', app_table);

    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = app_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_row.policyname, app_table);
    END LOOP;
  END LOOP;
END;
$$;

CREATE POLICY parties_read_for_app_roles
  ON public.parties
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_role('admin', 'warehouse', 'filling')
    OR id = public.current_app_party_id()
  );
CREATE POLICY parties_admin_manage
  ON public.parties
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE POLICY products_read_for_app_roles
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_role('admin', 'warehouse', 'filling')
    OR party_id::text = public.current_app_party_id()::text
  );
CREATE POLICY products_admin_manage
  ON public.products
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE POLICY product_bom_read_for_app_roles
  ON public.product_bom
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'filling'));
CREATE POLICY product_bom_admin_manage
  ON public.product_bom
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE POLICY inventory_read_for_app_roles
  ON public.inventory
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_role('admin', 'warehouse', 'filling')
    OR public.is_current_party(party_id)
    OR public.is_current_party_name(party_name)
  );
CREATE POLICY inventory_internal_manage
  ON public.inventory
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse'))
  WITH CHECK (public.has_app_role('admin', 'warehouse'));

CREATE POLICY inventory_logs_read_for_app_roles
  ON public.inventory_logs
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_role('admin', 'warehouse', 'filling')
    OR public.is_current_party_name(party_name)
  );
CREATE POLICY inventory_logs_internal_manage
  ON public.inventory_logs
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse'))
  WITH CHECK (public.has_app_role('admin', 'warehouse'));

CREATE POLICY filling_requests_internal_read
  ON public.filling_requests
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'filling'));
CREATE POLICY filling_requests_filling_insert
  ON public.filling_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_app_role('admin', 'filling'));
CREATE POLICY filling_requests_internal_update
  ON public.filling_requests
  FOR UPDATE
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'filling'))
  WITH CHECK (public.has_app_role('admin', 'warehouse', 'filling'));
CREATE POLICY filling_requests_admin_delete
  ON public.filling_requests
  FOR DELETE
  TO authenticated
  USING (public.has_app_role('admin'));

CREATE POLICY filling_material_returns_read_for_roles
  ON public.filling_material_returns
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_role('admin', 'warehouse', 'filling')
    OR party_id = public.current_app_party_id()
  );
CREATE POLICY filling_material_returns_filling_insert
  ON public.filling_material_returns
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_app_role('admin', 'filling'));
CREATE POLICY filling_material_returns_internal_update
  ON public.filling_material_returns
  FOR UPDATE
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse'))
  WITH CHECK (public.has_app_role('admin', 'warehouse'));
CREATE POLICY filling_material_returns_admin_delete
  ON public.filling_material_returns
  FOR DELETE
  TO authenticated
  USING (public.has_app_role('admin'));

CREATE POLICY component_type_options_read_internal
  ON public.component_type_options
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'filling'));
CREATE POLICY component_type_options_admin_manage
  ON public.component_type_options
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE POLICY master_carton_options_read_internal
  ON public.master_carton_options
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'filling'));
CREATE POLICY master_carton_options_admin_manage
  ON public.master_carton_options
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE POLICY master_carton_product_settings_read_internal
  ON public.master_carton_product_settings
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'filling'));
CREATE POLICY master_carton_product_settings_admin_manage
  ON public.master_carton_product_settings
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE POLICY production_data_sheets_filling_read
  ON public.production_data_sheets
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'filling'));
CREATE POLICY production_data_sheets_filling_manage
  ON public.production_data_sheets
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin', 'filling'))
  WITH CHECK (public.has_app_role('admin', 'filling'));

CREATE POLICY production_sheet_options_filling_read
  ON public.production_sheet_options
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'filling'));
CREATE POLICY production_sheet_options_filling_manage
  ON public.production_sheet_options
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin', 'filling'))
  WITH CHECK (public.has_app_role('admin', 'filling'));

CREATE POLICY transportation_rents_internal_read
  ON public.transportation_rents
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse'));
CREATE POLICY transportation_rents_warehouse_insert
  ON public.transportation_rents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_app_role('admin', 'warehouse'));
CREATE POLICY transportation_rents_warehouse_update
  ON public.transportation_rents
  FOR UPDATE
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse'))
  WITH CHECK (public.has_app_role('admin', 'warehouse'));
CREATE POLICY transportation_rents_admin_delete
  ON public.transportation_rents
  FOR DELETE
  TO authenticated
  USING (public.has_app_role('admin'));

CREATE POLICY transportation_drivers_internal_read
  ON public.transportation_drivers
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse'));
CREATE POLICY transportation_drivers_admin_manage
  ON public.transportation_drivers
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE POLICY transportation_trip_details_internal_read
  ON public.transportation_trip_details
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse'));
CREATE POLICY transportation_trip_details_admin_manage
  ON public.transportation_trip_details
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE POLICY transportation_vehicles_internal_read
  ON public.transportation_vehicles
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse'));
CREATE POLICY transportation_vehicles_admin_manage
  ON public.transportation_vehicles
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE OR REPLACE FUNCTION public.receive_filling_material_return(p_return_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
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
  IF NOT public.has_app_role('admin', 'warehouse') THEN
    RAISE EXCEPTION 'Only warehouse staff can receive returned materials.';
  END IF;

  SELECT *
  INTO material_return
  FROM public.filling_material_returns
  WHERE id::text = p_return_id::text
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return or damage record was not found.';
  END IF;

  IF material_return.status <> 'PENDING_WAREHOUSE' THEN
    RAISE EXCEPTION 'This record has already been received by the warehouse.';
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

REVOKE ALL ON FUNCTION public.receive_filling_material_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_filling_material_return(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload schema';
