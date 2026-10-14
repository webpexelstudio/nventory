CREATE TABLE IF NOT EXISTS public.transportation_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transportation_drivers_name_lower_idx
  ON public.transportation_drivers (lower(name));

INSERT INTO public.transportation_drivers (name)
SELECT DISTINCT ON (lower(trim(driver))) trim(driver)
FROM public.transportation_rents
WHERE length(trim(driver)) > 0
ORDER BY lower(trim(driver)), trim(driver)
ON CONFLICT DO NOTHING;
