"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DailyEntry,
  DashboardSyncPayload,
  DailyEntriesMap,
  SobrietyCategory,
  SobrietyState,
  WorkoutType,
} from "@/types/dashboard";
import {
  addMonths,
  calculateAverageMinutes,
  calculateSleepHours,
  calculateStandardDeviation,
  differenceInDays,
  formatDisplayDate,
  formatMinutesToTime,
  formatMonthYear,
  getDaysInMonth,
  getISODateString,
  getMonthStart,
  toDateFromISO,
} from "@/lib/date-utils";

const DAILY_ENTRIES_KEY = "lifeDashboard_dailyEntries";
const SOBRIETY_STATE_KEY = "lifeDashboard_sobrietyState";
const PATTERN_START_DATE_KEY = "lifeDashboard_patternStartDate";

const workoutIcon: Record<WorkoutType, string> = {
  none: "",
  gym: "🏋️",
  run: "🏃",
};

const dietIcons: Record<
  "lateNightRegret" | "unhealthyEating" | "friedFood",
  string
> = {
  lateNightRegret: "🚫",
  unhealthyEating: "🍔",
  friedFood: "🍟",
};

const workoutLabels: { value: WorkoutType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "gym", label: "Gym" },
  { value: "run", label: "Run" },
];

const emptySobrietyState: SobrietyState = { categories: [], slips: [] };

