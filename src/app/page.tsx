"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  getLastNDates,
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
  ReactNode
> = {
  lateNightRegret: (
    <span className="text-[0.72rem] font-bold uppercase tracking-[0.2em] text-[#a7342d]">
      Failed
    </span>
  ),
  unhealthyEating: (
    <span role="img" aria-label="unhealthy eating">
      🍔
    </span>
  ),
  friedFood: (
    <span role="img" aria-label="fried food">
      🍟
    </span>
  ),
};

const workoutLabels: { value: WorkoutType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "gym", label: "Gym" },
  { value: "run", label: "Run" },
];

const emptySobrietyState: SobrietyState = { categories: [], slips: [] };

const cardShellClass =
  "rounded-3xl border border-[#d6c2a1] bg-[#f9f3e7] shadow-[0_14px_32px_rgba(47,38,32,0.08)]";
const insetCardClass =
  "rounded-2xl border border-[#d6c2a1] bg-[#fbf6ec] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]";
const headingAccentClass =
  "font-heading text-[0.7rem] uppercase tracking-[0.45em] text-[#a2875e]";
const accentButtonClass =
  "rounded-xl bg-[#3f3227] px-4 py-2 text-sm font-semibold text-[#f4efe6] transition hover:bg-[#2f251d]";
const outlineButtonClass =
  "rounded-xl border border-[#cabb9b] px-4 py-2 text-sm font-semibold text-[#3f3227] transition hover:border-[#b99c6b] hover:text-[#8c5a30]";

const SOBRIETY_GOAL_DAYS = 30;

type MetricTimeframe = "week" | "month";
type MetricStatus = "achieved" | "progress" | "incomplete";

type ProgressMetric = {
  id: string;
  label: string;
  current: number;
  target: number;
  caption?: string;
  formatter?: (value: number, target: number) => string;
  trend: number[];
  showPercent?: boolean;
  ringColor?: string;
  textColor?: string;
  displayText?: string;
};

type CalendarDay = {
  date: Date;
  iso: string;
  entry?: DailyEntry;
  sleepHours?: number;
  plannedWorkoutType: WorkoutType;
};

const getWeekStart = (date: Date) => {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
};

const getMetricStatus = (percent: number): MetricStatus => {
  if (percent >= 85) return "achieved";
  if (percent >= 45) return "progress";
  return "incomplete";
};

const getWakeStyling = (minutes?: number) => {
  if (minutes === undefined) {
    return {
      ringColor: "#c7c1b4",
      textColor: "text-[#6f6a62]",
    };
  }

  const hourFraction = minutes / 60;

  if (hourFraction < 6 || hourFraction >= 10) {
    return {
      ringColor: "#b85c3c",
      textColor: "text-[#7b3b28]",
    };
  }

  if ((hourFraction >= 6 && hourFraction < 7) || (hourFraction >= 9 && hourFraction < 10)) {
    return {
      ringColor: "#c79b45",
      textColor: "text-[#83611a]",
    };
  }

  if (hourFraction >= 8 && hourFraction < 9) {
    return {
      ringColor: "#3f6b4a",
      textColor: "text-[#275736]",
    };
  }

  // default 7-8 block
  return {
    ringColor: "#c79b45",
    textColor: "text-[#83611a]",
  };
};

const statusColors: Record<
  MetricStatus,
  { ring: string; background: string; text: string }
> = {
  achieved: {
    ring: "#3f6b4a",
    background: "bg-[#e1f1e6]",
    text: "text-[#275736]",
  },
  progress: {
    ring: "#c79b45",
    background: "bg-[#f5edd7]",
    text: "text-[#83611a]",
  },
  incomplete: {
    ring: "#c7c1b4",
    background: "bg-[#f1efea]",
    text: "text-[#6f6a62]",
  },
};

