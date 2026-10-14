CREATE TABLE IF NOT EXISTS public.transportation_rents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver text NOT NULL CHECK (length(trim(driver)) > 0),
  rent_date date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  company text NOT NULL CHECK (length(trim(company)) > 0),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transportation_rents_paid_at_consistent
    CHECK ((payment_status = 'pending' AND paid_at IS NULL) OR (payment_status = 'paid' AND paid_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS transportation_rents_status_date_idx
  ON public.transportation_rents (payment_status, rent_date DESC);