export default function Home() {
  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => getISODateString(today), [today]);
  const [currentMonth, setCurrentMonth] = useState<Date>(
    () => getMonthStart(new Date()),
  );
  const [dailyEntries, setDailyEntries] = useState<DailyEntriesMap>({});
  const [sobrietyState, setSobrietyState] = useState<SobrietyState>(
    emptySobrietyState,
  );
  const [patternStartDate, setPatternStartDate] = useState<string>(() =>
    getISODateString(getMonthStart(new Date())),
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [draftEntry, setDraftEntry] = useState<DailyEntry | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeSlipCategoryId, setActiveSlipCategoryId] = useState<
    string | null
  >(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );
  const [editingCategoryDraft, setEditingCategoryDraft] = useState<{
    name: string;
    startDate: string;
  }>({
    name: "",
    startDate: getISODateString(new Date()),
  });
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "error">(
    "idle",
  );
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const entriesRaw = window.localStorage.getItem(DAILY_ENTRIES_KEY);
    const sobrietyRaw = window.localStorage.getItem(SOBRIETY_STATE_KEY);
    const patternRaw = window.localStorage.getItem(PATTERN_START_DATE_KEY);

    if (entriesRaw) {
      try {
        const parsed = JSON.parse(entriesRaw) as DailyEntriesMap;
        queueMicrotask(() => {
          setDailyEntries(parsed);
        });
      } catch (error) {
        console.error("Failed to parse daily entries", error);
      }
    }
    if (sobrietyRaw) {
      try {
        const parsed = JSON.parse(sobrietyRaw) as SobrietyState;
        queueMicrotask(() => {
          setSobrietyState(parsed);
        });
      } catch (error) {
        console.error("Failed to parse sobriety state", error);
      }
    }
    if (patternRaw) {
      queueMicrotask(() => {
        setPatternStartDate(patternRaw);
      });
    }
    queueMicrotask(() => {
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    window.localStorage.setItem(
      DAILY_ENTRIES_KEY,
      JSON.stringify(dailyEntries),
    );
  }, [dailyEntries, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    window.localStorage.setItem(
      SOBRIETY_STATE_KEY,
      JSON.stringify(sobrietyState),
    );
  }, [sobrietyState, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    window.localStorage.setItem(PATTERN_START_DATE_KEY, patternStartDate);
  }, [isLoaded, patternStartDate]);

  useEffect(() => {
    let ignore = false;

    const loadRemoteState = async () => {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const json = (await response.json()) as {
          enabled?: boolean;
          data?: DashboardSyncPayload | null;
          message?: string | null;
          updatedAt?: string | null;
        };
        if (ignore) return;
        const enabled = Boolean(json.enabled);
        setRemoteEnabled(enabled);
        setRemoteMessage(json.message ?? null);
        if (enabled && json.data) {
          setDailyEntries(json.data.dailyEntries ?? {});
          setSobrietyState(
            json.data.sobrietyState ?? emptySobrietyState,
          );
          if (json.data.patternStartDate) {
            setPatternStartDate(json.data.patternStartDate);
          }
        }
        if (json?.updatedAt) {
          setLastSyncedAt(json.updatedAt);
        }
      } catch (error) {
        if (ignore) return;
        console.error("Failed to load remote dashboard state", error);
        setRemoteMessage(
          error instanceof Error
            ? error.message
            : "Failed to load remote dashboard state",
        );
      }
    };

    loadRemoteState();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !remoteEnabled) return;
    const payload: DashboardSyncPayload = {
      dailyEntries,
      sobrietyState,
      patternStartDate,
    };

    const timeout = window.setTimeout(async () => {
      try {
        setSyncStatus("syncing");
        const response = await fetch("/api/dashboard", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const json = await response.json();
        if (!response.ok || json?.message) {
          throw new Error(
            json?.message ?? `Request failed with status ${response.status}`,
          );
        }
        setSyncStatus("idle");
        setRemoteMessage(null);
        if (json?.updatedAt) {
          setLastSyncedAt(json.updatedAt);
        }
      } catch (error) {
        console.error("Failed to sync dashboard state", error);
        setSyncStatus("error");
        setRemoteMessage(
          error instanceof Error
            ? error.message
            : "Failed to sync dashboard to cloud",
        );
      }
    }, 600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [dailyEntries, sobrietyState, patternStartDate, isLoaded, remoteEnabled]);

  const monthDays = useMemo(() => {
    const firstDay = getMonthStart(currentMonth);
    const days = getDaysInMonth(currentMonth);
    const leadingEmpty = firstDay.getDay();
    return {
      leadingEmpty: Array.from({ length: leadingEmpty }),
      calendarDates: Array.from({ length: days }, (_, index) => {
        const date = new Date(
          currentMonth.getFullYear(),
          currentMonth.getMonth(),
          index + 1,
        );
        const iso = getISODateString(date);
        const entry = dailyEntries[iso];
        const sleepHours = calculateSleepHours(entry?.bedtime, entry?.wakeTime);
        const patternDiff =
          patternStartDate && patternStartDate <= iso
            ? differenceInDays(toDateFromISO(patternStartDate), date)
            : null;
        const plannedWorkoutType: WorkoutType =
          patternDiff !== null && patternDiff % 2 === 0 && patternDiff >= 0
            ? "gym"
            : "none";
        return {
          date,
          iso,
          entry,
          sleepHours,
          plannedWorkoutType,
        };
      }),
    };
  }, [currentMonth, dailyEntries, patternStartDate]);

  const monthEntryList = useMemo(() => {
    const entries: DailyEntry[] = [];
    const days = getDaysInMonth(currentMonth);
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        day,
      );
      const iso = getISODateString(date);
      const entry = dailyEntries[iso];
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }, [currentMonth, dailyEntries]);

  const workoutSummary = useMemo(() => {
    const gymDays = monthEntryList.filter((entry) => entry.workout === "gym");
    const runDays = monthEntryList.filter((entry) => entry.workout === "run");
    const totalWorkoutDays = gymDays.length + runDays.length;

    const now = new Date();
    const isCurrentMonth =
      now.getFullYear() === currentMonth.getFullYear() &&
      now.getMonth() === currentMonth.getMonth();
    const daysElapsed = isCurrentMonth
      ? Math.min(now.getDate(), getDaysInMonth(currentMonth))
      : getDaysInMonth(currentMonth);
    const workoutPercent =
      daysElapsed > 0 ? Math.round((totalWorkoutDays / daysElapsed) * 100) : 0;

    return {
      gym: gymDays.length,
      run: runDays.length,
      total: totalWorkoutDays,
      percent: workoutPercent,
      daysElapsed,
    };
  }, [currentMonth, monthEntryList]);

  const sleepSummary = useMemo(() => {
    const sleepHoursList =
      monthEntryList
        .map((entry) => calculateSleepHours(entry.bedtime, entry.wakeTime))
        .filter((value): value is number => value !== undefined) ?? [];
    if (sleepHoursList.length === 0) {
      return {
        average: null,
        short: 0,
        optimal: 0,
        long: 0,
        consistency: null,
      };
    }

    const totals = sleepHoursList.reduce(
      (acc, hours) => {
        if (hours < 7) acc.short += 1;
        else if (hours <= 9) acc.optimal += 1;
        else acc.long += 1;
        acc.sum += hours;
        return acc;
      },
      { sum: 0, short: 0, optimal: 0, long: 0 },
    );

    const consistencyRaw = calculateStandardDeviation(sleepHoursList);

    return {
      average: Math.round((totals.sum / sleepHoursList.length) * 10) / 10,
      short: totals.short,
      optimal: totals.optimal,
      long: totals.long,
      consistency:
        consistencyRaw !== undefined
          ? Math.round(consistencyRaw * 10) / 10
          : null,
    };
  }, [monthEntryList]);

  const averageWakeMinutes = useMemo(() => {
    const wakeTimes = monthEntryList
      .map((entry) => entry.wakeTime)
      .filter((time): time is string => Boolean(time));
    return calculateAverageMinutes(wakeTimes);
  }, [monthEntryList]);

  const averageWakeTimeLabel = useMemo(() => {
    if (averageWakeMinutes === undefined) return null;
    return formatMinutesToTime(averageWakeMinutes) ?? null;
  }, [averageWakeMinutes]);

  const dietSummary = useMemo(() => {
    const regretDays = monthEntryList.filter(
      (entry) => entry.lateNightRegret === true,
    ).length;
    const noRegretDays = monthEntryList.filter(
      (entry) =>
        entry.lateNightRegret === false ||
        entry.lateNightRegret === undefined,
    ).length;
    const unhealthyDays = monthEntryList.filter(
      (entry) => entry.unhealthyEating === true,
    ).length;
    const healthyDays = monthEntryList.filter(
      (entry) =>
        entry.unhealthyEating === false ||
        entry.unhealthyEating === undefined,
    ).length;
    const friedFoodDays = monthEntryList.filter(
      (entry) => entry.friedFood === true,
    ).length;

    const computeConsecutiveStreak = (
      selector: (entry: DailyEntry) => boolean,
    ) => {
      let streak = 0;
      const cursor = new Date();
      while (true) {
        const iso = getISODateString(cursor);
        const entry = dailyEntries[iso];
        if (!entry) break;
        if (!selector(entry)) break;
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return streak;
    };

    const lateNightCleanStreak = computeConsecutiveStreak(
      (entry) => entry.lateNightRegret !== true,
    );

    const friedEntries = Object.values(dailyEntries)
      .filter((entry) => entry.friedFood === true)
      .sort((a, b) => a.date.localeCompare(b.date));
    const lastFriedEntry = friedEntries[friedEntries.length - 1];
    let friedFoodCleanStreak = 0;
    if (lastFriedEntry) {
      friedFoodCleanStreak = Math.max(
        0,
        differenceInDays(toDateFromISO(lastFriedEntry.date), today),
      );
    } else if (Object.keys(dailyEntries).length > 0) {
      const earliestDate = Object.keys(dailyEntries).sort()[0];
      friedFoodCleanStreak = Math.max(
        0,
        differenceInDays(toDateFromISO(earliestDate), today),
      );
    }

    return {
      regretDays,
      noRegretDays,
      unhealthyDays,
      healthyDays,
      friedFoodDays,
      lateNightCleanStreak,
      friedFoodCleanStreak,
    };
  }, [dailyEntries, monthEntryList, today]);

  const handleDayClick = (iso: string, plannedWorkoutType: WorkoutType) => {
    const existing = dailyEntries[iso];
    const defaultWorkout: WorkoutType =
      plannedWorkoutType !== "none" ? plannedWorkoutType : "none";
    setDraftEntry(
      existing ?? {
        date: iso,
        workout: defaultWorkout,
      },
    );
    setSelectedDate(iso);
  };

  const handleSaveEntry = () => {
    if (!draftEntry) return;
    setDailyEntries((prev) => ({
      ...prev,
      [draftEntry.date]: { ...draftEntry },
    }));
    setSelectedDate(null);
    setDraftEntry(null);
  };

  const handleDeleteEntry = (date: string) => {
    setDailyEntries((prev) => {
      const next = { ...prev };
      delete next[date];
      return next;
    });
    setSelectedDate(null);
    setDraftEntry(null);
  };

  const handleMonthChange = (delta: number) => {
    setCurrentMonth((prev) => addMonths(prev, delta));
  };

  const handlePatternStartChange = (value: string) => {
    if (!value) return;
    setPatternStartDate(value);
  };

  const handleAddCategory = (category: SobrietyCategory) => {
    setSobrietyState((prev) => ({
      ...prev,
      categories: [...prev.categories, category],
    }));
  };

  const handleAddSlip = (slip: { categoryId: string; date: string; note?: string }) => {
    setSobrietyState((prev) => ({
      ...prev,
      slips: [
        ...prev.slips,
        {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}`,
          ...slip,
        },
      ],
    }));
  };

  const handleRemoveSlip = (id: string) => {
    setSobrietyState((prev) => ({
      ...prev,
      slips: prev.slips.filter((slip) => slip.id !== id),
    }));
  };

  const startEditingCategory = (category: SobrietyCategory) => {
    setEditingCategoryId(category.id);
    setEditingCategoryDraft({
      name: category.name,
      startDate: category.startDate,
    });
  };

  const handleUpdateCategory = (categoryId: string) => {
    if (!editingCategoryDraft.name || !editingCategoryDraft.startDate) return;
    setSobrietyState((prev) => ({
      ...prev,
      categories: prev.categories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              name: editingCategoryDraft.name,
              startDate: editingCategoryDraft.startDate,
            }
          : category,
      ),
    }));
    setEditingCategoryId(null);
  };

  const handleDeleteCategory = (categoryId: string) => {
    setSobrietyState((prev) => ({
      categories: prev.categories.filter((category) => category.id !== categoryId),
      slips: prev.slips.filter((slip) => slip.categoryId !== categoryId),
    }));
    if (activeSlipCategoryId === categoryId) {
      setActiveSlipCategoryId(null);
    }
    if (editingCategoryId === categoryId) {
      setEditingCategoryId(null);
    }
  };

  const sobrietyWithStreaks = useMemo(() => {
    const todayDate = new Date();
    return sobrietyState.categories.map((category) => {
      const slips = sobrietyState.slips
        .filter((slip) => slip.categoryId === category.id)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (slips.length === 0) {
        const streak =
          differenceInDays(toDateFromISO(category.startDate), todayDate) + 1;
        return { category, streak: Math.max(streak, 0), slips: [] as typeof slips };
      }

      const lastSlip = slips[slips.length - 1];
      const dayAfterLastSlip = toDateFromISO(lastSlip.date);
      dayAfterLastSlip.setDate(dayAfterLastSlip.getDate() + 1);
      const diff = differenceInDays(dayAfterLastSlip, todayDate);
      const streak = Math.max(0, diff + 1);
      return { category, streak, slips };
    });
  }, [sobrietyState]);

  const lastSyncedLabel = useMemo(() => {
    if (!lastSyncedAt) return null;
    try {
      return new Date(lastSyncedAt).toLocaleString();
    } catch (error) {
      console.error("Failed to format last synced timestamp", error);
      return lastSyncedAt;
    }
  }, [lastSyncedAt]);

  const northStarMetrics = [
    {
      label: "Workout completion",
      value:
        workoutSummary.daysElapsed > 0
          ? `${workoutSummary.total}/${workoutSummary.daysElapsed}`
          : `${workoutSummary.total}/—`,
      caption: "Workouts vs days so far",
    },
    {
      label: "Average wake time",
      value: averageWakeTimeLabel ?? "—",
      caption: "Month to date",
    },
    {
      label: "No regret streak",
      value: `${dietSummary.lateNightCleanStreak} nights`,
      caption: "Late-night clean",
    },
  ];

  return (
    <main className="min-h-screen bg-slate-100 py-10 text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 pb-20">
        <section className="grid gap-4 sm:grid-cols-3">
          {northStarMetrics.map((metric) => (
            <TopMetricCircle
              key={metric.label}
              label={metric.label}
              value={metric.value}
              caption={metric.caption}
            />
          ))}
        </section>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {remoteEnabled ? (
            <>
              <span
                className={`font-semibold ${
                  syncStatus === "error"
                    ? "text-amber-600"
                    : syncStatus === "syncing"
                      ? "text-slate-500"
                      : "text-emerald-600"
                }`}
              >
                {syncStatus === "syncing"
                  ? "Syncing to cloud…"
                  : syncStatus === "error"
                    ? "Cloud sync issue"
                    : "Cloud sync active"}
              </span>
              {lastSyncedLabel && (
                <span className="text-slate-400">
                  Last synced {lastSyncedLabel}
                </span>
              )}
            </>
          ) : (
            <span className="font-semibold text-amber-600">
              Cloud sync disabled — configure Supabase credentials to enable.
            </span>
          )}
          {remoteMessage && (
            <span className="text-amber-600">{remoteMessage}</span>
          )}
        </div>

        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,2.3fr)_minmax(340px,1fr)]">
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <header className="mb-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Calendar
                </p>
                <h1 className="text-3xl font-semibold">
                  {formatMonthYear(currentMonth)}
          </h1>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleMonthChange(-1)}
                  className="grid h-10 w-10 place-content-center rounded-full border border-slate-200 text-lg"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMonth(getMonthStart(new Date()))}
                  className="hidden rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 sm:block"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => handleMonthChange(1)}
                  className="grid h-10 w-10 place-content-center rounded-full border border-slate-200 text-lg"
                >
                  ›
                </button>
              </div>
            </header>
            <div className="mb-6 flex flex-col gap-2 rounded-2xl bg-slate-50 p-4">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Every-other-day workout starts
              </label>
              <input
                type="date"
                value={patternStartDate}
                onChange={(event) =>
                  handlePatternStartChange(event.target.value)
                }
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-7 gap-3 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-7 gap-3">
              {monthDays.leadingEmpty.map((_, index) => (
                <div
                  key={`empty-${index}`}
                  className="aspect-square rounded-2xl bg-transparent"
                />
              ))}
              {monthDays.calendarDates.map(
                ({ date, iso, entry, sleepHours, plannedWorkoutType }) => {
                  const isToday = iso === todayIso;
                  const loggedWorkout = entry?.workout ?? "none";
                  const displayWorkout = loggedWorkout;
                  const hasLoggedWorkout = loggedWorkout !== "none";
                  const hasPlannedWorkout =
                    !hasLoggedWorkout && plannedWorkoutType !== "none";
                  const sleepTone =
                    sleepHours === undefined
                      ? ""
                      : sleepHours < 7
                        ? "text-amber-600"
                        : sleepHours <= 9
                          ? "text-emerald-600"
                          : "text-slate-500";
                  const dietMarks = [
                    entry?.lateNightRegret ? dietIcons.lateNightRegret : null,
                    entry?.unhealthyEating ? dietIcons.unhealthyEating : null,
                    entry?.friedFood ? dietIcons.friedFood : null,
                  ].filter(Boolean);

                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => handleDayClick(iso, plannedWorkoutType)}
                      className={`relative flex aspect-square flex-col items-center justify-between rounded-2xl border p-3 transition-colors ${
                        hasLoggedWorkout
                          ? "border-emerald-500 bg-emerald-50"
                          : hasPlannedWorkout
                            ? "border-emerald-200 border-dashed bg-emerald-50/40"
                            : "border-slate-200 bg-white"
                      } ${isToday ? "ring-2 ring-sky-400" : ""}`}
                    >
                      <span className="self-start text-base font-semibold text-slate-700">
                        {date.getDate()}
                      </span>
                      <span
                        className={`text-2xl ${
                          hasPlannedWorkout ? "text-emerald-500/70" : ""
                        }`}
                      >
                        {workoutIcon[displayWorkout]}
                      </span>
                      <span className={`text-xs font-medium ${sleepTone}`}>
                        {sleepHours ? `${sleepHours}h` : ""}
                      </span>
                      {hasPlannedWorkout && (
                        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-emerald-400/70" />
                      )}
                      {dietMarks.length > 0 && (
                        <span className="absolute bottom-1.5 right-1.5 flex gap-1 text-sm">
                          {dietMarks.map((mark, index) => (
                            <span key={`${iso}-mark-${index}`}>{mark}</span>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                },
              )}
            </div>
          </section>

          <aside className="flex flex-col gap-6 lg:sticky lg:top-24">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <MetricCard title="Workouts" subtitle="This month">
                <MetricRow label="Gym days" value={workoutSummary.gym} />
                <MetricRow label="Run days" value={workoutSummary.run} />
                <MetricRow label="Total workouts" value={workoutSummary.total} />
                <MetricRow
                  label="% of days with a workout"
                  value={`${workoutSummary.percent}%`}
                />
              </MetricCard>
              <MetricCard title="Sleep" subtitle="This month">
                <MetricRow
                  label="Average duration"
                  value={
                    sleepSummary.average !== null
                      ? `${sleepSummary.average}h`
                      : "—"
                  }
                />
                <MetricRow label="< 7h nights" value={sleepSummary.short} />
                <MetricRow label="7–9h nights" value={sleepSummary.optimal} />
                <MetricRow label="> 9h nights" value={sleepSummary.long} />
                <MetricRow
                  label="Sleep consistency"
                  value={
                    sleepSummary.consistency !== null
                      ? `±${sleepSummary.consistency}h`
                      : "—"
                  }
                />
              </MetricCard>
              <MetricCard title="Diet" subtitle="This month">
                <MetricRow
                  label="Late-night regret days"
                  value={dietSummary.regretDays}
                />
                <MetricRow
                  label="No regret days"
                  value={dietSummary.noRegretDays}
                />
                <MetricRow
                  label="Unhealthy eating days"
                  value={dietSummary.unhealthyDays}
                />
                <MetricRow
                  label="No fried food streak"
                  value={`${dietSummary.friedFoodCleanStreak} days`}
                />
                <MetricRow
                  label="Fried food days"
                  value={dietSummary.friedFoodDays}
                />
                <MetricRow
                  label="No regret streak"
                  value={`${dietSummary.lateNightCleanStreak} nights`}
                />
              </MetricCard>
            </section>

            <section className="rounded-3xl bg-white p-6 shadow-sm">
              <header className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Sobriety
                  </p>
                  <h2 className="text-xl font-semibold">
                    Categories & slips
                  </h2>
                </div>
                <AddSobrietyCategory onSubmit={handleAddCategory} />
              </header>
              <div className="flex flex-col gap-4">
                {sobrietyWithStreaks.map(({ category, streak, slips }) => {
                  const isEditing = editingCategoryId === category.id;
                  return (
                    <div
                      key={category.id}
                      className="rounded-2xl border border-slate-200 p-4"
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-2">
                          {isEditing ? (
                            <div className="flex flex-col gap-2 text-sm">
                              <input
                                type="text"
                                value={editingCategoryDraft.name}
                                onChange={(event) =>
                                  setEditingCategoryDraft((draft) => ({
                                    ...draft,
                                    name: event.target.value,
                                  }))
                                }
                                className="rounded-xl border border-slate-200 px-3 py-2"
                              />
                              <input
                                type="date"
                                value={editingCategoryDraft.startDate}
                                onChange={(event) =>
                                  setEditingCategoryDraft((draft) => ({
                                    ...draft,
                                    startDate: event.target.value,
                                  }))
                                }
                                className="rounded-xl border border-slate-200 px-3 py-2"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateCategory(category.id)
                                  }
                                  className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCategoryId(null);
                                  }}
                                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-500"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex items-start gap-3">
                                  <div className="grid h-16 w-16 place-content-center rounded-full border-4 border-emerald-200 bg-emerald-50 text-center">
                                    <span className="text-xl font-semibold text-emerald-700">
                                      {streak}
                                    </span>
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                                      days
                                    </span>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <h3 className="text-lg font-semibold">
                                      {category.name}
                                    </h3>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                      Since {formatDisplayDate(category.startDate)}
                                    </p>
                                    <p className="text-sm font-medium text-emerald-700">
                                      I am sober for {streak} days
                                    </p>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      startEditingCategory(category)
                                    }
                                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDeleteCategory(category.id)
                                    }
                                    className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-500"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveSlipCategoryId((current) =>
                                    current === category.id ? null : category.id,
                                  )
                                }
                                className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                              >
                                Log slip
                              </button>
                            </>
                          )}
                        </div>
                        {activeSlipCategoryId === category.id && !isEditing && (
                          <SlipForm
                            category={category}
                            onSubmit={(payload) => {
                              handleAddSlip(payload);
                              setActiveSlipCategoryId(null);
                            }}
                            onCancel={() => setActiveSlipCategoryId(null)}
                          />
                        )}
                      </div>
                      {slips.length > 0 && (
                        <div className="mt-3 flex flex-col gap-2 text-sm text-slate-600">
                          {slips
                            .slice()
                            .reverse()
                            .map((slip) => (
                              <div
                                key={slip.id}
                                className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3"
                              >
                                <div>
                                  <p className="font-medium">
                                    {formatDisplayDate(slip.date)}
                                    {slip.note ? ` · ${slip.note}` : ""}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSlip(slip.id)}
                                  className="text-xs font-semibold uppercase tracking-wide text-slate-400"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sobrietyWithStreaks.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                    No sobriety categories yet. Add one to start tracking streaks
                    and slips.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>

      </div>

      {selectedDate && draftEntry && (
        <DayDetailSheet
          entry={draftEntry}
          onClose={() => {
            setSelectedDate(null);
            setDraftEntry(null);
          }}
          onChange={setDraftEntry}
          onSave={handleSaveEntry}
          onDelete={() => handleDeleteEntry(draftEntry.date)}
        />
      )}
    </main>
  );
}

function MetricCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl bg-white p-4 shadow-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {subtitle}
        </p>
        <h3 className="text-xl font-semibold">{title}</h3>
      </div>
      <div className="flex flex-col divide-y divide-slate-100 rounded-2xl bg-slate-50">
        {children}
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function TopMetricCircle({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-white p-5 text-center shadow-sm">
      <div className="grid h-28 w-28 place-content-center rounded-full border-4 border-slate-200 text-xl font-semibold text-slate-900">
        {value}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {caption && (
          <span className="text-xs text-slate-400">{caption}</span>
        )}
      </div>
    </div>
  );
}

function DayDetailSheet({
  entry,
  onClose,
  onSave,
  onDelete,
  onChange,
}: {
  entry: DailyEntry;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onChange: (entry: DailyEntry) => void;
}) {
  const sleepHours = calculateSleepHours(entry.bedtime, entry.wakeTime);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 pt-10 sm:items-center">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {formatDisplayDate(entry.date)}
            </h2>
            {sleepHours && (
              <p className="text-sm text-slate-500">
                Sleep {sleepHours}h
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-slate-400"
          >
            Close
          </button>
        </header>

        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Workout
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {workoutLabels.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange({ ...entry, workout: value })}
                  className={`rounded-2xl border px-3 py-2 text-sm font-semibold ${
                    entry.workout === value
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-3">
            <label className="flex w-full flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Bed time
              <input
                type="time"
                value={entry.bedtime ?? ""}
                onChange={(event) =>
                  onChange({ ...entry, bedtime: event.target.value || undefined })
                }
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Wake time
              <input
                type="time"
                value={entry.wakeTime ?? ""}
                onChange={(event) =>
                  onChange({ ...entry, wakeTime: event.target.value || undefined })
                }
                className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Diet
            </legend>
            <ToggleRow
              label="Late-night regret"
              active={entry.lateNightRegret === true}
              onToggle={(next) =>
                onChange({ ...entry, lateNightRegret: next })
              }
            />
            <ToggleRow
              label="Unhealthy eating"
              active={entry.unhealthyEating === true}
              onToggle={(next) =>
                onChange({ ...entry, unhealthyEating: next })
              }
            />
            <ToggleRow
              label="Fried food"
              active={entry.friedFood === true}
              onToggle={(next) => onChange({ ...entry, friedFood: next })}
            />
          </fieldset>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSave}
            className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
          >
            Save day
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-500"
          >
            Clear day
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 px-3 py-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <button
        type="button"
        onClick={() => onToggle(!active)}
        className={`h-8 w-16 rounded-full transition ${
          active ? "bg-emerald-500" : "bg-slate-200"
        }`}
      >
        <span
          className={`block h-7 w-7 rounded-full bg-white shadow transition-all ${
            active ? "translate-x-8" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function AddSobrietyCategory({
  onSubmit,
}: {
  onSubmit: (category: SobrietyCategory) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(getISODateString(new Date()));

  const handleSubmit = () => {
    if (!name || !startDate) return;
    onSubmit({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`,
      name,
      startDate,
    });
    setName("");
    setStartDate(getISODateString(new Date()));
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
      >
        Add category
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-3 text-sm">
      <input
        type="text"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2"
      />
      <input
        type="date"
        value={startDate}
        onChange={(event) => setStartDate(event.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          className="flex-1 rounded-xl bg-slate-900 px-3 py-2 font-semibold text-white"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SlipForm({
  category,
  onSubmit,
  onCancel,
}: {
  category: SobrietyCategory;
  onSubmit: (payload: { categoryId: string; date: string; note?: string }) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(getISODateString(new Date()));
  const [note, setNote] = useState("");

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-slate-200 p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Log slip for {category.name}
      </p>
      <input
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2"
      />
      <input
        type="text"
        placeholder="Optional note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit({ categoryId: category.id, date, note: note || undefined })}
          className="flex-1 rounded-xl bg-slate-900 px-3 py-2 font-semibold text-white"
        >
          Save slip
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
