DROP TRIGGER IF EXISTS attach_madam_salma_manual_reports
  ON public.filling_requests;

NOTIFY pgrst, 'reload schema';
