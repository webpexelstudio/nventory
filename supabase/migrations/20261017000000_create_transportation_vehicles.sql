ALTER TABLE public.transportation_rents
  ADD COLUMN IF NOT EXISTS vehicle text;

CREATE TABLE IF NOT EXISTS public.transportation_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transportation_vehicles_name_lower_idx
  ON public.transportation_vehicles (lower(name));

INSERT INTO public.transportation_vehicles (name)
SELECT DISTINCT ON (lower(trim(vehicle))) trim(vehicle)
FROM public.transportation_rents
WHERE vehicle IS NOT NULL AND length(trim(vehicle)) > 0
ORDER BY lower(trim(vehicle)), trim(vehicle)
ON CONFLICT DO NOTHING;