export default function Home() {
  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => getISODateString(today), [today]);
  const [currentMonth, setCurrentMonth] = useState<Date>(
    () => getMonthStart(new Date()),
  );
  const [timeframe, setTimeframe] = useState<MetricTimeframe>("month");
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() =>
    getWeekStart(new Date()),
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
  const [quickEntryDraft, setQuickEntryDraft] = useState<DailyEntry | null>(
    null,
  );
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
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const quickEntryInitialFocus = useRef<HTMLButtonElement | null>(null);

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

  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(
        currentWeekStart.getFullYear(),
        currentWeekStart.getMonth(),
        currentWeekStart.getDate() + index,
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
      return { date, iso, entry, sleepHours, plannedWorkoutType };
    });
  }, [currentWeekStart, dailyEntries, patternStartDate]);

  const rangeContext = useMemo(() => {
    if (timeframe === "week") {
      const dates = weekDates.map((day) => day.date);
      const isoDates = weekDates.map((day) => day.iso);
      const entries = weekDates
        .map((day) => day.entry)
        .filter((entry): entry is DailyEntry => Boolean(entry));
      return {
        dates,
        isoDates,
        entries,
        totalDays: weekDates.length,
      };
    }
    const now = new Date();
    const isCurrentMonth =
      now.getFullYear() === currentMonth.getFullYear() &&
      now.getMonth() === currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(currentMonth);
    const endDay = isCurrentMonth ? now.getDate() : daysInMonth;
    const dates: Date[] = [];
    const isoDates: string[] = [];
    for (let day = 1; day <= endDay; day += 1) {
      const date = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        day,
      );
      dates.push(date);
      isoDates.push(getISODateString(date));
    }
    const entries = isoDates
      .map((iso) => dailyEntries[iso])
      .filter((entry): entry is DailyEntry => Boolean(entry));
    return {
      dates,
      isoDates,
      entries,
      totalDays: dates.length,
    };
  }, [timeframe, weekDates, currentMonth, dailyEntries]);

  const currentWeekLabel = useMemo(() => {
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 6);
    const sameYear = currentWeekStart.getFullYear() === end.getFullYear();
    const startLabel = currentWeekStart.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const endLabel = end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    });
    const yearLabel = sameYear
      ? `, ${currentWeekStart.getFullYear()}`
      : "";
    return `${startLabel} – ${endLabel}${yearLabel}`;
  }, [currentWeekStart]);

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

  const rangeWorkoutSummary = useMemo(() => {
    const gymDays = rangeContext.entries.filter(
      (entry) => entry.workout === "gym",
    );
    const runDays = rangeContext.entries.filter(
      (entry) => entry.workout === "run",
    );
    const totalWorkoutDays = gymDays.length + runDays.length;
    const percent =
      rangeContext.totalDays > 0
        ? Math.round((totalWorkoutDays / rangeContext.totalDays) * 100)
        : 0;
    return {
      gym: gymDays.length,
      run: runDays.length,
      total: totalWorkoutDays,
      percent,
      targetDays: Math.max(rangeContext.totalDays, 1),
    };
  }, [rangeContext]);

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

  const rangeSleepSummary = useMemo(() => {
    const sleepHoursList =
      rangeContext.entries
        .map((entry) => calculateSleepHours(entry.bedtime, entry.wakeTime))
        .filter((value): value is number => value !== undefined) ?? [];
    const optimalCount = rangeContext.entries.filter((entry) => {
      const hours = calculateSleepHours(entry.bedtime, entry.wakeTime);
      return hours !== undefined && hours >= 7 && hours <= 9;
    }).length;
    return {
      optimal: optimalCount,
      total: rangeContext.totalDays,
      average:
        sleepHoursList.length > 0
          ? Math.round(
              (sleepHoursList.reduce((acc, hours) => acc + hours, 0) /
                sleepHoursList.length) *
                10,
            ) / 10
          : null,
    };
  }, [rangeContext]);

  const rangeAverageWakeMinutes = useMemo(() => {
    const wakeTimes = rangeContext.entries
      .map((entry) => entry.wakeTime)
      .filter((time): time is string => Boolean(time));
    return calculateAverageMinutes(wakeTimes);
  }, [rangeContext]);

  const rangeAverageWakeLabel = useMemo(() => {
    if (rangeAverageWakeMinutes === undefined) return null;
    return formatMinutesToTime(rangeAverageWakeMinutes) ?? null;
  }, [rangeAverageWakeMinutes]);

  const dietSummary = useMemo(() => {
    const regretEntries = monthEntryList.filter(
      (entry) => entry.lateNightRegret !== undefined,
    );
    const regretDays = regretEntries.filter(
      (entry) => entry.lateNightRegret === true,
    ).length;
    const noRegretDays = regretEntries.filter(
      (entry) => entry.lateNightRegret === false,
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
        if (!entry || !selector(entry)) break;
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return streak;
    };

    const lateNightCleanStreak = computeConsecutiveStreak(
      (entry) => entry.lateNightRegret === false,
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

  const rangeDietSummary = useMemo(() => {
    const regretDays = rangeContext.entries.filter(
      (entry) => entry.lateNightRegret === true,
    ).length;
    const totalDays = rangeContext.totalDays;
    const regretFreeDays = Math.max(totalDays - regretDays, 0);
    const loggedDays = rangeContext.entries.filter(
      (entry) => entry.lateNightRegret !== undefined,
    ).length;
    return {
      regretFreeDays,
      regretDays,
      totalDays,
      loggedDays,
    };
  }, [rangeContext]);

  const trendSnapshots = useMemo(() => {
    const dates = getLastNDates(7, today);
    return dates.map((date) => {
      const iso = getISODateString(date);
      const entry = dailyEntries[iso];
      const hasWorkout = (entry?.workout ?? "none") !== "none";
      const sleepHours = calculateSleepHours(entry?.bedtime, entry?.wakeTime);
      const sleepScore =
        sleepHours === undefined
          ? 0
          : Math.max(0, Math.min(1, (sleepHours - 5) / 4));
      const regretFree = entry?.lateNightRegret === false ? 1 : 0;
      const wakeMinutes = entry?.wakeTime
        ? calculateAverageMinutes([entry.wakeTime])
        : undefined;
      const wakeScore =
        wakeMinutes === undefined
          ? 0
          : Math.max(0, Math.min(1, wakeMinutes / (24 * 60)));
      return {
        iso,
        hasWorkout: hasWorkout ? 1 : 0,
        sleepScore,
        regretFree,
        wakeScore,
      };
    });
  }, [dailyEntries, today]);

  const progressMetrics: ProgressMetric[] = useMemo(() => {
    const metrics: ProgressMetric[] = [
      {
        id: "workouts",
        label: "Workout completion",
        current: rangeWorkoutSummary.total,
        target: rangeWorkoutSummary.targetDays,
        caption:
          timeframe === "week"
            ? "Workouts this week"
            : "Workouts so far this month",
        trend: trendSnapshots.map((snapshot) => snapshot.hasWorkout),
        formatter: (value, target) => `${value}/${target}`,
      },
      {
        id: "wake",
        label: "Average wake time",
        current: rangeAverageWakeLabel ? 1 : 0,
        target: 1,
        displayText: rangeAverageWakeLabel ?? "—",
        showPercent: false,
        ringColor: getWakeStyling(rangeAverageWakeMinutes).ringColor,
        textColor: getWakeStyling(rangeAverageWakeMinutes).textColor,
        caption:
          timeframe === "week"
            ? "Wake time this week"
            : "Wake time month to date",
        trend: trendSnapshots.map((snapshot) => snapshot.wakeScore),
      },
      {
        id: "regret",
        label: "Regret-free nights",
        current: rangeDietSummary.regretFreeDays,
        target: Math.max(rangeDietSummary.totalDays, 1),
        caption:
          timeframe === "week"
            ? "Late-night wins this week"
            : "Late-night wins MTD",
        trend: trendSnapshots.map((snapshot) => snapshot.regretFree),
        formatter: (value, target) =>
          rangeDietSummary.totalDays > 0
            ? `${value}/${rangeDietSummary.totalDays}`
            : `${value}/—`,
      },
    ];

    return metrics;
  }, [
    rangeWorkoutSummary,
    rangeAverageWakeLabel,
    rangeAverageWakeMinutes,
    rangeDietSummary,
    timeframe,
    trendSnapshots,
  ]);

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

  const handleWeekChange = useCallback((delta: number) => {
    setCurrentWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta * 7);
      return getWeekStart(next);
    });
  }, []);

  const handleTimeframeChange = useCallback(
    (view: MetricTimeframe) => {
      setTimeframe(view);
      if (view === "week") {
        setCurrentWeekStart(getWeekStart(today));
      }
    },
    [today],
  );

  const openQuickEntry = useCallback(() => {
    setQuickEntryDraft((prev) => {
      if (prev && prev.date === todayIso) {
        return prev;
      }
      const existing = dailyEntries[todayIso];
      return (
        existing ?? {
          date: todayIso,
          workout: "none",
        }
      );
    });
    setIsQuickEntryOpen(true);
    requestAnimationFrame(() => {
      quickEntryInitialFocus.current?.focus();
    });
  }, [dailyEntries, todayIso]);

  const closeQuickEntry = useCallback(() => {
    setIsQuickEntryOpen(false);
    setQuickEntryDraft(null);
  }, []);

  const handleQuickEntryUpdate = useCallback(
    (updater: (draft: DailyEntry) => DailyEntry) => {
      setQuickEntryDraft((prev) => {
        if (!prev) {
          return updater({
            date: todayIso,
            workout: "none",
          });
        }
        return updater(prev);
      });
    },
    [todayIso],
  );

  const handleQuickEntrySave = useCallback(() => {
    if (!quickEntryDraft) return;
    setDailyEntries((prev) => ({
      ...prev,
      [quickEntryDraft.date]: { ...quickEntryDraft },
    }));
    setIsQuickEntryOpen(false);
  }, [quickEntryDraft]);

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

  return (
    <main className="min-h-screen bg-[#f4f0e6] py-12 text-[#2f2820]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 pb-24">
        <section className="grid gap-4 sm:grid-cols-3">
          {progressMetrics.map((metric) => (
            <ProgressMetricCard key={metric.id} metric={metric} />
          ))}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-[#d6c2a1] bg-[#fbf6ec] px-5 py-4">
          <div className="flex items-center gap-2 rounded-full bg-[#f1e6d4] p-1">
            <button
              type="button"
              onClick={() => handleTimeframeChange("week")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                timeframe === "week"
                  ? "bg-[#3f6b4a] text-[#f4efe6]"
                  : "text-[#3f3227] hover:bg-[#efe0c9]"
              }`}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => handleTimeframeChange("month")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                timeframe === "month"
                  ? "bg-[#3f3227] text-[#f4efe6]"
                  : "text-[#3f3227] hover:bg-[#efe0c9]"
              }`}
            >
              Month
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-semibold text-[#3f6b4a]">
              Workouts {rangeWorkoutSummary.total}/
              {rangeWorkoutSummary.targetDays}
            </span>
            <span className="font-semibold text-[#c79b45]">
              Optimal sleep {rangeSleepSummary.optimal}/
              {Math.max(rangeSleepSummary.total, 1)}
            </span>
            <span className="font-semibold text-[#275736]">
              Regret-free {rangeDietSummary.regretFreeDays}/
              {rangeDietSummary.totalDays > 0 ? rangeDietSummary.totalDays : "—"}
            </span>
            {rangeSleepSummary.average !== null && (
              <span className="font-medium text-[#8c7a63]">
                Avg sleep {rangeSleepSummary.average}h
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-[#8e7b63]">
          {remoteEnabled ? (
            <>
              <span
                className={`font-semibold ${
                  syncStatus === "error"
                    ? "text-[#b85c3c]"
                    : syncStatus === "syncing"
                      ? "text-[#9c8463]"
                      : "text-[#3b6b4a]"
                }`}
              >
                {syncStatus === "syncing"
                  ? "Syncing to cloud…"
                  : syncStatus === "error"
                    ? "Cloud sync issue"
                    : "Cloud sync active"}
              </span>
              {lastSyncedLabel && (
                <span className="text-[#aa977a]">
                  Last synced {lastSyncedLabel}
                </span>
              )}
            </>
          ) : (
            <span className="font-semibold text-[#b85c3c]">
              Cloud sync disabled — configure Supabase credentials to enable.
            </span>
          )}
          {remoteMessage && (
            <span className="text-[#b85c3c]">{remoteMessage}</span>
          )}
        </div>

        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,2.3fr)_minmax(340px,1fr)] lg:items-start">
          <section className={`${cardShellClass} flex h-full flex-col p-6`}>
            <header className="mb-6 flex items-center justify-between gap-3">
              <div>
                <p className={headingAccentClass}>Calendar</p>
                <h1 className="font-heading text-3xl text-[#3b2f25]">
                  {timeframe === "week"
                    ? currentWeekLabel
                    : formatMonthYear(currentMonth)}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                {timeframe === "month" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleMonthChange(-1)}
                      className="grid h-10 w-10 place-content-center rounded-full border border-[#c9b9a0] text-lg text-[#3f3227] transition hover:border-[#b99c6b]"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentMonth(getMonthStart(new Date()))}
                      className="hidden rounded-full border border-[#c9b9a0] px-3 py-2 text-sm font-semibold text-[#3f3227] transition hover:border-[#b99c6b] hover:text-[#8c5a30] sm:block"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMonthChange(1)}
                      className="grid h-10 w-10 place-content-center rounded-full border border-[#c9b9a0] text-lg text-[#3f3227] transition hover:border-[#b99c6b]"
                    >
                      ›
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleWeekChange(-1)}
                      className="grid h-10 w-10 place-content-center rounded-full border border-[#c9b9a0] text-lg text-[#3f3227] transition hover:border-[#b99c6b]"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentWeekStart(getWeekStart(new Date()))}
                      className="hidden rounded-full border border-[#c9b9a0] px-3 py-2 text-sm font-semibold text-[#3f3227] transition hover:border-[#b99c6b] hover:text-[#8c5a30] sm:block"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => handleWeekChange(1)}
                      className="grid h-10 w-10 place-content-center rounded-full border border-[#c9b9a0] text-lg text-[#3f3227] transition hover:border-[#b99c6b]"
                    >
                      ›
                    </button>
                  </>
                )}
              </div>
            </header>
            <div className={`${insetCardClass} mb-6 flex flex-col gap-2 p-4`}>
              <label className={headingAccentClass}>
                Every-other-day workout starts
              </label>
              <input
                type="date"
                value={patternStartDate}
                onChange={(event) =>
                  handlePatternStartChange(event.target.value)
                }
                className="w-full rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 text-sm text-[#3f3227] focus:border-[#a67a45] focus:outline-none focus:ring-0"
              />
            </div>
            <div className="grid grid-cols-7 gap-3 text-center text-[0.68rem] font-heading uppercase tracking-[0.32em] text-[#a2875e]">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            {timeframe === "month" ? (
              <div className="mt-3 grid grid-cols-7 gap-3">
                {monthDays.leadingEmpty.map((_, index) => (
                  <div
                    key={`empty-${index}`}
                    className="aspect-square rounded-2xl bg-transparent"
                  />
                ))}
                {monthDays.calendarDates.map((day) => (
                  <CalendarDayCell
                    key={day.iso}
                    day={day}
                    todayIso={todayIso}
                    onSelect={handleDayClick}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-7 gap-3">
                {weekDates.map((day) => (
                  <CalendarDayCell
                    key={day.iso}
                    day={day}
                    todayIso={todayIso}
                    onSelect={handleDayClick}
                  />
                ))}
              </div>
            )}
          </section>

          <aside className="flex h-full flex-col gap-6 self-start">
            <section className="grid flex-1 content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
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
          </aside>
        </div>

        <section className={`${cardShellClass} p-6`}>
          <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <p className={headingAccentClass}>Sobriety</p>
              <h2 className="font-heading text-xl text-[#3b2f25]">
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
                  className="flex flex-col gap-4 rounded-3xl border border-[#d6c2a1] bg-[#fbf6ec] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
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
                            className="rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 focus:border-[#a67a45] focus:outline-none focus:ring-0"
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
                            className="rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 focus:border-[#a67a45] focus:outline-none focus:ring-0"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleUpdateCategory(category.id)}
                              className="flex-1 rounded-xl bg-[#3f6b4a] px-3 py-2 text-sm font-semibold text-[#f4efe6] transition hover:bg-[#2f4d35]"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategoryId(null);
                              }}
                              className="flex-1 rounded-xl border border-[#d0c0a0] px-3 py-2 text-sm font-semibold text-[#8c7a63] transition hover:border-[#b99c6b]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                              <SobrietyStreakVisual
                                streak={streak}
                                goal={SOBRIETY_GOAL_DAYS}
                              />
                              <div className="flex flex-col gap-1 text-left sm:pl-2">
                                <h3 className="font-heading text-lg text-[#3b2f25]">
                                  {category.name}
                                </h3>
                                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#a2875e]">
                                  Since {formatDisplayDate(category.startDate)}
                                </p>
                                <p className="text-sm font-medium text-[#3f6b4a]">
                                  Staying strong for {streak} days
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#e0d2bd] bg-[#f5ecdd] px-4 py-3 sm:justify-between">
                            <button
                              type="button"
                              onClick={() =>
                                setActiveSlipCategoryId((current) =>
                                  current === category.id ? null : category.id,
                                )
                              }
                              className="rounded-full bg-[#3f3227] px-4 py-1 text-xs font-semibold text-[#f4efe6] transition hover:bg-[#2f251d]"
                            >
                              Log slip
                            </button>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => startEditingCategory(category)}
                                className="rounded-full border border-[#d0c0a0] px-3 py-1 text-xs font-semibold text-[#3f3227] transition hover:border-[#b99c6b] hover:text-[#8c5a30]"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCategory(category.id)}
                                className="rounded-full border border-[#c49080] px-3 py-1 text-xs font-semibold text-[#a7342d] transition hover:bg-[#f4d9d6]"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
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
                    <div className="mt-3 flex flex-col gap-2 text-sm text-[#3f3227]">
                      {slips
                        .slice()
                        .reverse()
                        .map((slip) => (
                          <div
                            key={slip.id}
                            className="flex items-start justify-between gap-3 rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] p-3"
                          >
                            <div>
                              <p className="font-medium text-[#3f3227]">
                                {formatDisplayDate(slip.date)}
                                {slip.note ? ` · ${slip.note}` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveSlip(slip.id)}
                              className="text-xs font-semibold uppercase tracking-[0.35em] text-[#a2875e]"
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
              <p className="rounded-2xl border border-dashed border-[#d0c0a0] p-6 text-center text-sm text-[#8c7a63]">
                No sobriety categories yet. Add one to start tracking streaks and
                slips.
              </p>
            )}
          </div>
        </section>

      </div>

      <button
        type="button"
        onClick={openQuickEntry}
        aria-label="Open quick entry"
        className="fixed bottom-8 right-8 z-30 flex h-16 w-16 items-center justify-center rounded-full bg-[#3f6b4a] text-3xl text-[#f4efe6] shadow-[0_18px_36px_rgba(47,38,32,0.18)] transition hover:bg-[#2f4d35]"
      >
        ✨
      </button>

      {isQuickEntryOpen && quickEntryDraft && (
        <QuickEntrySheet
          key={quickEntryDraft.date}
          draft={quickEntryDraft}
          onClose={closeQuickEntry}
          onChange={handleQuickEntryUpdate}
          onSave={handleQuickEntrySave}
          focusRef={quickEntryInitialFocus}
          categories={sobrietyState.categories}
          onAddSlip={(payload) => {
            handleAddSlip(payload);
            closeQuickEntry();
          }}
        />
      )}

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
    <div className={`${cardShellClass} flex flex-col gap-3 p-5`}>
      <div>
        <p className={headingAccentClass}>
          {subtitle}
        </p>
        <h3 className="font-heading text-xl text-[#3b2f25]">{title}</h3>
      </div>
      <div className={`${insetCardClass} flex flex-col divide-y divide-[#e2d4bc]`}>
        {children}
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span className="text-[#8c7a63]">{label}</span>
      <span className="font-semibold text-[#3f3227]">{value}</span>
    </div>
  );
}

