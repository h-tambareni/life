const MS_PER_DAY = 1000 * 60 * 60 * 24;

const pad = (value: number) => value.toString().padStart(2, "0");

export const getISODateString = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const toDateFromISO = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
};

export const getMonthStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

export const addMonths = (date: Date, months: number) =>
  new Date(date.getFullYear(), date.getMonth() + months, 1);

export const getLastNDates = (count: number, endDate = new Date()) => {
  const dates: Date[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate() - index,
    );
    dates.push(date);
  }
  return dates;
};

export const getDaysInMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

export const getWeekday = (date: Date) => date.getDay();

export const differenceInDays = (from: Date, to: Date) => {
  const utcFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const utcTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  const diff = (utcTo - utcFrom) / MS_PER_DAY;
  return diff >= 0 ? Math.floor(diff) : Math.ceil(diff);
};

export const parseTimeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export const formatMinutesToTime = (minutes: number) => {
  if (Number.isNaN(minutes)) return undefined;
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = Math.round(normalized % 60);
  const paddedHours = hours.toString().padStart(2, "0");
  const paddedMinutes = mins.toString().padStart(2, "0");
  return `${paddedHours}:${paddedMinutes}`;
};

export const calculateSleepHours = (bed?: string, wake?: string) => {
  if (!bed || !wake) return undefined;
  const bedMinutes = parseTimeToMinutes(bed);
  const wakeMinutes = parseTimeToMinutes(wake);
  const minutes =
    wakeMinutes >= bedMinutes
      ? wakeMinutes - bedMinutes
      : wakeMinutes + 24 * 60 - bedMinutes;
  return Math.round((minutes / 60) * 10) / 10;
};

export const calculateAverageMinutes = (times: string[]) => {
  if (times.length === 0) return undefined;
  const total = times.reduce(
    (acc, time) => acc + parseTimeToMinutes(time),
    0,
  );
  return Math.round(total / times.length);
};

export const calculateStandardDeviation = (values: number[]) => {
  if (values.length < 2) return undefined;
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

export const formatMonthYear = (date: Date) =>
  date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

export const formatDisplayDate = (iso: string) => {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${month}/${day}/${year}`;
};

export const getWeekStart = (date: Date) => {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
};

export const getWeekEnd = (date: Date) => {
  const end = new Date(date);
  end.setDate(end.getDate() + (6 - end.getDay()));
  end.setHours(23, 59, 59, 999);
  return end;
};

const dayColors: Record<number, string> = {
  0: "text-[#dc2626]", // Sunday - Red
  1: "text-[#ea580c]", // Monday - Orange
  2: "text-[#f59e0b]", // Tuesday - Amber
  3: "text-[#eab308]", // Wednesday - Yellow
  4: "text-[#84cc16]", // Thursday - Lime
  5: "text-[#22c55e]", // Friday - Green
  6: "text-[#10b981]", // Saturday - Emerald
};

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const monthAbbrevs = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const formatRelativeDate = (iso: string, time?: string): { label: string; color: string } => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const taskDate = toDateFromISO(iso);
  taskDate.setHours(0, 0, 0, 0);
  
  const diffDays = differenceInDays(today, taskDate);
  
  if (diffDays === 0) {
    return { label: "Today", color: "text-[#3f6b4a]" };
  } else if (diffDays === 1) {
    return { label: "Tomorrow", color: "text-[#3f6b4a]" };
  }
  
  // Check if within the next 7 days from today (rolling week)
  // This includes Sunday if it's coming up within 7 days
  const nextWeekStart = new Date(today);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  nextWeekStart.setHours(0, 0, 0, 0);
  
  if (taskDate < nextWeekStart) {
    // Within the next 7 days - show day name
    const dayOfWeek = taskDate.getDay();
    return {
      label: dayNames[dayOfWeek],
      color: dayColors[dayOfWeek] || "text-[#3f3227]",
    };
  } else {
    // Past the next 7 days - show month abbreviation and day
    const month = monthAbbrevs[taskDate.getMonth()];
    const day = taskDate.getDate();
    return {
      label: `${month} ${day}`,
      color: "text-[#8c7a63]",
    };
  }
};

