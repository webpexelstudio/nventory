-- Run only after applying 20261117000000_add_authenticated_app_roles.sql.
-- This assigns the existing Supabase Auth user as the first app administrator.
INSERT INTO public.user_profiles (user_id, role, party_id)
VALUES ('697f0914-3fe5-4797-9124-d379810d5957', 'admin', NULL)
ON CONFLICT (user_id)
DO UPDATE SET role = 'admin', party_id = NULL;
