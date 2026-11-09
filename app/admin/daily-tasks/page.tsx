"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  History,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  UserRound,
} from "lucide-react";
import { useAppAuth } from "@/components/AuthGate";
import { supabase } from "@/lib/supabase";

type TaskStatus = "pending" | "done";
type OccurrenceStatus = TaskStatus | "missed";
type TaskRepeatFrequency = "once" | "daily" | "weekly" | "monthly";
type TaskView = "pending" | "done" | "history";
type TaskOptionCategory = "department" | "floor" | "assignee";

interface TaskOption {
  category: TaskOptionCategory;
  value: string;
}

interface DailyTask {
  id: string;
  task_date: string;
  title: string;
  department: string;
  floor: string;
  assigned_to: string;
  status: OccurrenceStatus;
  repeat_frequency: TaskRepeatFrequency;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completed_by_email: string | null;
}

interface TaskHistoryEntry {
  id: string;
  task_id: string;
  action: "created" | "updated" | "completed" | "reopened" | "missed" | "deleted";
  actor_email: string;
  details: {
    title?: string;
    task_date?: string;
    occurrence_date?: string;
    repeat_frequency?: TaskRepeatFrequency;
    department?: string;
    floor?: string;
    assigned_to?: string;
    previous_title?: string | null;
    previous_status?: string | null;
  };
  created_at: string;
}

interface TaskDraft {
  title: string;
  taskDate: string;
  department: string;
  floor: string;
  assignedTo: string;
  repeatFrequency: TaskRepeatFrequency;
}

interface DailyTaskOccurrence {
  task_id: string;
  occurrence_date: string;
  status: OccurrenceStatus;
  completed_at: string | null;
  completed_by_email: string | null;
}

const repeatFrequencyLabels: Record<TaskRepeatFrequency, string> = {
  once: "One time",
  daily: "Daily",
  weekly: "Every Monday",
  monthly: "1st of every month",
};

function isTaskRepeatFrequency(value: string): value is TaskRepeatFrequency {
  return value === "once" || value === "daily" || value === "weekly" || value === "monthly";
}

