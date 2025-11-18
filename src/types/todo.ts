export type TaskStatus = "todo" | "doing" | "done";
export type Urgency = "high" | "medium" | "low";

export interface Task {
  id: string;
  text: string;
  date?: string; // ISO date string
  time?: string; // Time in 24-hour format (HH:MM)
  tags: string[];
  section: "tambareni" | "school" | "recruiting";
  status?: TaskStatus; // Only for tambareni section
  urgency?: Urgency; // Only for tambareni section
  createdAt: string;
}

export interface TodoState {
  tasks: Task[];
}