function ProgressMetricCard({ metric }: { metric: ProgressMetric }) {
  const percent =
    metric.showPercent === false
      ? 100
      : metric.target > 0
          ? Math.min(100, Math.round((metric.current / metric.target) * 100))
          : 0;
  const animatedValue = useCountUp(metric.current);
  const status = getMetricStatus(percent);
  const colors = statusColors[status];
  const ringColor = metric.ringColor ?? colors.ring;
  const textColor = metric.textColor ?? colors.text;
  const displayValue =
    metric.displayText ??
    (metric.formatter
      ? metric.formatter(Math.round(animatedValue), metric.target)
      : `${Math.round(animatedValue)}/${metric.target}`);
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dashOffset =
    metric.showPercent === false ? 0 : circumference * (1 - percent / 100);

  return (
    <div
      className={`${cardShellClass} flex flex-col gap-3 p-5 text-left transition hover:shadow-[0_18px_36px_rgba(47,38,32,0.12)]`}
    >
      <div className="flex items-center gap-4">
        <div className="relative h-24 w-24">
          <svg
            viewBox="0 0 100 100"
            className="h-full w-full"
            aria-hidden="true"
          >
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="#e7e0d2"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={ringColor}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{
                transition: "stroke-dashoffset 0.6s ease-out, stroke 0.3s ease",
              }}
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div
            className={`absolute inset-[18px] grid place-content-center rounded-full ${colors.background}`}
          >
          <span className={`font-body text-lg font-semibold ${textColor}`}>
              {displayValue}
            </span>
          {metric.showPercent !== false && (
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-[#a2875e]">
              {percent}%
            </span>
          )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-heading text-sm uppercase tracking-[0.35em] text-[#a2875e]">
            {metric.label}
          </span>
          {metric.caption && (
            <span className="text-xs text-[#8c7a63]">{metric.caption}</span>
          )}
        </div>
      </div>
      <Sparkline data={metric.trend} status={status} />
    </div>
  );
}

function Sparkline({
  data,
  status,
}: {
  data: number[];
  status: MetricStatus;
}) {
  const width = 148;
  const height = 36;
  const paddingY = 6;
  const maxIndex = Math.max(data.length - 1, 1);
  const colors = statusColors[status];
  const points = data.map((value, index) => {
    const x = (width / maxIndex) * index;
    const y = height - paddingY - value * (height - paddingY * 2);
    return [x, y] as const;
  });
  const pathD =
    points.length > 0
      ? points
          .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
          .join(" ")
      : "";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="none"
    >
      <path
        d={`${pathD} ${
          points.length > 0
            ? `L${width},${height - paddingY} L0,${height - paddingY} Z`
            : ""
        }`}
        fill={`${colors.ring}22`}
        stroke="none"
      />
      <path d={pathD} fill="none" stroke={colors.ring} strokeWidth="2.5" />
      {points.map(([x, y], index) => (
        <circle
          key={index}
          cx={x}
          cy={y}
          r="2.5"
          fill="#f9f3e7"
          stroke={colors.ring}
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}

function CalendarDayCell({
  day,
  todayIso,
  onSelect,
}: {
  day: CalendarDay;
  todayIso: string;
  onSelect: (iso: string, plannedWorkoutType: WorkoutType) => void;
}) {
  const { date, iso, entry, sleepHours, plannedWorkoutType } = day;
  const isToday = iso === todayIso;
  const loggedWorkout = entry?.workout ?? "none";
  const hasLoggedWorkout = loggedWorkout !== "none";
  const hasPlannedWorkout =
    !hasLoggedWorkout && plannedWorkoutType !== "none";
  const sleepTone =
    sleepHours === undefined
      ? "text-[#8c7a63]"
      : sleepHours < 7
        ? "text-[#b78a33]"
        : sleepHours <= 9
          ? "text-[#3f6b4a]"
          : "text-[#8c7a63]";
  const dietMarks = [
    entry?.lateNightRegret ? dietIcons.lateNightRegret : null,
    entry?.unhealthyEating ? dietIcons.unhealthyEating : null,
    entry?.friedFood ? dietIcons.friedFood : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={() => onSelect(iso, plannedWorkoutType)}
      className={`relative flex aspect-square flex-col items-center rounded-2xl border p-3 transition-colors ${
        hasLoggedWorkout
          ? "border-[#3f6b4a] bg-[#e4f1e9]"
          : hasPlannedWorkout
            ? "border-[#9cbc8a] border-dashed bg-[#eef6eb]"
            : "border-[#d8c9af] bg-[#fbf6ec]"
      } ${isToday ? "ring-2 ring-[#c9b38c]" : ""}`}
    >
      <div className="flex w-full items-baseline justify-between">
        <span className="font-heading text-base text-[#3f3227]">
          {date.getDate()}
        </span>
        <span className={`text-xs font-semibold ${sleepTone}`}>
          {sleepHours ? `${sleepHours}h` : ""}
        </span>
      </div>
      <span
        className={`flex grow items-center text-2xl ${
          hasPlannedWorkout ? "text-[#9cbb7c]" : "text-[#3f6b4a]"
        }`}
      >
        {workoutIcon[loggedWorkout]}
      </span>
      {hasPlannedWorkout && (
        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[#3f6b4a]" />
      )}
      {dietMarks.length > 0 && (
        <span className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1 text-xs">
          {dietMarks.map((mark, index) => (
            <span key={`${iso}-mark-${index}`}>{mark}</span>
          ))}
        </span>
      )}
    </button>
  );
}

function SobrietyStreakVisual({
  streak,
  goal = SOBRIETY_GOAL_DAYS,
}: {
  streak: number;
  goal?: number;
}) {
  const percent =
    goal > 0 ? Math.min(100, Math.round((streak / goal) * 100)) : 0;
  const status = getMetricStatus(percent);
  const colors = statusColors[status];
  const animatedStreak = useCountUp(streak);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percent / 100);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="#e7e0d2"
            strokeWidth="8"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={colors.ring}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{
              transition: "stroke-dashoffset 0.6s ease-out, stroke 0.3s ease",
            }}
          />
        </svg>
        <div
          className={`absolute inset-[16px] grid place-content-center rounded-full ${colors.background}`}
        >
          <span className={`font-body text-2xl font-semibold ${colors.text}`}>
            {Math.round(animatedStreak)}
          </span>
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-[#a2875e]">
            days
          </span>
        </div>
      </div>
      <ConsistencyBar percent={percent} status={status} />
    </div>
  );
}

function ConsistencyBar({
  percent,
  status,
}: {
  percent: number;
  status: MetricStatus;
}) {
  const colors = statusColors[status];
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const flameLeft = `${Math.min(96, Math.max(4, clampedPercent))}%`;

  return (
    <div className="relative h-2 w-28 rounded-full bg-[#e8e1d4]">
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${clampedPercent}%`,
          backgroundColor: colors.ring,
        }}
      />
      {clampedPercent > 0 ? (
        <span
          className="absolute -top-3 text-sm"
          style={{ left: flameLeft, transform: "translateX(-50%)" }}
        >
          🔥
        </span>
      ) : (
        <span className="absolute -top-3 left-0 text-sm">💧</span>
      )}
    </div>
  );
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(target);
  const previousRef = useRef(target);

  useEffect(() => {
    const startValue = previousRef.current;
    const delta = target - startValue;
    if (delta === 0) {
      previousRef.current = target;
      return;
    }

    let animationFrame: number;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      setValue(startValue + delta * easeOutCubic(progress));
      if (progress < 1) {
        animationFrame = requestAnimationFrame(tick);
      } else {
        previousRef.current = target;
      }
    };

    animationFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [target, duration]);

  return value;
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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 pt-10 sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div className="w-full max-w-md rounded-3xl border border-[#d6c2a1] bg-[#f9f3e7] p-6 shadow-[0_28px_56px_rgba(47,38,32,0.35)]">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-heading text-2xl text-[#3b2f25]">
              {formatDisplayDate(entry.date)}
            </h2>
            {sleepHours && (
              <p className="text-sm text-[#8c7a63]">
                Sleep {sleepHours}h
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-[#8c7a63] transition hover:text-[#b85c3c]"
          >
            Close
          </button>
        </header>

        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className={headingAccentClass}>Workout</legend>
            <div className="grid grid-cols-3 gap-2">
              {workoutLabels.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange({ ...entry, workout: value })}
                  className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                    entry.workout === value
                      ? "border-[#8c5a30] bg-[#f2e3d2] text-[#3f3227]"
                      : "border-[#d0c0a0] text-[#8c7a63] hover:border-[#b99c6b]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-3">
            <label className="flex w-full flex-col gap-1 text-xs font-semibold uppercase tracking-[0.35em] text-[#a2875e]">
              Bed time
              <input
                type="time"
                value={entry.bedtime ?? ""}
                onChange={(event) =>
                  onChange({ ...entry, bedtime: event.target.value || undefined })
                }
                className="rounded-2xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 text-sm text-[#3f3227] focus:border-[#a67a45] focus:outline-none focus:ring-0"
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs font-semibold uppercase tracking-[0.35em] text-[#a2875e]">
              Wake time
              <input
                type="time"
                value={entry.wakeTime ?? ""}
                onChange={(event) =>
                  onChange({ ...entry, wakeTime: event.target.value || undefined })
                }
                className="rounded-2xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 text-sm text-[#3f3227] focus:border-[#a67a45] focus:outline-none focus:ring-0"
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className={headingAccentClass}>Diet</legend>
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
            className={`${accentButtonClass} w-full rounded-2xl`}
          >
            Save day
          </button>
          <button
            type="button"
            onClick={onDelete}
            className={`${outlineButtonClass} w-full rounded-2xl`}
          >
            Clear day
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickEntrySheet({
  draft,
  onClose,
  onSave,
  onChange,
  focusRef,
  categories,
  onAddSlip,
}: {
  draft: DailyEntry;
  onClose: () => void;
  onSave: () => void;
  onChange: (updater: (draft: DailyEntry) => DailyEntry) => void;
  focusRef: React.RefObject<HTMLButtonElement | null>;
  categories: SobrietyCategory[];
  onAddSlip?: (payload: { categoryId: string; date: string; note?: string }) => void;
}) {
  const [slipCategoryId, setSlipCategoryId] = useState("");
  const [slipNote, setSlipNote] = useState("");
  const [slipDate, setSlipDate] = useState(draft.date);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleSlipSave = () => {
    if (!slipCategoryId || !onAddSlip) return;
    onAddSlip({
      categoryId: slipCategoryId,
      date: slipDate,
      note: slipNote || undefined,
    });
    setSlipCategoryId("");
    setSlipNote("");
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur transition"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-6">
        <div className="w-full max-w-xl rounded-3xl border border-[#d6c2a1] bg-[#f9f3e7] p-5 shadow-[0_28px_56px_rgba(47,38,32,0.32)]">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl text-[#3b2f25]">
                Quick entry for {formatDisplayDate(draft.date)}
              </h2>
              <p className="text-xs uppercase tracking-[0.35em] text-[#a2875e]">
                Rapid capture mode
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-semibold text-[#8c7a63] transition hover:text-[#b85c3c]"
            >
              Close
            </button>
          </header>
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className={headingAccentClass}>Workout</legend>
              <div className="flex gap-2">
                {workoutLabels.map(({ value, label }, index) => (
                  <button
                    key={value}
                    ref={index === 0 ? focusRef : undefined}
                    type="button"
                    onClick={() =>
                      onChange((entry) => ({ ...entry, workout: value }))
                    }
                    className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                      draft.workout === value
                        ? "border-[#3f6b4a] bg-[#e4f1e9] text-[#2f3f2c]"
                        : "border-[#d0c0a0] text-[#8c7a63] hover:border-[#b99c6b]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.35em] text-[#a2875e]">
                Bed time
                <input
                  type="time"
                  value={draft.bedtime ?? ""}
                  onChange={(event) =>
                    onChange((entry) => ({
                      ...entry,
                      bedtime: event.target.value || undefined,
                    }))
                  }
                  className="rounded-2xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 text-sm text-[#3f3227] focus:border-[#a67a45] focus:outline-none focus:ring-0"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.35em] text-[#a2875e]">
                Wake time
                <input
                  type="time"
                  value={draft.wakeTime ?? ""}
                  onChange={(event) =>
                    onChange((entry) => ({
                      ...entry,
                      wakeTime: event.target.value || undefined,
                    }))
                  }
                  className="rounded-2xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 text-sm text-[#3f3227] focus:border-[#a67a45] focus:outline-none focus:ring-0"
                />
              </label>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className={headingAccentClass}>Diet</legend>
              <ToggleRow
                label="Late-night regret"
                active={draft.lateNightRegret === true}
                onToggle={(next) =>
                  onChange((entry) => ({ ...entry, lateNightRegret: next }))
                }
              />
              <ToggleRow
                label="Unhealthy eating"
                active={draft.unhealthyEating === true}
                onToggle={(next) =>
                  onChange((entry) => ({ ...entry, unhealthyEating: next }))
                }
              />
              <ToggleRow
                label="Fried food"
                active={draft.friedFood === true}
                onToggle={(next) =>
                  onChange((entry) => ({ ...entry, friedFood: next }))
                }
              />
            </fieldset>

            {categories.length > 0 && onAddSlip && (
              <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-[#d0c0a0] bg-[#fbf6ec] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#a2875e]">
                  Log slip
                </p>
                <select
                  value={slipCategoryId}
                  onChange={(event) => setSlipCategoryId(event.target.value)}
                  className="rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 text-sm text-[#3f3227] focus:border-[#a67a45] focus:outline-none focus:ring-0"
                >
                  <option value="">Choose category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={slipDate}
                  onChange={(event) => setSlipDate(event.target.value)}
                  className="rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 text-sm text-[#3f3227] focus:border-[#a67a45] focus:outline-none focus:ring-0"
                />
                <input
                  type="text"
                  value={slipNote}
                  onChange={(event) => setSlipNote(event.target.value)}
                  placeholder="Optional note"
                  className="rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-3 py-2 text-sm text-[#3f3227] focus:border-[#a67a45] focus:outline-none focus:ring-0"
                />
                <button
                  type="button"
                  onClick={handleSlipSave}
                  className="self-start rounded-xl bg-[#3f3227] px-4 py-2 text-sm font-semibold text-[#f4efe6] transition hover:bg-[#2f251d]"
                >
                  Save slip
                </button>
              </div>
            )}
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onSave}
              className="flex-1 rounded-2xl bg-[#3f6b4a] px-4 py-3 text-sm font-semibold text-[#f4efe6] transition hover:bg-[#2f4d35]"
            >
              Save day
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-[#cabb9b] px-4 py-3 text-sm font-semibold text-[#3f3227] transition hover:border-[#b99c6b] hover:text-[#8c5a30]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
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
    <div className="flex items-center justify-between rounded-2xl border border-[#d0c0a0] px-3 py-3">
      <span className="text-sm font-medium text-[#3f3227]">{label}</span>
      <button
        type="button"
        onClick={() => onToggle(!active)}
        className={`h-8 w-16 rounded-full transition ${
          active ? "bg-[#3f6b4a]" : "bg-[#d8c9af]"
        }`}
      >
        <span
          className={`block h-7 w-7 rounded-full bg-[#fdf8ef] shadow transition-all ${
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
        className="rounded-full border border-[#d0c0a0] px-4 py-2 text-sm font-semibold text-[#3f3227] transition hover:border-[#b99c6b] hover:text-[#8c5a30]"
      >
        Add category
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#d0c0a0] bg-[#fdf8ef] p-3 text-sm">
      <input
        type="text"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="rounded-xl border border-[#d0c0a0] bg-[#fbf6ec] px-3 py-2 focus:border-[#a67a45] focus:outline-none focus:ring-0"
      />
      <input
        type="date"
        value={startDate}
        onChange={(event) => setStartDate(event.target.value)}
        className="rounded-xl border border-[#d0c0a0] bg-[#fbf6ec] px-3 py-2 focus:border-[#a67a45] focus:outline-none focus:ring-0"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          className={`${accentButtonClass} flex-1 rounded-xl`}
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className={`${outlineButtonClass} flex-1 rounded-xl`}
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
    <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-[#d0c0a0] bg-[#fdf8ef] p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#a2875e]">
        Log slip for {category.name}
      </p>
      <input
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className="rounded-xl border border-[#d0c0a0] bg-[#fbf6ec] px-3 py-2 focus:border-[#a67a45] focus:outline-none focus:ring-0"
      />
      <input
        type="text"
        placeholder="Optional note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="rounded-xl border border-[#d0c0a0] bg-[#fbf6ec] px-3 py-2 focus:border-[#a67a45] focus:outline-none focus:ring-0"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit({ categoryId: category.id, date, note: note || undefined })}
          className={`${accentButtonClass} flex-1 rounded-xl`}
        >
          Save slip
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`${outlineButtonClass} flex-1 rounded-xl`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
