export type WorkoutType = "none" | "gym" | "run";

export interface DailyEntry {
  date: string; // ISO date (YYYY-MM-DD)
  workout: WorkoutType;
  gymDayType?: "upper" | "lower"; // For gym workouts
  bedtime?: string; // HH:MM (24h)
  wakeTime?: string; // HH:MM (24h)
  lateNightRegret?: boolean;
  unhealthyEating?: boolean;
  friedFood?: boolean;
  sick?: boolean;
  runDuration?: number; // Duration in minutes
  runDistance?: number; // Distance in miles
}

export interface SobrietyCategory {
  id: string;
  name: string;
  startDate: string; // ISO date
}

export interface Slip {
  id: string;
  categoryId: string;
  date: string; // ISO date
  note?: string;
}

export interface SobrietyState {
  categories: SobrietyCategory[];
  slips: Slip[];
}

export type DailyEntriesMap = Record<string, DailyEntry>;

export interface DashboardSyncPayload {
  dailyEntries: DailyEntriesMap;
  sobrietyState: SobrietyState;
  patternStartDate: string;
}

