CREATE TABLE IF NOT EXISTS public.transportation_trip_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transportation_trip_details_name_lower_idx
  ON public.transportation_trip_details (lower(name));

INSERT INTO public.transportation_trip_details (name)
SELECT DISTINCT ON (lower(trim(substring(company FROM position(' — ' IN company) + 3))))
  trim(substring(company FROM position(' — ' IN company) + 3))
FROM public.transportation_rents
WHERE position(' — ' IN company) > 0
  AND length(trim(substring(company FROM position(' — ' IN company) + 3))) > 0
ORDER BY lower(trim(substring(company FROM position(' — ' IN company) + 3)))
ON CONFLICT DO NOTHING;
