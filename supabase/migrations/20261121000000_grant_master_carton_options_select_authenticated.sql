GRANT SELECT ON TABLE public.master_carton_options TO authenticated;

NOTIFY pgrst, 'reload schema';