const getLocalDate = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const formatTaskDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const formatTimestamp = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function TaskOptionSelect({
  id,
  label,
  value,
  options,
  placeholder,
  onChange,
  onAddOption,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
  onAddOption: (value: string) => Promise<string | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const saveOption = async () => {
    setSaving(true);
    setAddError("");
    const trimmedValue = newValue.trim();
    const saveError = await onAddOption(trimmedValue);
    if (!saveError) {
      onChange(trimmedValue);
      setNewValue("");
      setAdding(false);
    } else {
      setAddError(saveError);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-300">{label}</label>
      <div className="flex gap-2">
        <select
          id={id}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-[#0b0f19] px-3 py-2.5 text-sm text-white"
        >
          <option value="">{placeholder}</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button
          type="button"
          onClick={() => {
            setAdding((current) => !current);
            setAddError("");
          }}
          title={`Add ${label.toLowerCase()} option`}
          aria-label={`Add ${label.toLowerCase()} option`}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <Plus size={16} />
        </button>
      </div>
      {adding && (
        <div className="flex gap-2">
          <input
            autoFocus
            maxLength={160}
            value={newValue}
            onChange={(event) => setNewValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (newValue.trim()) void saveOption();
              }
            }}
            placeholder={`New ${label.toLowerCase()}`}
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-[#0b0f19] px-3 py-2 text-sm text-white placeholder:text-slate-600"
          />
          <button
            type="button"
            onClick={() => void saveOption()}
            disabled={!newValue.trim() || saving}
            title="Save option"
            aria-label="Save option"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-emerald-700 text-white disabled:opacity-50"
          >
            {saving ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
          </button>
        </div>
      )}
      {addError && <p role="alert" className="text-[11px] text-rose-300">{addError}</p>}
    </div>
  );
}

export default function DailyTasksPage() {
  const { profile, user } = useAppAuth();
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [taskOptions, setTaskOptions] = useState<TaskOption[]>([]);
  const [activeView, setActiveView] = useState<TaskView>("pending");
  const [draft, setDraft] = useState<TaskDraft>(() => ({
    title: "",
    taskDate: getLocalDate(),
    department: "",
    floor: "",
    assignedTo: "",
    repeatFrequency: "once",
  }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const taskRequestId = useRef(0);
  const [today, setToday] = useState(getLocalDate);
  const previousToday = useRef(today);

  const actorEmail = user?.email || "Admin";

  const fetchTaskData = useCallback(async (requestId: number) => {
    const { error: syncError } = await supabase.rpc("sync_admin_daily_task_occurrences", {
      p_today: today,
    });
    if (syncError) {
      const migrationHint = ["PGRST202", "42883"].includes(syncError.code ?? "")
        ? " Apply supabase/migrations/20261128000000_create_admin_daily_tasks.sql, supabase/migrations/20261129000000_fix_admin_daily_task_option_value.sql, and supabase/migrations/20261130000000_add_recurring_admin_daily_tasks.sql to the configured Supabase project."
        : "";
      throw new Error(`Could not prepare today's task list: ${syncError.message}.${migrationHint}`);
    }

    const [taskResult, occurrenceResult, historyResult, optionsResult] = await Promise.all([
      supabase.from("admin_daily_tasks").select("*").is("archived_at", null).order("task_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("admin_daily_task_occurrences").select("*").eq("occurrence_date", today),
      supabase.from("admin_daily_task_history").select("*").order("created_at", { ascending: false }),
      supabase.from("admin_daily_task_options").select("category, value").order("value"),
    ]);

    const requiredError = taskResult.error ?? occurrenceResult.error;
    if (requiredError) {
      const migrationHint = ["42P01", "PGRST205"].includes(requiredError.code ?? "")
        ? " Apply supabase/migrations/20261128000000_create_admin_daily_tasks.sql, supabase/migrations/20261129000000_fix_admin_daily_task_option_value.sql, and supabase/migrations/20261130000000_add_recurring_admin_daily_tasks.sql to the configured Supabase project."
        : "";
      throw new Error(`Could not load today's tasks: ${requiredError.message}.${migrationHint}`);
    }

    const tasksById = new Map(
      ((taskResult.data ?? []) as DailyTask[]).map((task) => [task.id, task])
    );
    const todaysTasks = ((occurrenceResult.data ?? []) as DailyTaskOccurrence[])
      .flatMap((occurrence) => {
        const task = tasksById.get(occurrence.task_id);
        return task ? [{
          ...task,
          task_date: occurrence.occurrence_date,
          status: occurrence.status,
          completed_at: occurrence.completed_at,
          completed_by_email: occurrence.completed_by_email,
        }] : [];
      });

    return {
      requestId,
      tasks: todaysTasks,
      history: historyResult.error ? null : (historyResult.data ?? []) as TaskHistoryEntry[],
      options: optionsResult.error
        ? null
        : (optionsResult.data ?? []).filter(
            (option): option is TaskOption =>
              typeof option.value === "string" && option.value.trim().length > 0
          ),
      errors: [
        historyResult.error && `Could not load task history: ${historyResult.error.message}`,
        optionsResult.error && `Could not load task options: ${optionsResult.error.message}`,
      ].filter((message): message is string => Boolean(message)),
    };
  }, [today]);

  const loadTasks = useCallback(async () => {
    const requestId = ++taskRequestId.current;
    try {
      const data = await fetchTaskData(requestId);
      if (data.requestId !== taskRequestId.current) return;
      setTasks(data.tasks);
      if (data.history) setHistory(data.history);
      if (data.options) setTaskOptions(data.options);
      setError(data.errors.length > 0 ? data.errors.join(" ") : null);
    } catch (requestError: unknown) {
      if (requestId === taskRequestId.current) {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      }
    }
  }, [fetchTaskData]);

  useEffect(() => {
    const dateTimer = window.setInterval(() => {
      const currentDate = getLocalDate();
      setToday((previousDate) => previousDate === currentDate ? previousDate : currentDate);
    }, 60_000);
    return () => window.clearInterval(dateTimer);
  }, []);

  useEffect(() => {
    if (previousToday.current === today) return;
    const previousDate = previousToday.current;
    previousToday.current = today;
    setDraft((current) => current.taskDate === previousDate
      ? { ...current, taskDate: today }
      : current);
  }, [today]);

  useEffect(() => {
    let active = true;
    const requestId = ++taskRequestId.current;
    void fetchTaskData(requestId)
      .then((data) => {
        if (!active || data.requestId !== taskRequestId.current) return;
        setTasks(data.tasks);
        if (data.history) setHistory(data.history);
        if (data.options) setTaskOptions(data.options);
        setError(data.errors.length > 0 ? data.errors.join(" ") : null);
      })
      .catch((requestError: unknown) => {
        if (active && requestId === taskRequestId.current) {
          setError(requestError instanceof Error ? requestError.message : String(requestError));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchTaskData]);

  const pendingTasks = useMemo(() => tasks.filter((task) => task.status === "pending"), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((task) => task.status === "done"), [tasks]);
  const visibleTasks = activeView === "pending" ? pendingTasks : doneTasks;
  const missedCount = history.filter((entry) => entry.action === "missed").length;

  const handleCreateTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    const taskValues = {
      task_date: draft.taskDate,
      title: draft.title.trim(),
      department: draft.department.trim(),
      floor: draft.floor.trim(),
      assigned_to: draft.assignedTo.trim(),
      repeat_frequency: draft.repeatFrequency,
    };
    const result = editingTaskId
      ? await supabase
          .from("admin_daily_tasks")
          .update({ ...taskValues, updated_at: new Date().toISOString() })
          .eq("id", editingTaskId)
          .is("archived_at", null)
          .select("id")
          .single()
      : await supabase
          .from("admin_daily_tasks")
          .insert({ ...taskValues, status: "pending" });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    const wasEditing = Boolean(editingTaskId);
    setEditingTaskId(null);
    setDraft((current) => ({
      ...current,
      title: "",
      department: "",
      floor: "",
      assignedTo: "",
      repeatFrequency: "once",
    }));
    setNotice(wasEditing ? "Task updated." : "Task added to the pending list.");
    setActiveView("pending");
    await loadTasks();
    setSaving(false);
  };

  const handleEditTask = (task: DailyTask) => {
    setEditingTaskId(task.id);
    setDraft({
      title: task.title,
      taskDate: task.task_date,
      department: task.department,
      floor: task.floor,
      assignedTo: task.assigned_to,
      repeatFrequency: task.repeat_frequency,
    });
    setError(null);
    setNotice(null);
  };

  const handleDeleteTask = async (task: DailyTask) => {
    if (!window.confirm(`Remove "${task.title}" from future task lists? Its history will be kept.`)) return;

    setBusyTaskId(task.id);
    setError(null);
    setNotice(null);
    const { error: archiveError } = await supabase
      .from("admin_daily_tasks")
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", task.id)
      .is("archived_at", null)
      .select("id")
      .single();

    if (archiveError) {
      setError(archiveError.message);
    } else {
      if (editingTaskId === task.id) {
        setEditingTaskId(null);
        setDraft({
          title: "",
          taskDate: today,
          department: "",
          floor: "",
          assignedTo: "",
          repeatFrequency: "once",
        });
      }
      setNotice("Task removed. Its history has been kept.");
      await loadTasks();
    }
    setBusyTaskId(null);
  };

  const cancelEditing = () => {
    setEditingTaskId(null);
    setDraft({
      title: "",
      taskDate: today,
      department: "",
      floor: "",
      assignedTo: "",
      repeatFrequency: "once",
    });
    setError(null);
  };

  const handleStatusChange = async (task: DailyTask, status: TaskStatus) => {
    setBusyTaskId(task.id);
    setError(null);
    setNotice(null);
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("admin_daily_task_occurrences")
      .update({
        status,
        completed_at: status === "done" ? now : null,
        completed_by_email: status === "done" ? actorEmail : null,
      })
      .eq("task_id", task.id)
      .eq("occurrence_date", task.task_date)
      .select("task_id")
      .single();

    if (updateError) {
      setError(updateError.message);
    } else {
      setNotice(status === "done" ? "Task marked done." : "Task moved back to pending.");
      await loadTasks();
    }
    setBusyTaskId(null);
  };

  const handleAddOption = async (category: TaskOptionCategory, value: string) => {
    if (!value) return "Enter an option name.";
    if (taskOptions.some((option) => option.category === category && option.value.toLowerCase() === value.toLowerCase())) {
      return "This option already exists.";
    }

    const { error: insertError } = await supabase.from("admin_daily_task_options").insert({ category, value });
    if (insertError) return `${insertError.message}${insertError.code ? ` (${insertError.code})` : ""}`;
    setTaskOptions((current) => [...current, { category, value }].sort((left, right) => left.value.localeCompare(right.value)));
    return null;
  };

  const getOptions = (category: TaskOptionCategory) =>
    taskOptions.filter((option) => option.category === category).map((option) => option.value);

  if (!profile) {
    return <main className="min-h-screen bg-[#0b0f19] p-8 text-slate-400">Loading admin access...</main>;
  }

  if (profile.role !== "admin") {
    return <main className="min-h-screen bg-[#0b0f19] p-8 text-rose-300">Admin access required.</main>;
  }

  return (
    <main className="min-h-screen bg-[#0b0f19] px-4 py-5 text-slate-100 sm:px-7 sm:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/admin" className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white">
              <ArrowLeft size={15} aria-hidden="true" /> Admin Dashboard
            </Link>
            <p className="text-[11px] font-bold uppercase text-amber-300">Daily operations</p>
            <h1 className="mt-1 text-2xl font-extrabold text-white sm:text-3xl">Daily Task Tracker</h1>
            <p className="mt-1 text-sm text-slate-400">Pending work, assigned people, and completion history.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void loadTasks();
            }}
            disabled={loading}
            title="Refresh tasks"
            aria-label="Refresh tasks"
            className="inline-flex h-10 w-10 items-center justify-center self-start rounded-md border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-50 sm:self-auto"
          >
            {loading ? <LoaderCircle size={17} className="animate-spin" /> : <RefreshCw size={17} />}
          </button>
        </header>

        <section aria-label="Task summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-md border border-amber-500/30 bg-amber-950/25 p-4">
            <p className="text-xs font-semibold uppercase text-amber-200">Pending</p>
            <p className="mt-2 text-3xl font-bold text-amber-100">{pendingTasks.length}</p>
          </div>
          <div className="rounded-md border border-rose-500/30 bg-rose-950/20 p-4">
            <p className="text-xs font-semibold uppercase text-rose-200">Missed days</p>
            <p className="mt-2 text-3xl font-bold text-rose-100">{missedCount}</p>
          </div>
          <div className="rounded-md border border-emerald-500/30 bg-emerald-950/20 p-4">
            <p className="text-xs font-semibold uppercase text-emerald-200">Done</p>
            <p className="mt-2 text-3xl font-bold text-emerald-100">{doneTasks.length}</p>
          </div>
          <div className="rounded-md border border-sky-500/30 bg-sky-950/20 p-4">
            <p className="text-xs font-semibold uppercase text-sky-200">Activity Records</p>
            <p className="mt-2 text-3xl font-bold text-sky-100">{history.length}</p>
          </div>
        </section>

        {(error || notice) && (
          <div className="space-y-2">
            {error && (
              <div role="alert" className="rounded-md border border-rose-700 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            )}
            {notice && (
              <div role="status" className="rounded-md border border-emerald-700 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
                {notice}
              </div>
            )}
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <section className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-md border border-slate-800 bg-slate-900 p-1" role="tablist" aria-label="Task views">
                {([
                  ["pending", `Pending (${pendingTasks.length})`],
                  ["done", `Done (${doneTasks.length})`],
                  ["history", `History (${history.length})`],
                ] as const).map(([view, label]) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    aria-selected={activeView === view}
                    onClick={() => setActiveView(view)}
                    className={`rounded px-3 py-2 text-xs font-bold ${activeView === view ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-800 p-8 text-sm text-slate-400">
                <LoaderCircle size={17} className="animate-spin" /> Loading task records...
              </div>
            ) : activeView === "history" ? (
              <div className="divide-y divide-slate-800 rounded-md border border-slate-800 bg-[#101722]">
                {history.length === 0 ? (
                  <p className="p-8 text-sm text-slate-400">No activity has been recorded yet.</p>
                ) : history.map((entry) => (
                  <article key={entry.id} className="flex gap-3 p-4">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${entry.action === "completed" ? "bg-emerald-500/15 text-emerald-300" : entry.action === "deleted" || entry.action === "missed" ? "bg-rose-500/15 text-rose-300" : entry.action === "reopened" ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"}`}>
                      {entry.action === "completed" ? <Check size={16} /> : entry.action === "deleted" ? <Trash2 size={15} /> : entry.action === "missed" ? <Clock3 size={15} /> : entry.action === "reopened" ? <RotateCcw size={15} /> : entry.action === "created" ? <Plus size={16} /> : <History size={15} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold text-white">{entry.details.title || "Task"}</p>
                        <time className="text-[11px] text-slate-500">{formatTimestamp(entry.created_at)}</time>
                      </div>
                      <p className="mt-1 text-xs text-slate-300">
                        {entry.action === "created" ? "Added" : entry.action === "completed" ? "Marked done" : entry.action === "deleted" ? "Removed (history kept)" : entry.action === "missed" ? "Missed" : entry.action === "reopened" ? "Moved back to pending" : "Updated"}
                        {entry.details.assigned_to ? ` · Assigned to ${entry.details.assigned_to}` : ""}
                        {entry.details.repeat_frequency && entry.details.repeat_frequency !== "once" ? ` · ${repeatFrequencyLabels[entry.details.repeat_frequency]}` : ""}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span>{entry.details.department || "No department"}</span>
                        <span>Floor {entry.details.floor || "—"}</span>
                        {(entry.details.occurrence_date || entry.details.task_date) && <span>{formatTaskDate(entry.details.occurrence_date || entry.details.task_date || "")}</span>}
                        <span>By {entry.actor_email}</span>
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            ) : visibleTasks.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-700 p-8 text-center">
                <p className="text-sm font-semibold text-slate-200">{activeView === "pending" ? "No pending work" : "No completed tasks yet"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {activeView === "pending"
                    ? "Today's one-time and recurring tasks will appear here. Weekly tasks are due Monday; monthly tasks are due on the 1st."
                    : "Tasks completed today will remain available here. Each day's completion or missed occurrence is recorded in History."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleTasks.map((task) => {
                  const taskBusy = busyTaskId === task.id;
                  return (
                    <article key={`${task.id}-${task.task_date}`} className={`rounded-md border border-l-4 bg-[#101722] p-4 ${task.status === "pending" ? "border-amber-700/40 border-l-amber-400" : "border-emerald-800/50 border-l-emerald-400"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="break-words text-sm font-bold text-white">{task.title}</h2>
                            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${task.status === "pending" ? "bg-amber-500/15 text-amber-200" : "bg-emerald-500/15 text-emerald-200"}`}>
                              {task.status}
                            </span>
                            <span className="rounded bg-slate-700/60 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                              {repeatFrequencyLabels[task.repeat_frequency]}
                            </span>
                          </div>
                          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                            <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} />{formatTaskDate(task.task_date)}</span>
                            <span className="inline-flex items-center gap-1.5"><Building2 size={13} />{task.department}</span>
                            <span className="inline-flex items-center gap-1.5"><MapPin size={13} />Floor {task.floor}</span>
                            <span className="inline-flex items-center gap-1.5"><UserRound size={13} />{task.assigned_to}</span>
                          </p>
                          {task.status === "done" && task.completed_at && (
                            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-emerald-300">
                              <Clock3 size={12} /> Done {formatTimestamp(task.completed_at)}{task.completed_by_email ? ` by ${task.completed_by_email}` : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleStatusChange(task, task.status === "pending" ? "done" : "pending")}
                            disabled={taskBusy}
                            className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-bold disabled:opacity-50 ${task.status === "pending" ? "bg-emerald-700 text-white hover:bg-emerald-600" : "border border-slate-700 text-slate-300 hover:bg-slate-800"}`}
                          >
                            {taskBusy ? <LoaderCircle size={14} className="animate-spin" /> : task.status === "pending" ? <Check size={14} /> : <RotateCcw size={14} />}
                            {task.status === "pending" ? "Mark done" : "Reopen"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditTask(task)}
                            disabled={taskBusy || saving}
                            aria-label={`Edit ${task.title}`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteTask(task)}
                            disabled={taskBusy || saving}
                            aria-label={`Delete ${task.title}`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-900/70 text-rose-300 hover:bg-rose-950/60 disabled:opacity-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="rounded-md border border-slate-800 bg-[#101722] p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">{editingTaskId ? <Pencil size={16} /> : <Plus size={17} />}</span>
              <div>
                <h2 className="text-sm font-bold text-white">{editingTaskId ? "Edit task" : "Add a task"}</h2>
                <p className="text-[11px] text-slate-500">Recorded by {actorEmail}</p>
              </div>
            </div>
            <form onSubmit={handleCreateTask} className="space-y-3">
              <label className="block space-y-1.5 text-xs font-semibold text-slate-300">
                Task
                <textarea
                  required
                  maxLength={500}
                  rows={3}
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="What needs to be done?"
                  className="w-full resize-y rounded-md border border-slate-700 bg-[#0b0f19] px-3 py-2.5 text-sm text-white placeholder:text-slate-600"
                />
              </label>
              <label className="block space-y-1.5 text-xs font-semibold text-slate-300">
                Repeat
                <select
                  value={draft.repeatFrequency}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isTaskRepeatFrequency(value)) {
                      setDraft((current) => ({ ...current, repeatFrequency: value }));
                    }
                  }}
                  className="w-full rounded-md border border-slate-700 bg-[#0b0f19] px-3 py-2.5 text-sm text-white"
                >
                  <option value="once">One time</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every Monday</option>
                  <option value="monthly">1st of every month</option>
                </select>
              </label>
              <label className="block space-y-1.5 text-xs font-semibold text-slate-300">
                Task date
                <input
                  type="date"
                  required
                  value={draft.taskDate}
                  onChange={(event) => setDraft((current) => ({ ...current, taskDate: event.target.value }))}
                  className="w-full rounded-md border border-slate-700 bg-[#0b0f19] px-3 py-2.5 text-sm text-white"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <TaskOptionSelect
                  id="task-department"
                  label="Department"
                  value={draft.department}
                  options={getOptions("department")}
                  placeholder="Select department"
                  onChange={(department) => setDraft((current) => ({ ...current, department }))}
                  onAddOption={(value) => handleAddOption("department", value)}
                />
                <TaskOptionSelect
                  id="task-floor"
                  label="Floor"
                  value={draft.floor}
                  options={getOptions("floor")}
                  placeholder="Select floor"
                  onChange={(floor) => setDraft((current) => ({ ...current, floor }))}
                  onAddOption={(value) => handleAddOption("floor", value)}
                />
              </div>
              <TaskOptionSelect
                id="task-assignee"
                label="Assigned to"
                value={draft.assignedTo}
                options={getOptions("assignee")}
                placeholder="Select a person"
                onChange={(assignedTo) => setDraft((current) => ({ ...current, assignedTo }))}
                onAddOption={(value) => handleAddOption("assignee", value)}
              />
              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <LoaderCircle size={16} className="animate-spin" /> : editingTaskId ? <Check size={16} /> : <Plus size={16} />}
                {saving ? editingTaskId ? "Saving changes..." : "Adding task..." : editingTaskId ? "Save changes" : "Add pending task"}
              </button>
              {editingTaskId && (
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="w-full rounded-md border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancel editing
                </button>
              )}
            </form>
          </aside>
        </div>
      </div>
    </main>
  );
}