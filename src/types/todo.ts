export type TaskStatus = "todo" | "doing" | "done";
export type Urgency = "high" | "medium" | "low";

export interface Task {
  id: string;
  text: string;
  date?: string; // ISO date string
  time?: string; // Time in 24-hour format (HH:MM)
  tags: string[];
  section: string; // built-in: tambareni, school, socialmedia, recruiting; or custom section id
  status?: TaskStatus; // Only for tambareni section
  urgency?: Urgency; // Only for tambareni section
  /** Recurring days of week: 0 = Sunday, 1 = Monday, ... 6 = Saturday. Task appears on calendar on these days. */
  recurringDays?: number[];
  /** For recurring tasks: ISO dates when this task was completed (so it doesn't show on those days in upcoming). */
  recurringCompletedDates?: string[];
  createdAt: string;
}

export interface TodoState {
  tasks: Task[];
}

