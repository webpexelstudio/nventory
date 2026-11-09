ALTER TABLE public.admin_daily_tasks
  ADD COLUMN IF NOT EXISTS repeat_frequency text NOT NULL DEFAULT 'once'
  CHECK (repeat_frequency IN ('once', 'daily', 'weekly', 'monthly'));

ALTER TABLE public.admin_daily_tasks
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE IF NOT EXISTS public.admin_daily_task_occurrences (
  task_id uuid NOT NULL REFERENCES public.admin_daily_tasks(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'missed')),
  completed_by_email text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS admin_daily_task_occurrences_date_status_idx
  ON public.admin_daily_task_occurrences (occurrence_date, status);

ALTER TABLE public.admin_daily_task_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_daily_task_occurrences FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.admin_daily_task_occurrences TO authenticated;

DROP POLICY IF EXISTS admin_daily_task_occurrences_admin_access
  ON public.admin_daily_task_occurrences;

CREATE POLICY admin_daily_task_occurrences_admin_access
  ON public.admin_daily_task_occurrences
  FOR ALL
  TO authenticated
  USING (public.has_app_role('admin'))
  WITH CHECK (public.has_app_role('admin'));

ALTER TABLE public.admin_daily_task_history
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'updated';

ALTER TABLE public.admin_daily_task_history
  DROP CONSTRAINT IF EXISTS admin_daily_task_history_action_check;

ALTER TABLE public.admin_daily_task_history
  ADD CONSTRAINT admin_daily_task_history_action_check
  CHECK (action IN ('created', 'updated', 'completed', 'reopened', 'missed', 'deleted'));

CREATE OR REPLACE FUNCTION public.log_admin_daily_task_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
  ELSIF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    v_action := 'deleted';
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
      'repeat_frequency', NEW.repeat_frequency,
      'status', NEW.status,
      'previous_title', CASE WHEN TG_OP = 'UPDATE' THEN OLD.title ELSE NULL END,
      'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END
    )
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_admin_daily_task_occurrence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_action text;
  v_actor_email text;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'done' THEN
    v_action := 'completed';
  ELSIF NEW.status = 'missed' THEN
    v_action := 'missed';
  ELSE
    v_action := 'reopened';
  END IF;

  v_actor_email := CASE
    WHEN NEW.status = 'missed' THEN 'System'
    ELSE coalesce(nullif(btrim(auth.jwt() ->> 'email'), ''), 'Admin')
  END;

  INSERT INTO public.admin_daily_task_history (
    task_id,
    action,
    actor_id,
    actor_email,
    details
  )
  SELECT
    task.id,
    v_action,
    CASE WHEN NEW.status = 'missed' THEN NULL ELSE auth.uid() END,
    v_actor_email,
    jsonb_build_object(
      'title', task.title,
      'task_date', NEW.occurrence_date,
      'occurrence_date', NEW.occurrence_date,
      'repeat_frequency', task.repeat_frequency,
      'department', task.department,
      'floor', task.floor,
      'assigned_to', task.assigned_to,
      'status', NEW.status
    )
  FROM public.admin_daily_tasks AS task
  WHERE task.id = NEW.task_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_daily_task_occurrence_history_trigger
  ON public.admin_daily_task_occurrences;

CREATE TRIGGER admin_daily_task_occurrence_history_trigger
  AFTER UPDATE OF status ON public.admin_daily_task_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION public.log_admin_daily_task_occurrence();

REVOKE ALL ON FUNCTION public.log_admin_daily_task_occurrence() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_admin_daily_task_occurrences(p_today date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_app_role('admin') THEN
    RAISE EXCEPTION 'Admin access required to sync daily tasks'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.admin_daily_task_occurrences (
    task_id,
    occurrence_date,
    status,
    completed_by_email,
    completed_at
  )
  SELECT
    task.id,
    due.occurrence_date,
    CASE WHEN task.repeat_frequency = 'once' THEN task.status ELSE 'pending' END,
    CASE WHEN task.repeat_frequency = 'once' THEN task.completed_by_email ELSE NULL END,
    CASE WHEN task.repeat_frequency = 'once' THEN task.completed_at ELSE NULL END
  FROM public.admin_daily_tasks AS task
  CROSS JOIN LATERAL (
    SELECT task.task_date AS occurrence_date
    WHERE task.repeat_frequency = 'once'

    UNION ALL

    SELECT series.day::date
    FROM generate_series(
      task.task_date::timestamp,
      p_today::timestamp,
      interval '1 day'
    ) AS series(day)
    WHERE task.repeat_frequency = 'daily'

    UNION ALL

    SELECT series.day::date
    FROM generate_series(
      (task.task_date + ((8 - extract(isodow FROM task.task_date)::integer) % 7))::timestamp,
      p_today::timestamp,
      interval '7 days'
    ) AS series(day)
    WHERE task.repeat_frequency = 'weekly'

    UNION ALL

    SELECT month_start.day::date
    FROM generate_series(
      date_trunc('month', task.task_date)::timestamp,
      date_trunc('month', p_today)::timestamp,
      interval '1 month'
    ) AS month_start(day)
    WHERE task.repeat_frequency = 'monthly'
      AND month_start.day::date >= task.task_date
  ) AS due
  WHERE task.archived_at IS NULL
    AND due.occurrence_date <= p_today
  ON CONFLICT (task_id, occurrence_date) DO NOTHING;

  UPDATE public.admin_daily_task_occurrences
  SET status = 'missed'
  WHERE status = 'pending'
    AND occurrence_date < p_today;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_admin_daily_task_occurrences(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_admin_daily_task_occurrences(date) TO authenticated;

NOTIFY pgrst, 'reload schema';
