ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'warehouse', 'inventory_viewer', 'filling', 'client'));

DROP POLICY IF EXISTS parties_read_for_app_roles ON public.parties;
CREATE POLICY parties_read_for_app_roles
  ON public.parties
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_role('admin', 'warehouse', 'inventory_viewer', 'filling')
    OR id = public.current_app_party_id()
  );

DROP POLICY IF EXISTS products_read_for_app_roles ON public.products;
CREATE POLICY products_read_for_app_roles
  ON public.products
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_role('admin', 'warehouse', 'inventory_viewer', 'filling')
    OR party_id::text = public.current_app_party_id()::text
  );

DROP POLICY IF EXISTS product_bom_read_for_app_roles ON public.product_bom;
CREATE POLICY product_bom_read_for_app_roles
  ON public.product_bom
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'inventory_viewer', 'filling'));

DROP POLICY IF EXISTS inventory_read_for_app_roles ON public.inventory;
CREATE POLICY inventory_read_for_app_roles
  ON public.inventory
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_role('admin', 'warehouse', 'inventory_viewer', 'filling')
    OR public.is_current_party(party_id)
    OR public.is_current_party_name(party_name)
  );

DROP POLICY IF EXISTS inventory_logs_read_for_app_roles ON public.inventory_logs;
CREATE POLICY inventory_logs_read_for_app_roles
  ON public.inventory_logs
  FOR SELECT
  TO authenticated
  USING (
    public.has_app_role('admin', 'warehouse', 'inventory_viewer', 'filling')
    OR public.is_current_party_name(party_name)
  );

DROP POLICY IF EXISTS transportation_rents_internal_read ON public.transportation_rents;
CREATE POLICY transportation_rents_internal_read
  ON public.transportation_rents
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'inventory_viewer'));

DROP POLICY IF EXISTS transportation_drivers_internal_read ON public.transportation_drivers;
CREATE POLICY transportation_drivers_internal_read
  ON public.transportation_drivers
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'inventory_viewer'));

DROP POLICY IF EXISTS transportation_trip_details_internal_read ON public.transportation_trip_details;
CREATE POLICY transportation_trip_details_internal_read
  ON public.transportation_trip_details
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'inventory_viewer'));

DROP POLICY IF EXISTS transportation_vehicles_internal_read ON public.transportation_vehicles;
CREATE POLICY transportation_vehicles_internal_read
  ON public.transportation_vehicles
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'inventory_viewer'));

NOTIFY pgrst, 'reload schema';
