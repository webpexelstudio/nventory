ALTER TABLE public.filling_production_incharges
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.filling_production_incharge_rooms (
  incharge_name text NOT NULL
    REFERENCES public.filling_production_incharges(name) ON DELETE CASCADE,
  room_number integer NOT NULL CHECK (room_number BETWEEN 1 AND 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (incharge_name, room_number)
);

ALTER TABLE public.filling_production_incharge_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.filling_production_incharge_rooms FROM anon, authenticated;
GRANT SELECT ON TABLE public.filling_production_incharge_rooms TO authenticated;

CREATE POLICY filling_production_incharge_rooms_read_authorized
  ON public.filling_production_incharge_rooms
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.filling_production_users AS report_user
      WHERE report_user.is_active
        AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
    )
  );

CREATE OR REPLACE FUNCTION public.set_filling_production_incharge_rooms(
  p_incharge_name text,
  p_room_numbers integer[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_users AS report_user
    WHERE report_user.is_active
      AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
  ) THEN
    RAISE EXCEPTION 'You are not authorized to assign production incharges to rooms.';
  END IF;

  IF p_incharge_name IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_incharges
    WHERE name = p_incharge_name
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Choose an active incharge.';
  END IF;

  IF p_room_numbers IS NULL OR EXISTS (
    SELECT 1
    FROM unnest(p_room_numbers) AS selected_room(room_number)
    WHERE selected_room.room_number IS NULL
       OR selected_room.room_number NOT BETWEEN 1 AND 6
  ) THEN
    RAISE EXCEPTION 'Choose valid room numbers from 1 to 6.';
  END IF;

  DELETE FROM public.filling_production_incharge_rooms
  WHERE incharge_name = p_incharge_name;

  INSERT INTO public.filling_production_incharge_rooms (incharge_name, room_number)
  SELECT p_incharge_name, selected_room.room_number
  FROM (
    SELECT DISTINCT room_number
    FROM unnest(p_room_numbers) AS requested(room_number)
  ) AS selected_room;
END;
$$;

REVOKE ALL ON FUNCTION public.set_filling_production_incharge_rooms(text, integer[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_filling_production_incharge_rooms(text, integer[])
  TO authenticated;

CREATE OR REPLACE FUNCTION public.rename_filling_production_incharge(
  p_old_name text,
  p_new_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.filling_production_users AS report_user
    WHERE report_user.is_active
      AND lower(report_user.email) = lower(auth.jwt() ->> 'email')
  ) THEN
    RAISE EXCEPTION 'You are not authorized to rename production incharges.';
  END IF;

  IF p_old_name IS NULL OR p_new_name IS NULL OR btrim(p_new_name) = '' THEN
    RAISE EXCEPTION 'Enter a valid incharge name.';
  END IF;

  IF p_old_name = btrim(p_new_name) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.filling_production_incharges
    WHERE name = p_old_name
      AND is_active
  ) THEN
    RAISE EXCEPTION 'The active incharge name was not found.';
  END IF;

  INSERT INTO public.filling_production_incharges (name, created_by)
  VALUES (btrim(p_new_name), auth.uid())
  ON CONFLICT (name) DO UPDATE
  SET is_active = true;

  INSERT INTO public.filling_production_incharge_rooms (incharge_name, room_number)
  SELECT btrim(p_new_name), room_number
  FROM public.filling_production_incharge_rooms
  WHERE incharge_name = p_old_name
  ON CONFLICT (incharge_name, room_number) DO NOTHING;

  UPDATE public.filling_production_incharges
  SET is_active = false
  WHERE name = p_old_name;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_filling_production_incharge(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_filling_production_incharge(text, text)
  TO authenticated;
