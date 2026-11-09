CREATE TABLE public.admin_daily_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_date date NOT NULL DEFAULT current_date,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  department text NOT NULL CHECK (length(trim(department)) BETWEEN 1 AND 120),
  floor text NOT NULL CHECK (length(trim(floor)) BETWEEN 1 AND 80),
  assigned_to text NOT NULL CHECK (length(trim(assigned_to)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  completed_by_email text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_daily_tasks_status_date_idx
  ON public.admin_daily_tasks (status, task_date DESC, created_at DESC);

CREATE TABLE public.admin_daily_task_options (
  category text NOT NULL CHECK (category IN ('department', 'floor', 'assignee')),
  value text NOT NULL CHECK (length(trim(value)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category, value)
);

ALTER TABLE public.admin_daily_task_options ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_daily_task_options FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.admin_daily_task_options TO authenticated;

CREATE POLICY admin_daily_task_options_admin_access
  ON public.admin_daily_task_options
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

ALTER TABLE public.admin_daily_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_daily_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_daily_tasks TO authenticated;

CREATE POLICY admin_daily_tasks_admin_access
  ON public.admin_daily_tasks
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

CREATE TABLE public.admin_daily_task_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.admin_daily_tasks(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'completed', 'reopened')),
  actor_id uuid,
  actor_email text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_daily_task_history_task_created_idx
  ON public.admin_daily_task_history (task_id, created_at DESC);
CREATE INDEX admin_daily_task_history_created_idx
  ON public.admin_daily_task_history (created_at DESC);

ALTER TABLE public.admin_daily_task_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_daily_task_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_daily_task_history TO authenticated;

CREATE POLICY admin_daily_task_history_admin_read
  ON public.admin_daily_task_history
  FOR SELECT
  TO authenticated
  USING (public.has_app_role('admin'));

CREATE OR REPLACE FUNCTION public.log_admin_daily_task_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'done' THEN
    v_action := 'completed';
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'pending' THEN
    v_action := 'reopened';
  ELSE
    v_action := 'updated';
  END IF;

  INSERT INTO public.admin_daily_task_history (
    task_id,
    action,
    actor_id,
    actor_email,
    details
  )
  VALUES (
    NEW.id,
    v_action,
    auth.uid(),
    coalesce(nullif(btrim(auth.jwt() ->> 'email'), ''), 'Admin'),
    jsonb_build_object(
      'title', NEW.title,
      'task_date', NEW.task_date,
      'department', NEW.department,
      'floor', NEW.floor,
      'assigned_to', NEW.assigned_to,
      'status', NEW.status,
      'previous_title', CASE WHEN TG_OP = 'UPDATE' THEN OLD.title ELSE NULL END,
      'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_daily_tasks_history_trigger
  AFTER INSERT OR UPDATE ON public.admin_daily_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.log_admin_daily_task_history();

REVOKE ALL ON FUNCTION public.log_admin_daily_task_history() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';