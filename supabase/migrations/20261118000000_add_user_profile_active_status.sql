ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

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
    AND profile.is_active
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
    AND profile.is_active
$$;

NOTIFY pgrst, 'reload schema';
