CREATE TABLE IF NOT EXISTS public.party_product_mrps (
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  mrp numeric(12, 2) NOT NULL CHECK (mrp >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, product_id)
);

ALTER TABLE public.party_product_mrps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.party_product_mrps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.party_product_mrps TO authenticated;

CREATE POLICY party_product_mrps_read_internal
  ON public.party_product_mrps
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin', 'warehouse', 'filling'));

CREATE POLICY party_product_mrps_filling_manage
  ON public.party_product_mrps
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin', 'filling'))
  WITH CHECK (public.has_app_role('admin', 'filling'));

NOTIFY pgrst, 'reload schema';
