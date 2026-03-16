"use client";

import { useState, useEffect, useRef, useMemo, KeyboardEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Task, TaskStatus, Urgency } from "@/types/todo";
import { parseNaturalDate, extractTags, cleanTaskText } from "@/lib/date-parser";
import { getISODateString, formatDisplayDate, formatRelativeDate, toDateFromISO, differenceInDays } from "@/lib/date-utils";
import { parseNaturalTime, formatTime12Hour } from "@/lib/time-parser";
import {
  getCustomSections,
  setCustomSections,
  getTagMemoryKey,
  slugFromName,
  BUILT_IN_SECTION_IDS,
  BUILT_IN_SECTION_NAMES,
  type CustomSection,
} from "@/lib/todo-sections";
import HighlightedInput from "@/components/HighlightedInput";
import SatisfyingCheckbox from "@/components/SatisfyingCheckbox";

const TODO_STORAGE_KEY = "lifeTodo_tasks";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function TodoUpcomingPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "error">("idle");
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [customSections, setCustomSectionsState] = useState<CustomSection[]>([]);
  const [activeInput, setActiveInput] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagDropdownPosition, setTagDropdownPosition] = useState({ top: 0, left: 0 });
  const [selectedTagIndex, setSelectedTagIndex] = useState(0);
  const [showDoneTasks, setShowDoneTasks] = useState(false);
  const [recurringDaysDraft, setRecurringDaysDraft] = useState<number[]>([]);
  const [showRecurringPicker, setShowRecurringPicker] = useState(false);
  const [showGroupingModal, setShowGroupingModal] = useState(false);
  const [daysToShow, setDaysToShow] = useState(30);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const recurringPickerRef = useRef<HTMLDivElement>(null);
  const sharedInputRef = useRef<HTMLInputElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  const builtInSections = useMemo(
    () => BUILT_IN_SECTION_IDS.map((id) => ({ id, name: BUILT_IN_SECTION_NAMES[id] ?? id })),
    []
  );
  const allSections = useMemo(() => [...builtInSections, ...customSections], [builtInSections, customSections]);

  useEffect(() => {
    setCustomSectionsState(getCustomSections());
  }, []);

  // Load tasks from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(TODO_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Task[];
        setTasks(parsed);
      } catch {
        setTasks([]);
      }
    }
    setIsLoaded(true);
  }, []);

  // Load from remote (Supabase) on mount
  useEffect(() => {
    let ignore = false;

    const loadRemoteState = async () => {
      try {
        const response = await fetch("/api/todo", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const json = (await response.json()) as {
          enabled?: boolean;
          data?: { tasks: Task[] } | null;
          message?: string | null;
          updatedAt?: string | null;
        };
        if (ignore) return;
        const enabled = Boolean(json.enabled);
        setRemoteEnabled(enabled);
        setRemoteMessage(json.message ?? null);
        if (enabled && json.data?.tasks) {
          setTasks(json.data.tasks);
          // Also update localStorage
          window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(json.data.tasks));
        }
        if (json?.updatedAt) {
          setLastSyncedAt(json.updatedAt);
        }
      } catch (error) {
        if (ignore) return;
        console.error("Failed to load remote todo state", error);
        setRemoteMessage(
          error instanceof Error
            ? error.message
            : "Failed to load remote todo state",
        );
      }
    };

    loadRemoteState();

    return () => {
      ignore = true;
    };
  }, []);

  // Listen for storage changes (from other tabs and same tab)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TODO_STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as Task[];
          setTasks(parsed);
        } catch (error) {
          console.error("Failed to parse tasks from storage event", error);
        }
      }
    };
    const handleCustomStorageChange = (e: Event) => {
      const customEvent = e as CustomEvent<Task[]>;
      if (customEvent.detail) {
        // Use functional update to ensure React detects the change
        setTasks((prev) => {
          // Compare JSON strings to avoid unnecessary updates
          const prevJson = JSON.stringify(prev);
          const newJson = JSON.stringify(customEvent.detail);
          if (prevJson !== newJson) {
            return customEvent.detail;
          }
          return prev;
        });
      }
    };
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("todoStorageChange", handleCustomStorageChange as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("todoStorageChange", handleCustomStorageChange as EventListener);
    };
  }, []);

  // Reload tasks from Supabase when page becomes visible or window gains focus
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reloadTasks = async () => {
      if (!remoteEnabled) return;
      try {
        const response = await fetch("/api/todo", { cache: "no-store" });
        if (!response.ok) return;
        const json = (await response.json()) as {
          enabled?: boolean;
          data?: { tasks: Task[] } | null;
          updatedAt?: string | null;
        };
        if (json.enabled && json.data?.tasks) {
          setTasks(json.data.tasks);
          window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(json.data.tasks));
          if (json?.updatedAt) {
            setLastSyncedAt(json.updatedAt);
          }
        }
      } catch (error) {
        console.error("Failed to reload tasks from Supabase", error);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reloadTasks();
      }
    };
    const handleFocus = () => {
      reloadTasks();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [remoteEnabled]);

  // Sync tasks to Supabase whenever tasks change
  useEffect(() => {
    if (!isLoaded || !remoteEnabled) return;
    
    const payload = { tasks };

    const timeout = window.setTimeout(async () => {
      try {
        setSyncStatus("syncing");
        const response = await fetch("/api/todo", {
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
        console.error("Failed to sync todo state", error);
        setSyncStatus("error");
        setRemoteMessage(
          error instanceof Error
            ? error.message
            : "Failed to sync todos to cloud",
        );
      }
    }, 300); // Shorter delay for immediate updates

    return () => {
      window.clearTimeout(timeout);
    };
  }, [tasks, isLoaded, remoteEnabled]);

  // Save tasks to localStorage (backup)
  useEffect(() => {
    if (!isLoaded) return;
    window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(tasks));

    const sectionIds = allSections.map((s) => s.id);
    const tagsBySection: Record<string, Set<string>> = {};
    sectionIds.forEach((id) => {
      tagsBySection[id] = new Set<string>();
    });
    tasks.forEach((task) => {
      if (!tagsBySection[task.section]) tagsBySection[task.section] = new Set<string>();
      task.tags.forEach((tag) => tagsBySection[task.section].add(tag.toLowerCase()));
    });
    sectionIds.forEach((id) => {
      window.localStorage.setItem(getTagMemoryKey(id), JSON.stringify(Array.from(tagsBySection[id] ?? [])));
    });
  }, [tasks, isLoaded, allSections]);

  const getRememberedTags = (sectionId: string): string[] => {
    if (typeof window === "undefined") return [];
    const stored = window.localStorage.getItem(getTagMemoryKey(sectionId));
    const rememberedTags: string[] = [];
    if (stored) {
      try {
        rememberedTags.push(...(JSON.parse(stored) as string[]));
      } catch {
        // ignore
      }
    }
    if (sectionId === "tambareni") {
      ["high", "medium", "low", "done", "doing", "todo"].forEach((tag) => {
        if (!rememberedTags.includes(tag)) rememberedTags.push(tag);
      });
    }
    return rememberedTags;
  };

  // Extract status from text for tambareni section
  const extractStatus = (text: string): TaskStatus | undefined => {
    const textLower = text.toLowerCase();
    if (/@(done|completed|finished)\b/.test(textLower)) {
      return "done";
    }
    if (/@(doing|in.?progress|working.?on|wip)\b/.test(textLower)) {
      return "doing";
    }
    if (/@(todo|to.?do|pending)\b/.test(textLower)) {
      return "todo";
    }
    if (/\b(done|completed|finished)\b/.test(textLower)) {
      return "done";
    }
    if (/\b(doing|in progress|in-progress|working on|wip)\b/.test(textLower)) {
      return "doing";
    }
    if (/\b(todo|to do|to-do|to_do|pending)\b/.test(textLower)) {
      return "todo";
    }
    return undefined;
  };

  // Extract urgency from text
  const extractUrgency = (text: string): Urgency | undefined => {
    const textLower = text.toLowerCase();
    if (/@high\b/.test(textLower)) {
      return "high";
    }
    if (/@medium\b/.test(textLower)) {
      return "medium";
    }
    if (/@low\b/.test(textLower)) {
      return "low";
    }
    return undefined;
  };

  // Remove status keywords and @status tags from text
  const removeStatusKeywords = (text: string): string => {
    return text
      .replace(/@(done|completed|finished)\b/gi, "")
      .replace(/@(doing|in.?progress|working.?on|wip)\b/gi, "")
      .replace(/@(todo|to.?do|pending)\b/gi, "")
      .replace(/\b(done|completed|finished)\b/gi, "")
      .replace(/\b(doing|in progress|in-progress|working on|wip)\b/gi, "")
      .replace(/\b(todo|to do|to-do|to_do|pending)\b/gi, "")
      .trim()
      .replace(/\s+/g, " ");
  };

  const createTask = (text: string, sectionId: string, status?: TaskStatus, recurringDays?: number[]) => {
    const date = parseNaturalDate(text);
    const time = parseNaturalTime(text);
    const tags = extractTags(text);
    
    // For tambareni section, check if status and urgency are mentioned in text
    let detectedStatus = status;
    let detectedUrgency: Urgency | undefined;
    let textToClean = text;
    
    if (sectionId === "tambareni") {
      const extractedStatus = extractStatus(text);
      if (extractedStatus) {
        detectedStatus = extractedStatus;
        textToClean = removeStatusKeywords(textToClean);
      }
      const extractedUrgency = extractUrgency(text);
      if (extractedUrgency) {
        detectedUrgency = extractedUrgency;
        textToClean = textToClean.replace(/@(high|medium|low)\b/gi, "").trim().replace(/\s+/g, " ");
      }
    }

    const cleanText = cleanTaskText(textToClean);
    if (!cleanText.trim()) return;

    const newTask: Task = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
      text: cleanText,
      date: date || undefined,
      time: time || undefined,
      tags,
      section: sectionId,
      status: detectedStatus || (sectionId === "tambareni" ? "todo" : undefined),
      urgency: detectedUrgency,
      recurringDays: recurringDays && recurringDays.length > 0 ? [...recurringDays].sort((a, b) => a - b) : undefined,
      createdAt: getISODateString(new Date()),
    };

    setTasks((prev) => [...prev, newTask]);
    setInputValue("");
    setActiveInput(null);
    setShowTagDropdown(false);
    setTagSuggestions([]);
    setRecurringDaysDraft([]);
    setShowRecurringPicker(false);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>, sectionId: string) => {
    const value = e.target.value;
    setInputValue(value);

    const atIndex = value.lastIndexOf("@");
    if (atIndex !== -1) {
      const afterAt = value.substring(atIndex + 1);
      const spaceIndex = afterAt.indexOf(" ");
      const tagQuery = spaceIndex === -1 ? afterAt : afterAt.substring(0, spaceIndex);

      const isCompleteTag = tagQuery.length > 0 && /^\w+$/.test(tagQuery) && (
        spaceIndex === 0 ||
        (spaceIndex === -1 && atIndex + 1 + tagQuery.length === value.length)
      );

      if (!isCompleteTag) {
        const rememberedTags = getRememberedTags(sectionId);
        const filtered = tagQuery.length > 0
          ? rememberedTags.filter((tag) =>
              tag.toLowerCase().startsWith(tagQuery.toLowerCase())
            )
          : rememberedTags;
        
        setTagSuggestions(filtered);
        setShowTagDropdown(filtered.length > 0 && rememberedTags.length > 0);
        setSelectedTagIndex(0);
      
        const input = e.target;
        const rect = input.getBoundingClientRect();
        const charWidth = 8;
        const inputContainer = input.closest(".relative");
        if (inputContainer) {
          const containerRect = inputContainer.getBoundingClientRect();
          setTagDropdownPosition({
            top: rect.bottom - containerRect.top + 4,
            left: Math.min(rect.left - containerRect.left + (atIndex * charWidth), containerRect.width - 280),
          });
        } else {
          setTagDropdownPosition({
            top: rect.bottom + 4,
            left: Math.min(rect.left + (atIndex * charWidth), window.innerWidth - 280),
          });
        }
      } else {
        setShowTagDropdown(false);
      }
    } else {
      setShowTagDropdown(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, sectionId: string) => {
    if (showTagDropdown && tagSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedTagIndex((prev) => (prev + 1) % tagSuggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedTagIndex((prev) => (prev - 1 + tagSuggestions.length) % tagSuggestions.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selectedTag = tagSuggestions[selectedTagIndex];
        if (selectedTag) {
          const atIndex = inputValue.lastIndexOf("@");
          if (atIndex !== -1) {
            const beforeAt = inputValue.substring(0, atIndex);
            const afterAt = inputValue.substring(atIndex + 1);
            const spaceIndex = afterAt.indexOf(" ");
            const afterTag = spaceIndex === -1 ? "" : afterAt.substring(spaceIndex);
            const newValue = `${beforeAt}@${selectedTag}${afterTag ? " " + afterTag : ""}`;
            setInputValue(newValue);
            setShowTagDropdown(false);
            setTimeout(() => {
              const input = sharedInputRef.current;
              if (input) {
                const cursorPos = beforeAt.length + 1 + selectedTag.length + (afterTag ? 1 : 0);
                input.setSelectionRange(cursorPos, cursorPos);
              }
            }, 0);
          }
        }
        return;
      } else if (e.key === "Escape") {
        setShowTagDropdown(false);
        return;
      }
    }

    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      const status = sectionId === "tambareni" ? "todo" : undefined;
      const days = recurringDaysDraft.length > 0 ? [...recurringDaysDraft] : undefined;
      createTask(inputValue, sectionId, status, days);
    } else if (e.key === "Escape") {
      setActiveInput(null);
      setInputValue("");
      setShowTagDropdown(false);
      setShowRecurringPicker(false);
    }
  };

  // Close recurring picker when clicking outside
  useEffect(() => {
    if (!showRecurringPicker) return;
    const handleClick = (e: MouseEvent) => {
      const el = recurringPickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setShowRecurringPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showRecurringPicker]);

  const handleAddTaskClick = (sectionId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    // Blur any currently focused input
    if (activeInput && activeInput !== sectionId) {
      sharedInputRef.current?.blur();
    }
    setActiveInput(sectionId);
    setInputValue("");
    setTimeout(() => {
      sharedInputRef.current?.focus();
    }, 0);
  };

  const handleInputBlur = (sectionId: string) => {
    // Use a longer timeout to allow button clicks to process first
    setTimeout(() => {
      // Only clear if we're still on the same section (not switching)
      if (activeInput === sectionId && !inputValue.trim()) {
        setActiveInput(null);
        setInputValue("");
      }
      setShowTagDropdown(false);
    }, 300);
  };

  const handleTagSelect = (tag: string) => {
    const atIndex = inputValue.lastIndexOf("@");
    if (atIndex !== -1) {
      const beforeAt = inputValue.substring(0, atIndex);
      const afterAt = inputValue.substring(atIndex + 1);
      const spaceIndex = afterAt.indexOf(" ");
      const afterTag = spaceIndex === -1 ? "" : afterAt.substring(spaceIndex);
      const newValue = `${beforeAt}@${tag}${afterTag ? " " + afterTag : ""}`;
      setInputValue(newValue);
      setShowTagDropdown(false);
      setTimeout(() => {
        const input = sharedInputRef.current;
        if (input) {
          input.focus();
          const cursorPos = beforeAt.length + 1 + tag.length + (afterTag ? 1 : 0);
          input.setSelectionRange(cursorPos, cursorPos);
        }
      }, 0);
    }
  };

  const updateTaskTags = (taskId: string, tags: string[]) => {
    setTasks((prev) => {
      const updated = prev.map((task) => (task.id === taskId ? { ...task, tags } : task));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent("todoStorageChange", { detail: updated }));
      }
      return updated;
    });
  };

  /** When displayDate is provided and task is recurring, completes only that day. Otherwise marks task done (or undone). */
  const handleCheckboxChange = (task: Task, checked: boolean, displayDate?: string) => {
    const currentTask = tasks.find((t) => t.id === task.id);
    if (!currentTask) return;

    if (displayDate && currentTask.recurringDays?.length) {
      if (checked) {
        completeRecurringForDate(task.id, displayDate);
      } else {
        setTasks((prev) => {
          const t = prev.find((x) => x.id === task.id);
          if (!t?.recurringCompletedDates?.length) return prev;
          const updated = prev.map((x) =>
            x.id === task.id
              ? { ...x, recurringCompletedDates: x.recurringCompletedDates!.filter((d) => d !== displayDate) }
              : x
          );
          if (typeof window !== "undefined") {
            window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(updated));
          }
          return updated;
        });
      }
      return;
    }

    setTasks((prev) => {
      const current = prev.find((t) => t.id === task.id);
      if (!current) return prev;
      let updated: Task[];
      if (checked) {
        if (current.section === "tambareni") {
          if (current.status === "done") return prev;
          updated = prev.map((t) => (t.id === task.id ? { ...t, status: "done" as TaskStatus } : t));
        } else {
          if (current.tags.includes("done")) return prev;
          updated = prev.map((t) => (t.id === task.id ? { ...t, tags: [...t.tags, "done"] } : t));
        }
      } else {
        if (current.section === "tambareni") {
          updated = prev.map((t) => (t.id === task.id ? { ...t, status: "todo" as TaskStatus } : t));
        } else {
          updated = prev.map((t) =>
            t.id === task.id ? { ...t, tags: t.tags.filter((tag) => tag !== "done") } : t
          );
        }
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  };

  const updateTaskDate = (taskId: string, date: string | undefined) => {
    setTasks((prev) => {
      const updated = prev.map((task) => (task.id === taskId ? { ...task, date } : task));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent("todoStorageChange", { detail: updated }));
      }
      return updated;
    });
  };

  const updateTaskTime = (taskId: string, time: string | undefined) => {
    setTasks((prev) => {
      const updated = prev.map((task) => (task.id === taskId ? { ...task, time } : task));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent("todoStorageChange", { detail: updated }));
      }
      return updated;
    });
  };

  const updateTaskText = (taskId: string, text: string) => {
    setTasks((prev) => {
      const updated = prev.map((task) => (task.id === taskId ? { ...task, text } : task));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent("todoStorageChange", { detail: updated }));
      }
      return updated;
    });
  };

  const deleteTask = (taskId: string) => {
    setTasks((prev) => {
      const updated = prev.filter((task) => task.id !== taskId);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent("todoStorageChange", { detail: updated }));
      }
      return updated;
    });
  };

  const pushToCloud = async () => {
    setPushMessage("Pushing…");
    try {
      const response = await fetch("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks }),
      });
      const json = await response.json();
      if (!response.ok || json?.message) {
        throw new Error(json?.message ?? `Request failed with status ${response.status}`);
      }
      setPushMessage("Saved to cloud");
      setRemoteEnabled(true);
      if (json?.updatedAt) setLastSyncedAt(json.updatedAt);
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : "Failed to push to cloud");
    }
    setTimeout(() => setPushMessage(null), 3000);
  };

  /** Mark a recurring task as completed for a specific date (so it doesn't show on that day). */
  const completeRecurringForDate = (taskId: string, dateIso: string) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task || !task.recurringDays?.length) return prev;
      const completed = task.recurringCompletedDates ?? [];
      if (completed.includes(dateIso)) return prev;
      const updated = prev.map((t) =>
        t.id === taskId
          ? { ...t, recurringCompletedDates: [...completed, dateIso].sort() }
          : t
      );
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent("todoStorageChange", { detail: updated }));
      }
      return updated;
    });
  };

  // Filter done tasks from all categories (regardless of date)
  // Tambareni Careers uses status === "done", while School and Recruiting use tags.includes("done")
  const allDoneTasks = tasks.filter((task) => 
    (task.section === "tambareni" && task.status === "done") || 
    (task.section !== "tambareni" && task.tags.includes("done"))
  );
  const sortDoneTasks = (taskList: Task[]): Task[] => {
    return [...taskList].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  };

  // Organize tasks by date (includes dated tasks + recurring tasks expanded per day)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isTaskDone = (task: Task) =>
    (task.section === "tambareni" && task.status === "done") ||
    (task.section !== "tambareni" && task.tags.includes("done"));

  /** Get tasks that appear on a given date (ISO): dated tasks for that date + recurring tasks for that day of week (not completed for that date). */
  const getTasksForDate = (dateIso: string): Task[] => {
    const date = toDateFromISO(dateIso);
    const dayOfWeek = date.getDay();
    const dated = tasks.filter(
      (t) =>
        t.date === dateIso &&
        !isTaskDone(t)
    );
    const recurring = tasks.filter(
      (t) =>
        t.recurringDays?.length &&
        t.recurringDays.includes(dayOfWeek) &&
        !(t.recurringCompletedDates ?? []).includes(dateIso) &&
        !isTaskDone(t)
    );
    const byId = new Map<string, Task>();
    dated.forEach((t) => byId.set(t.id, t));
    recurring.forEach((t) => byId.set(t.id, t));
    return Array.from(byId.values());
  };

  const sortTasksByTime = (taskList: Task[]): Task[] => {
    return [...taskList].sort((a, b) => {
      if (a.time && b.time) {
        return a.time.localeCompare(b.time);
      }
      if (a.time && !b.time) return -1;
      if (!a.time && b.time) return 1;
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
  };

  // Overdue: only dated tasks with date < today
  const overdueTasks = tasks
    .filter(
      (t) =>
        t.date &&
        !isTaskDone(t) &&
        toDateFromISO(t.date).setHours(0, 0, 0, 0) < today.getTime()
    )
    .sort((a, b) => toDateFromISO(a.date!).getTime() - toDateFromISO(b.date!).getTime());
  const sortedOverdueTasks = sortTasksByTime(overdueTasks);

  const todayIso = getISODateString(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = getISODateString(tomorrow);

  const sortedTodayTasks = sortTasksByTime(getTasksForDate(todayIso));
  const sortedTomorrowTasks = sortTasksByTime(getTasksForDate(tomorrowIso));

  // Future dates: today+2 through today+(daysToShow-1), only include dates that have tasks or are within range
  const futureDateSections: { dateKey: string; tasks: Task[] }[] = [];
  for (let i = 2; i < daysToShow; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateKey = getISODateString(d);
    const dayTasks = getTasksForDate(dateKey);
    futureDateSections.push({ dateKey, tasks: sortTasksByTime(dayTasks) });
  }

  const hasAnyUpcoming =
    sortedOverdueTasks.length > 0 ||
    sortedTodayTasks.length > 0 ||
    sortedTomorrowTasks.length > 0 ||
    futureDateSections.some((s) => s.tasks.length > 0);

  const formatDateHeader = (iso: string): string => {
    const date = toDateFromISO(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const taskDate = new Date(date);
    taskDate.setHours(0, 0, 0, 0);
    const diffDays = differenceInDays(today, taskDate);

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    const dayName = dayNames[date.getDay()];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();

    if (diffDays === 0) {
      return `${month} ${day} · Today · ${dayName}`;
    } else if (diffDays === 1) {
      return `${month} ${day} · Tomorrow · ${dayName}`;
    }
    
    return `${month} ${day} · ${dayName}`;
  };

  const formatOverdueDate = (iso: string): string => {
    const date = toDateFromISO(iso);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();
    return `${month} ${day}`;
  };

  if (!isLoaded) {
    return (
      <main className="min-h-screen bg-[#f4f0e6] py-8">
        <div className="mx-auto w-full max-w-7xl px-4">
          <p className="text-[#8c7a63]">Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f0e6] py-8 text-[#2f2820]">
      <div className="mx-auto w-full max-w-7xl px-4">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-heading text-4xl font-bold text-[#3b2f25]">To-Do Upcoming</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={pushToCloud}
              className="text-sm font-semibold text-[#8c7a63] underline decoration-dotted underline-offset-4 hover:text-[#3f3227] transition"
            >
              Push to cloud
            </button>
            {pushMessage && (
              <span className={`text-sm ${pushMessage.startsWith("Saved") ? "text-[#3b6b4a]" : pushMessage === "Pushing…" ? "text-[#9c8463]" : "text-[#b85c3c]"}`}>
                {pushMessage}
              </span>
            )}
            <button
              onClick={() => {
                router.push("/todo");
              }}
              className="text-sm font-semibold text-[#8c7a63] underline decoration-dotted underline-offset-4 hover:text-[#3f3227] transition"
            >
              Show Inbox
            </button>
          </div>
        </div>

        {/* Toggle button - always visible in same position */}
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setShowDoneTasks(!showDoneTasks)}
            className="text-sm font-semibold text-[#8c7a63] underline decoration-dotted underline-offset-4 hover:text-[#3f3227] transition"
          >
            {showDoneTasks
              ? `Show Upcoming${hasAnyUpcoming ? " (next " + daysToShow + " days)" : ""}`
              : `Show Done${allDoneTasks.length > 0 ? ` (${allDoneTasks.length})` : ""}`}
          </button>
        </div>

        {/* Add Task Input at Top - only show when not showing done tasks */}
        {!showDoneTasks && (
          <div className="mb-8 rounded-3xl border border-[#d6c2a1] bg-[#f9f3e7] p-6 shadow-[0_14px_32px_rgba(47,38,32,0.08)]">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {allSections.map((s) => (
                <button
                  key={s.id}
                  onClick={(e) => handleAddTaskClick(s.id, e)}
                  className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    activeInput === s.id
                      ? "bg-[#3f3227] text-[#f4efe6]"
                      : "border border-[#cabb9b] text-[#3f3227] hover:border-[#b99c6b]"
                  }`}
                  title={s.name.startsWith("@") ? s.name : `@${s.name.toLowerCase().replace(/\s+/g, "")}`}
                >
                  {s.name.startsWith("@") ? s.name : s.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowGroupingModal(true)}
                className="whitespace-nowrap rounded-xl border border-dashed border-[#cabb9b] px-3 py-1.5 text-xs font-semibold text-[#8c7a63] transition hover:border-[#b99c6b] hover:text-[#3f3227]"
              >
                Add/remove grouping
              </button>
            </div>
            {activeInput != null && (
              <div className="relative">
                <div 
                  className="flex w-full items-center gap-1 rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-4 py-2 text-sm text-[#3f3227] focus-within:border-[#a67a45] focus-within:outline-none focus-within:ring-0"
                  onBlur={() => handleInputBlur(activeInput)}
                >
                  <div className="min-w-0 flex-1">
                    <HighlightedInput
                      value={inputValue}
                      onChange={(e) => handleInputChange(e, activeInput)}
                      onKeyDown={(e) => handleKeyDown(e, activeInput)}
                      placeholder={
                        activeInput === "tambareni"
                          ? "Enter task... (e.g., 'Fix bug today @high @todo')"
                          : "Enter task... (e.g., 'Add date or @tags')"
                      }
                      className="w-full bg-transparent outline-none"
                      autoFocus
                      inputRef={sharedInputRef}
                    />
                  </div>
                  <div ref={recurringPickerRef} className="relative flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => setShowRecurringPicker((v) => !v)}
                      className={`rounded-lg p-1.5 transition ${
                        recurringDaysDraft.length > 0
                          ? "bg-[#3f3227] text-[#f4efe6]"
                          : "text-[#8c7a63] hover:bg-[#e8dfd0] hover:text-[#3f3227]"
                      }`}
                      title="Recurring days"
                      aria-label="Set recurring days"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                        <path d="M21 3v5h-5" />
                      </svg>
                    </button>
                    {showRecurringPicker && (
                      <div className="absolute right-0 top-full z-50 mt-1 flex flex-col gap-1 rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] p-2 shadow-lg">
                        <span className="text-xs font-semibold text-[#3f3227]">Repeat on</span>
                        <div className="flex flex-wrap gap-1">
                          {DAY_NAMES.map((name, dayIndex) => {
                            const selected = recurringDaysDraft.includes(dayIndex);
                            return (
                              <button
                                key={dayIndex}
                                type="button"
                                onClick={() => {
                                  if (selected) {
                                    setRecurringDaysDraft((prev) => prev.filter((d) => d !== dayIndex));
                                  } else {
                                    setRecurringDaysDraft((prev) => [...prev, dayIndex].sort((a, b) => a - b));
                                  }
                                }}
                                className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                                  selected ? "bg-[#3f3227] text-[#f4efe6]" : "bg-[#e8dfd0] text-[#3f3227] hover:bg-[#d6c2a1]"
                                }`}
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                        {recurringDaysDraft.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setRecurringDaysDraft([])}
                            className="mt-1 text-xs text-[#8c7a63] underline hover:text-[#3f3227]"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {showTagDropdown && tagSuggestions.length > 0 && activeInput && (
                  <div
                    ref={tagDropdownRef}
                    className="absolute z-50 max-h-48 w-64 overflow-auto rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] shadow-lg"
                    style={{
                      top: `${tagDropdownPosition.top}px`,
                      left: `${tagDropdownPosition.left}px`,
                    }}
                  >
                    {tagSuggestions.map((tag, index) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleTagSelect(tag)}
                        className={`w-full px-3 py-2 text-left text-sm transition ${
                          index === selectedTagIndex
                            ? "bg-[#e4f1e9] text-[#275736]"
                            : "text-[#3f3227] hover:bg-[#f5ecdd]"
                        }`}
                      >
                        @{tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!activeInput && (
              <div className="flex justify-start">
                <button
                  onClick={(e) => handleAddTaskClick(allSections[0]?.id ?? "tambareni", e)}
                  className="text-sm font-bold text-[#3f3227] transition hover:border-l-2 hover:border-[#b99c6b] hover:pl-2"
                >
                  + Add task
                </button>
              </div>
            )}
            {showGroupingModal && (
              <GroupingModal
                customSections={customSections}
                onAdd={(name) => {
                  let id = slugFromName(name);
                  if (BUILT_IN_SECTION_IDS.includes(id as typeof BUILT_IN_SECTION_IDS[number])) {
                    id = `${id}-1`;
                  }
                  const existingIds = new Set([...BUILT_IN_SECTION_IDS, ...customSections.map((s) => s.id)]);
                  let base = id;
                  let n = 1;
                  while (existingIds.has(id)) {
                    id = `${base}-${n}`;
                    n++;
                  }
                  const next = [...customSections, { id, name: name.trim() || id }];
                  setCustomSections(next);
                  setCustomSectionsState(next);
                }}
                onRemove={(id) => {
                  const next = customSections.filter((s) => s.id !== id);
                  setCustomSections(next);
                  setCustomSectionsState(next);
                }}
                onClose={() => setShowGroupingModal(false)}
              />
            )}
          </div>
        )}

        {showDoneTasks ? (
          <>
            {allSections.map((section) => {
              const sectionDoneTasks = allDoneTasks.filter((t) => t.section === section.id);
              const sorted = sortDoneTasks(sectionDoneTasks);
              if (sorted.length === 0) return null;
              return (
                <section key={section.id} className="mb-12">
                  <h2 className="mb-4 font-heading text-xl font-bold text-[#3b2f25]">
                    {section.name}
                  </h2>
                  <div className="space-y-2">
                    {sorted.map((task) => (
                      <TodoistTaskCard
                        key={task.id}
                        task={task}
                        onDelete={deleteTask}
                        onDateChange={updateTaskDate}
                        onTimeChange={updateTaskTime}
                        onTagsChange={updateTaskTags}
                        onTextChange={updateTaskText}
                        onCheckboxChange={handleCheckboxChange}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            {allDoneTasks.length === 0 && (
              <p className="text-center text-[#8c7a63]">No done tasks</p>
            )}
          </>
        ) : (
          <>
            {/* Overdue Section */}
            {sortedOverdueTasks.length > 0 && (
              <section className="mb-12">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-heading text-xl font-bold text-[#3b2f25]">
                    Overdue
                  </h2>
                </div>
                <div className="space-y-2">
                  {sortedOverdueTasks.map((task) => (
                    <TodoistTaskCard
                      key={task.id}
                      task={task}
                      onDelete={deleteTask}
                      onDateChange={updateTaskDate}
                      onTimeChange={updateTaskTime}
                      onTagsChange={updateTaskTags}
                      onTextChange={updateTaskText}
                      onCheckboxChange={handleCheckboxChange}
                      formatOverdueDate={formatOverdueDate}
                      isOverdue={true}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Today Section */}
            {sortedTodayTasks.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-4 font-heading text-xl font-bold text-[#3b2f25]">
                  {formatDateHeader(todayIso)}
                </h2>
                <div className="space-y-2">
                  {sortedTodayTasks.map((task) => (
                    <TodoistTaskCard
                      key={`${task.id}-${todayIso}`}
                      task={task}
                      displayDate={todayIso}
                      onDelete={deleteTask}
                      onDateChange={updateTaskDate}
                      onTimeChange={updateTaskTime}
                      onTagsChange={updateTaskTags}
                      onTextChange={updateTaskText}
                      onCheckboxChange={handleCheckboxChange}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Tomorrow Section */}
            {sortedTomorrowTasks.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-4 font-heading text-xl font-bold text-[#3b2f25]">
                  {formatDateHeader(tomorrowIso)}
                </h2>
                <div className="space-y-2">
                  {sortedTomorrowTasks.map((task) => (
                    <TodoistTaskCard
                      key={`${task.id}-${tomorrowIso}`}
                      task={task}
                      displayDate={tomorrowIso}
                      onDelete={deleteTask}
                      onDateChange={updateTaskDate}
                      onTimeChange={updateTaskTime}
                      onTagsChange={updateTaskTags}
                      onTextChange={updateTaskText}
                      onCheckboxChange={handleCheckboxChange}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Future Dates (next daysToShow days) */}
            {futureDateSections.map(
              ({ dateKey, tasks: dateTasks }) =>
                dateTasks.length > 0 && (
                  <section key={dateKey} className="mb-12">
                    <h2 className="mb-4 font-heading text-xl font-bold text-[#3b2f25]">
                      {formatDateHeader(dateKey)}
                    </h2>
                    <div className="space-y-2">
                      {dateTasks.map((task) => (
                        <TodoistTaskCard
                          key={`${task.id}-${dateKey}`}
                          task={task}
                          displayDate={dateKey}
                          onDelete={deleteTask}
                          onDateChange={updateTaskDate}
                          onTimeChange={updateTaskTime}
                          onTagsChange={updateTaskTags}
                          onTextChange={updateTaskText}
                          onCheckboxChange={handleCheckboxChange}
                        />
                      ))}
                    </div>
                  </section>
                )
            )}

            {!hasAnyUpcoming && (
              <p className="text-center text-[#8c7a63]">No upcoming tasks</p>
            )}

            {/* See more tasks */}
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setDaysToShow((d) => d + 30)}
                className="text-sm font-semibold text-[#8c7a63] underline decoration-dotted underline-offset-4 hover:text-[#3f3227] transition"
              >
                See more tasks
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function GroupingModal({
  customSections,
  onAdd,
  onRemove,
  onClose,
}: {
  customSections: CustomSection[];
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-[#d6c2a1] bg-[#fdf8ef] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 font-heading text-lg font-bold text-[#3b2f25]">Add/remove grouping</h3>
        <p className="mb-3 text-xs text-[#8c7a63]">Custom groupings appear as new sections in the inbox and upcoming views.</p>
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New grouping name"
            className="flex-1 rounded-xl border border-[#d0c0a0] bg-white px-3 py-2 text-sm text-[#3f3227] outline-none focus:border-[#a67a45]"
            onKeyDown={(e) => e.key === "Enter" && (onAdd(newName), setNewName(""))}
          />
          <button
            type="button"
            onClick={() => {
              if (newName.trim()) {
                onAdd(newName.trim());
                setNewName("");
              }
            }}
            className="rounded-xl bg-[#3f3227] px-3 py-2 text-sm font-semibold text-[#f4efe6] transition hover:bg-[#2f2220]"
          >
            Add
          </button>
        </div>
        {customSections.length > 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-semibold text-[#8c7a63]">Custom groupings</p>
            {customSections.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-[#d0c0a0] bg-white px-3 py-2">
                <span className="text-sm text-[#3f3227]">{s.name}</span>
                <button
                  type="button"
                  onClick={() => onRemove(s.id)}
                  className="text-xs font-semibold text-[#8c7a63] underline hover:text-[#a7342d]"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl border border-[#cabb9b] py-2 text-sm font-semibold text-[#3f3227] hover:bg-[#f5ecdd]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// Task Card matching TodoistTaskCard from todo inbox
function TodoistTaskCard({
  task,
  displayDate,
  onDelete,
  onDateChange,
  onTimeChange,
  onTagsChange,
  onTextChange,
  onCheckboxChange,
  formatOverdueDate,
  isOverdue = false,
}: {
  task: Task;
  displayDate?: string;
  onDelete: (taskId: string) => void;
  onDateChange: (taskId: string, date: string | undefined) => void;
  onTimeChange: (taskId: string, time: string | undefined) => void;
  onTagsChange: (taskId: string, tags: string[]) => void;
  onTextChange: (taskId: string, text: string) => void;
  onCheckboxChange: (task: Task, checked: boolean, displayDate?: string) => void;
  formatOverdueDate?: (iso: string) => string;
  isOverdue?: boolean;
}) {
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [editDate, setEditDate] = useState(task.date || "");
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [editTime, setEditTime] = useState(task.time || "");
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [editTags, setEditTags] = useState(task.tags.join(", "));
  const [isEditingText, setIsEditingText] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [isHovered, setIsHovered] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const isDoneNormally =
    (task.section === "tambareni" && task.status === "done") ||
    (task.section !== "tambareni" && task.tags.includes("done"));
  const isDoneRecurringForDay =
    displayDate &&
    task.recurringDays?.length &&
    (task.recurringCompletedDates ?? []).includes(displayDate);
  const isDone: boolean =
    displayDate && task.recurringDays?.length ? Boolean(isDoneRecurringForDay) : isDoneNormally;

  useEffect(() => {
    if (isDoneNormally && isAnimatingOut) {
      setIsAnimatingOut(false);
    }
  }, [task.tags, task.status, task.section, isAnimatingOut, isDoneNormally]);

  const handleCheckboxChange = (checked: boolean) => {
    if (checked) {
      if (!isDone) {
        onCheckboxChange(task, true, displayDate);
        if (!displayDate || !task.recurringDays?.length) {
          setIsAnimatingOut(true);
          setTimeout(() => setIsAnimatingOut(false), 500);
        }
      }
    } else {
      setIsAnimatingOut(false);
      onCheckboxChange(task, false, displayDate);
    }
  };

  // Get urgency display for tambareni tasks
  const urgencyDisplay = task.section === "tambareni" && task.urgency ? (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        task.urgency === "high"
          ? "bg-[#fee2e2] text-[#991b1b]"
          : task.urgency === "medium"
            ? "bg-[#fef3c7] text-[#92400e]"
            : "bg-[#dbeafe] text-[#1e40af]"
      }`}
    >
      {task.urgency}
    </span>
  ) : null;

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        relative flex items-start gap-3 rounded-xl border p-3 transition-all duration-200
        ${
          isAnimatingOut
            ? "opacity-0 scale-[0.98] blur-sm pointer-events-none"
            : isDone
              ? "border-[#3f6b4a]/30 bg-[#e4f1e9]/30 opacity-75"
              : isHovered
                ? "border-[#b99c6b] bg-[#fdf8ef] shadow-md"
                : "border-[#d0c0a0] bg-[#fffbf8]"
        }
      `}
      style={{
        transition: isAnimatingOut
          ? "opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), filter 0.5s cubic-bezier(0.4, 0, 0.2, 1)"
          : undefined,
      }}
    >
      <div className="mt-0.5 relative">
        <div className="relative">
          <SatisfyingCheckbox
            checked={isDone}
            onChange={handleCheckboxChange}
          />
          {!isDone && isHovered && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ width: '28px', height: '28px' }}>
              <svg
                className="h-4 w-4 text-[#3f6b4a] opacity-60"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1">
        {isEditingText ? (
          <input
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full rounded border border-[#d0c0a0] bg-white px-2 py-1 text-sm text-[#3f3227]"
            onBlur={() => {
              onTextChange(task.id, editText);
              setIsEditingText(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onTextChange(task.id, editText);
                setIsEditingText(false);
              } else if (e.key === "Escape") {
                setEditText(task.text);
                setIsEditingText(false);
              }
            }}
            autoFocus
          />
        ) : (
          <p
            className={`
              text-sm transition-all duration-300 cursor-pointer hover:opacity-80
              ${
                isDone
                  ? "text-[#8c7a63] line-through decoration-[#3f6b4a] decoration-2"
                  : "text-[#3f3227]"
              }
            `}
            onClick={() => setIsEditingText(true)}
          >
            {task.text}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Section tag - always show first */}
          {task.section && (
            <span
              className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-xs text-[#1e3a8a]"
            >
              @{task.section === "tambareni" ? "tambareni careers" : task.section}
            </span>
          )}
          {urgencyDisplay && (
            <>{urgencyDisplay}</>
          )}
          {task.tags.length > 0 && !isEditingTags && (
            <div className="flex flex-wrap gap-1">
              {task.tags
                .filter((tag) => {
                  const tagLower = tag.toLowerCase();
                  const statusTags = ["done", "doing", "todo", "completed", "finished", "inprogress", "wip", "pending"];
                  const urgencyTags = ["high", "medium", "low"];
                  return !statusTags.includes(tagLower) && !urgencyTags.includes(tagLower);
                })
                .map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[#e4f1e9] px-2 py-0.5 text-xs text-[#275736]"
                  >
                    @{tag}
                  </span>
                ))}
            </div>
          )}
          {task.date && !isEditingDate && (
            <span className="text-xs">
              <button
                type="button"
                onClick={() => {
                  setEditDate(task.date || "");
                  setIsEditingDate(true);
                  setTimeout(() => {
                    if (dateInputRef.current) {
                      try {
                        dateInputRef.current.showPicker?.();
                      } catch {
                        dateInputRef.current.click();
                      }
                    }
                  }, 50);
                }}
                className="hover:opacity-80 cursor-pointer"
              >
                <span className={formatRelativeDate(task.date, task.time).color}>
                  📅 {isOverdue && formatOverdueDate ? `Due ${formatOverdueDate(task.date)}` : formatRelativeDate(task.date, task.time).label}
                </span>
              </button>
              {task.time && (
                <span className="ml-1 text-[#8c7a63]">
                  {formatTime12Hour(task.time)}
                </span>
              )}
            </span>
          )}
          {isEditingDate && (
            <input
              ref={dateInputRef}
              data-task-id={task.id}
              type="date"
              value={editDate}
              onChange={(e) => {
                setEditDate(e.target.value);
                if (e.target.value) {
                  onDateChange(task.id, e.target.value || undefined);
                  setIsEditingDate(false);
                }
              }}
              className="rounded border border-[#d0c0a0] bg-white px-1.5 py-0.5 text-xs w-28"
              onBlur={() => {
                onDateChange(task.id, editDate || undefined);
                setIsEditingDate(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onDateChange(task.id, editDate || undefined);
                  setIsEditingDate(false);
                } else if (e.key === "Escape") {
                  setEditDate(task.date || "");
                  setIsEditingDate(false);
                }
              }}
              autoFocus
            />
          )}
        </div>
      </div>
      <div className={`flex items-start gap-2 transition-opacity duration-200 ${isHovered ? "opacity-100" : "opacity-0"}`}>
        <button
          onClick={() => {
            setEditTags(task.tags.join(", "));
            setIsEditingTags(true);
          }}
          className="text-sm text-[#8c7a63] hover:text-[#3f6b4a] transition"
          title="Edit tags"
        >
          🏷️
        </button>
        {!task.date && !isEditingDate && (
          <button
            onClick={() => {
              setEditDate("");
              setIsEditingDate(true);
              setTimeout(() => {
                dateInputRef.current?.showPicker?.() || dateInputRef.current?.click();
              }, 0);
            }}
            className="text-sm text-[#8c7a63] hover:text-[#3f6b4a] transition"
            title="Add date"
          >
            📅
          </button>
        )}
        {task.date && (
          <>
            {isEditingTime ? (
              <input
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="rounded border border-[#d0c0a0] bg-white px-1.5 py-0.5 text-xs w-20"
                onBlur={() => {
                  onTimeChange(task.id, editTime || undefined);
                  setIsEditingTime(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onTimeChange(task.id, editTime || undefined);
                    setIsEditingTime(false);
                  } else if (e.key === "Escape") {
                    setEditTime(task.time || "");
                    setIsEditingTime(false);
                  }
                }}
                autoFocus
              />
            ) : (
              <button
                onClick={() => {
                  setEditTime(task.time || "");
                  setIsEditingTime(true);
                }}
                className="text-sm text-[#8c7a63] hover:text-[#3f6b4a] transition"
                title={task.time ? "Edit time" : "Add time"}
              >
                🕐
              </button>
            )}
          </>
        )}
        <button
          onClick={() => onDelete(task.id)}
          className="text-sm text-[#8c7a63] hover:text-[#a7342d] transition"
        >
          ×
        </button>
      </div>
      {isEditingDate && !task.date && (
        <div className="mt-2">
          <input
            ref={dateInputRef}
            data-task-id={task.id}
            type="date"
            value={editDate}
            onChange={(e) => {
              setEditDate(e.target.value);
              if (e.target.value) {
                onDateChange(task.id, e.target.value || undefined);
                setIsEditingDate(false);
              }
            }}
            className="rounded border border-[#d0c0a0] bg-white px-1.5 py-0.5 text-xs w-28"
            onBlur={() => {
              onDateChange(task.id, editDate || undefined);
              setIsEditingDate(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onDateChange(task.id, editDate || undefined);
                setIsEditingDate(false);
              } else if (e.key === "Escape") {
                setEditDate("");
                setIsEditingDate(false);
              }
            }}
            autoFocus
          />
        </div>
      )}
      {isEditingTags && (
        <div className="absolute inset-0 z-10 flex items-center gap-2 rounded-xl bg-[#fdf8ef] p-3 shadow-lg">
          <input
            type="text"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder="Tags (comma separated)"
            className="flex-1 rounded border border-[#d0c0a0] bg-white px-2 py-1 text-xs"
            onBlur={() => {
              const tags = editTags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              onTagsChange(task.id, tags);
              setIsEditingTags(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const tags = editTags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean);
                onTagsChange(task.id, tags);
                setIsEditingTags(false);
              } else if (e.key === "Escape") {
                setEditTags(task.tags.join(", "));
                setIsEditingTags(false);
              }
            }}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
