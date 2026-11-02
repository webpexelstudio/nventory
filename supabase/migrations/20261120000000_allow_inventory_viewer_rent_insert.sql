CREATE POLICY transportation_rents_inventory_viewer_insert
  ON public.transportation_rents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_app_role('inventory_viewer'));

NOTIFY pgrst, 'reload schema';
