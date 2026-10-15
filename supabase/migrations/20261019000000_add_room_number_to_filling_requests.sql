ALTER TABLE public.filling_requests
  ADD COLUMN IF NOT EXISTS room_number integer
  CHECK (room_number BETWEEN 1 AND 6);
