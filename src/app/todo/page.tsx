"use client";

import { useState, useEffect, useRef, useMemo, KeyboardEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Task, TaskStatus, Urgency } from "@/types/todo";
import { parseNaturalDate, extractTags, cleanTaskText } from "@/lib/date-parser";
import { getISODateString, formatDisplayDate, formatRelativeDate, toDateFromISO, differenceInDays } from "@/lib/date-utils";
import { parseNaturalTime, formatTime12Hour } from "@/lib/time-parser";
import {
  getCustomSections,
  getTagMemoryKey,
  CUSTOM_SECTIONS_KEY,
  BUILT_IN_SECTION_IDS,
  BUILT_IN_SECTION_NAMES,
} from "@/lib/todo-sections";
import HighlightedInput from "@/components/HighlightedInput";
import SatisfyingCheckbox from "@/components/SatisfyingCheckbox";

const TODO_STORAGE_KEY = "lifeTodo_tasks";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function TodoPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [customSections, setCustomSectionsState] = useState<{ id: string; name: string }[]>([]);
  const [activeInput, setActiveInput] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagDropdownPosition, setTagDropdownPosition] = useState({ top: 0, left: 0 });
  const [selectedTagIndex, setSelectedTagIndex] = useState(0);
  const [showDoneBySection, setShowDoneBySection] = useState<Record<string, boolean>>({});
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "error">("idle");
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [recurringDaysDraft, setRecurringDaysDraft] = useState<number[]>([]);
  const [showRecurringPicker, setShowRecurringPicker] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const recurringPickerRef = useRef<HTMLDivElement>(null);
  const sectionRefsMap = useRef<Record<string, React.RefObject<HTMLInputElement | null>>>({});
  const inputRefs = {
    tambareni: useRef<HTMLInputElement>(null),
  };
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  const getInputRef = (sectionId: string): React.RefObject<HTMLInputElement | null> => {
    if (sectionId === "tambareni") return inputRefs.tambareni;
    if (!sectionRefsMap.current[sectionId]) sectionRefsMap.current[sectionId] = { current: null };
    return sectionRefsMap.current[sectionId];
  };
  const focusInput = (sectionId: string) => {
    getInputRef(sectionId).current?.focus();
  };
  const getInputEl = (sectionId: string): HTMLInputElement | null =>
    getInputRef(sectionId).current ?? null;

  const builtInSections = useMemo(
    () => BUILT_IN_SECTION_IDS.map((id) => ({ id, name: BUILT_IN_SECTION_NAMES[id] ?? id })),
    []
  );
  const allSections = useMemo(() => [...builtInSections, ...customSections], [builtInSections, customSections]);
  const todoistSectionIds = useMemo(() => allSections.filter((s) => s.id !== "tambareni"), [allSections]);

  useEffect(() => {
    setCustomSectionsState(getCustomSections());
  }, []);

  // Load tasks from localStorage and remote
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(TODO_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Task[];
        setTasks(parsed);
      } catch (error) {
        console.error("Failed to parse tasks", error);
      }
    }
    setIsLoaded(true);
  }, []);

  // Load from remote on mount
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

  // Listen for storage changes (from other tabs/pages and same tab)
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
      if (e.key === CUSTOM_SECTIONS_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as { id: string; name: string }[];
          setCustomSectionsState(Array.isArray(parsed) ? parsed : []);
        } catch {
          // ignore
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

  // Save tasks to localStorage (backup - update functions handle events)
  useEffect(() => {
    if (!isLoaded) return;
    window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(tasks));
    
    const sectionIds = allSections.map((s) => s.id);
    const tagsBySection: Record<string, Set<string>> = {};
    sectionIds.forEach((id) => { tagsBySection[id] = new Set<string>(); });
    tasks.forEach((task) => {
      if (!tagsBySection[task.section]) tagsBySection[task.section] = new Set<string>();
      task.tags.forEach((tag) => tagsBySection[task.section].add(tag.toLowerCase()));
    });
    sectionIds.forEach((id) => {
      window.localStorage.setItem(getTagMemoryKey(id), JSON.stringify(Array.from(tagsBySection[id] ?? [])));
    });
  }, [tasks, isLoaded, allSections]);

  // Sync tasks to remote (Supabase)
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
    }, 600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [tasks, isLoaded, remoteEnabled]);

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

  // Extract status from text for tambareni section (checks @done, @doing, @todo and keywords)
  const extractStatus = (text: string): TaskStatus | undefined => {
    const textLower = text.toLowerCase();
    // Check for @status tags first
    if (/@(done|completed|finished)\b/.test(textLower)) {
      return "done";
    }
    if (/@(doing|in.?progress|working.?on|wip)\b/.test(textLower)) {
      return "doing";
    }
    if (/@(todo|to.?do|pending)\b/.test(textLower)) {
      return "todo";
    }
    // Check for status keywords (without @)
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

  // Extract urgency from text (checks @high, @medium, @low)
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

    setTasks((prev) => {
      const updated = [...prev, newTask];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent("todoStorageChange", { detail: updated }));
      }
      return updated;
    });
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
          : rememberedTags; // Show all tags if just "@" is typed
        
        setTagSuggestions(filtered);
        setShowTagDropdown(filtered.length > 0 && rememberedTags.length > 0);
        setSelectedTagIndex(0);
      
        // Position dropdown near cursor
        const input = e.target;
        const rect = input.getBoundingClientRect();
        // Better approximation: use a fixed width per character
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
        // Complete tag detected, hide dropdown
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
            // Move cursor after the tag
            setTimeout(() => {
              const input = getInputEl(sectionId);
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
      const status = sectionId === "tambareni" ? "todo" : undefined;
      createTask(inputValue, sectionId, status);
    } else if (e.key === "Escape") {
      setActiveInput(null);
      setInputValue("");
      setShowTagDropdown(false);
      setShowRecurringPicker(false);
    }
  };

  const handleAddTaskClick = (sectionId: string) => {
    if (activeInput === sectionId) return;
    setActiveInput(sectionId);
    setInputValue("");
    setTimeout(() => focusInput(sectionId), 0);
  };

  const handleInputBlur = (_sectionId: string) => {
    setTimeout(() => {
      if (!inputValue.trim()) {
        setActiveInput(null);
        setInputValue("");
      }
      setShowTagDropdown(false);
    }, 200);
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
      // Focus back on input
      setTimeout(() => {
        const input = getInputEl(activeInput || "tambareni");
        if (input) {
          input.focus();
          const cursorPos = beforeAt.length + 1 + tag.length + (afterTag ? 1 : 0);
          input.setSelectionRange(cursorPos, cursorPos);
        }
      }, 0);
    }
  };

  const updateTaskStatus = (taskId: string, newStatus: TaskStatus) => {
    setTasks((prev) => {
      const updated = prev.map((task) =>
        task.id === taskId ? { ...task, status: newStatus } : task
      );
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

  const updateTaskUrgency = (taskId: string, urgency: Urgency | undefined) => {
    setTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, urgency } : task))
    );
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

  // Sort tasks by date (earliest first, no date at end), then by time, then by createdAt
  const sortTasksByDate = (taskList: Task[]): Task[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return [...taskList].sort((a, b) => {
      // Tasks without dates go to the end
      if (!a.date && !b.date) {
        // If both have no date, sort by time, then createdAt
        if (a.time && b.time) {
          const timeCompare = a.time.localeCompare(b.time);
          if (timeCompare !== 0) return timeCompare;
        }
        if (a.time && !b.time) return -1;
        if (!a.time && b.time) return 1;
        return (a.createdAt || "").localeCompare(b.createdAt || "");
      }
      if (!a.date) return 1;
      if (!b.date) return -1;
      
      // Compare dates
      const dateA = toDateFromISO(a.date!);
      dateA.setHours(0, 0, 0, 0);
      const dateB = toDateFromISO(b.date!);
      dateB.setHours(0, 0, 0, 0);
      
      const dateCompare = dateA.getTime() - dateB.getTime();
      if (dateCompare !== 0) return dateCompare;
      
      // If same date, sort by time, then createdAt
      if (a.time && b.time) {
        const timeCompare = a.time.localeCompare(b.time);
        if (timeCompare !== 0) return timeCompare;
      }
      if (a.time && !b.time) return -1;
      if (!a.time && b.time) return 1;
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
  };

  const tambareniTasks = sortTasksByDate(tasks.filter((t) => t.section === "tambareni"));
  
  return (
    <main className="min-h-screen bg-[#f4f0e6] py-8 text-[#2f2820]">
      <div className="mx-auto w-full max-w-7xl px-4">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-heading text-4xl font-bold text-[#3b2f25]">
            To-Do Inbox
          </h1>
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
                router.push("/todo/upcoming");
              }}
              className="text-sm font-semibold text-[#8c7a63] underline decoration-dotted underline-offset-4 hover:text-[#3f3227] transition"
            >
              Show Upcoming
            </button>
          </div>
        </div>

        {/* Tambareni Careers - Board View */}
        <section id="tambareni-careers" className="mb-12 scroll-mt-8">
          <h2 className="mb-4 font-heading text-2xl font-bold text-[#3b2f25]">
            Tambareni Careers
          </h2>
          <BoardView
            tasks={tambareniTasks}
            onStatusChange={updateTaskStatus}
            onDelete={deleteTask}
            onDateChange={updateTaskDate}
            onTimeChange={updateTaskTime}
            onTextChange={updateTaskText}
            onTagsChange={updateTaskTags}
            onAddTask={() => handleAddTaskClick("tambareni")}
            isInputActive={activeInput === "tambareni"}
            inputValue={inputValue}
            onInputChange={(e) => handleInputChange(e, "tambareni")}
            onKeyDown={(e) => handleKeyDown(e, "tambareni")}
            inputRef={inputRefs.tambareni}
            showTagDropdown={showTagDropdown && activeInput === "tambareni"}
            tagSuggestions={tagSuggestions}
            selectedTagIndex={selectedTagIndex}
            tagDropdownPosition={tagDropdownPosition}
            onTagSelect={handleTagSelect}
            tagDropdownRef={tagDropdownRef}
            recurringDays={recurringDaysDraft}
            onRecurringDaysChange={setRecurringDaysDraft}
            showRecurringPicker={showRecurringPicker}
            onRecurringPickerToggle={() => setShowRecurringPicker((v) => !v)}
            recurringPickerRef={recurringPickerRef}
          />
        </section>

        {todoistSectionIds.map((section) => {
          const sectionTasks = sortTasksByDate(tasks.filter((t) => t.section === section.id));
          const sectionActiveTasks = sectionTasks.filter((t) => !t.tags.includes("done"));
          const sectionDoneTasks = sectionTasks.filter((t) => t.tags.includes("done"));
          const showDone = showDoneBySection[section.id] ?? false;
          return (
            <section key={section.id} id={section.id} className="mb-12 scroll-mt-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-2xl font-bold text-[#3b2f25]">{section.name}</h2>
                <button
                  onClick={() => setShowDoneBySection((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                  className="text-sm font-semibold text-[#8c7a63] underline decoration-dotted underline-offset-4 hover:text-[#3f3227] transition"
                >
                  {showDone
                    ? `Show To-Do${sectionActiveTasks.length > 0 ? ` (${sectionActiveTasks.length})` : ""}`
                    : `Show Done${sectionDoneTasks.length > 0 ? ` (${sectionDoneTasks.length})` : ""}`}
                </button>
              </div>
              <TodoistView
                tasks={showDone ? sectionDoneTasks : sectionActiveTasks}
                onDelete={deleteTask}
                onDateChange={updateTaskDate}
                onTimeChange={updateTaskTime}
                onTagsChange={updateTaskTags}
                onTextChange={updateTaskText}
                onCheckboxChange={(task, checked) => {
                  if (task.recurringDays?.length && checked) {
                    deleteTask(task.id);
                  } else {
                    updateTaskTags(task.id, checked ? [...task.tags, "done"] : task.tags.filter((t) => t !== "done"));
                  }
                }}
                onAddTask={() => handleAddTaskClick(section.id)}
                isInputActive={activeInput === section.id}
                inputValue={inputValue}
                onInputChange={(e) => handleInputChange(e, section.id)}
                onKeyDown={(e) => handleKeyDown(e, section.id)}
                inputRef={getInputRef(section.id)}
                section={section.id}
                onBlur={() => handleInputBlur(section.id)}
                showTagDropdown={showTagDropdown && activeInput === section.id}
                tagSuggestions={tagSuggestions}
                selectedTagIndex={selectedTagIndex}
                tagDropdownPosition={tagDropdownPosition}
                onTagSelect={handleTagSelect}
                tagDropdownRef={tagDropdownRef}
                recurringDays={recurringDaysDraft}
                onRecurringDaysChange={setRecurringDaysDraft}
                showRecurringPicker={showRecurringPicker}
                onRecurringPickerToggle={() => setShowRecurringPicker((v) => !v)}
                recurringPickerRef={recurringPickerRef}
              />
            </section>
          );
        })}
      </div>
    </main>
  );
}

// Board View Component (for Tambareni Careers)
function BoardView({
  tasks,
  onStatusChange,
  onDelete,
  onDateChange,
  onTimeChange,
  onTextChange,
  onTagsChange,
  onAddTask,
  isInputActive,
  inputValue,
  onInputChange,
  onKeyDown,
  inputRef,
  showTagDropdown,
  tagSuggestions,
  selectedTagIndex,
  tagDropdownPosition,
  onTagSelect,
  tagDropdownRef,
  recurringDays,
  onRecurringDaysChange,
  showRecurringPicker,
  onRecurringPickerToggle,
  recurringPickerRef,
}: {
  tasks: Task[];
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
  onDateChange: (taskId: string, date: string | undefined) => void;
  onTimeChange?: (taskId: string, time: string | undefined) => void;
  onTextChange?: (taskId: string, text: string) => void;
  onTagsChange?: (taskId: string, tags: string[]) => void;
  onAddTask: () => void;
  isInputActive: boolean;
  inputValue: string;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  showTagDropdown: boolean;
  tagSuggestions: string[];
  selectedTagIndex: number;
  tagDropdownPosition: { top: number; left: number };
  onTagSelect: (tag: string) => void;
  tagDropdownRef: React.RefObject<HTMLDivElement | null>;
  recurringDays: number[];
  onRecurringDaysChange: (days: number[]) => void;
  showRecurringPicker: boolean;
  onRecurringPickerToggle: () => void;
  recurringPickerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const columns: { status: TaskStatus; label: string }[] = [
    { status: "todo", label: "To Do" },
    { status: "doing", label: "Doing" },
    { status: "done", label: "Done" },
  ];

  const [draggedTask, setDraggedTask] = useState<string | null>(null);

  const handleDragStart = (taskId: string) => {
    setDraggedTask(taskId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault();
    if (draggedTask) {
      onStatusChange(draggedTask, targetStatus);
      setDraggedTask(null);
    }
  };

  return (
    <div className="rounded-3xl border border-[#d6c2a1] bg-[#f9f3e7] p-4 shadow-[0_14px_32px_rgba(47,38,32,0.08)]">
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3 items-start">
        {columns.map((column) => {
          const columnTasks = tasks.filter((t) => t.status === column.status);
          
          // Group tasks by urgency field
          const highTasks = columnTasks.filter((t) => t.urgency === "high");
          const mediumTasks = columnTasks.filter((t) => t.urgency === "medium");
          const lowTasks = columnTasks.filter((t) => t.urgency === "low");
          
          const urgencySections = [
            { urgency: "high", label: "High", tasks: highTasks },
            { urgency: "medium", label: "Medium", tasks: mediumTasks },
            { urgency: "low", label: "Low", tasks: lowTasks },
          ];
          
          return (
            <div
              key={column.status}
              className="h-auto rounded-2xl border border-[#d6c2a1] bg-[#fbf6ec] p-4"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.status)}
            >
              <h3 className="mb-3 font-heading text-lg text-[#3b2f25]">
                {column.label}
              </h3>
              <div className="space-y-4">
                {urgencySections.map((section) => (
                  <div key={section.urgency} className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[#8c7a63]">
                      {section.label}
                    </h4>
                    {section.tasks.length > 0 ? (
                      section.tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onStatusChange={onStatusChange}
                          onDelete={onDelete}
                          onDateChange={onDateChange}
                          onTimeChange={onTimeChange || (() => {})}
                          onTextChange={onTextChange || (() => {})}
                          onTagsChange={onTagsChange}
                          onDragStart={handleDragStart}
                          isDragging={draggedTask === task.id}
                        />
                      ))
                    ) : (
                      <p className="py-2 text-center text-xs text-[#8c7a63]">
                        No tasks
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {isInputActive ? (
        <div className="relative">
          <div className="flex w-full items-center gap-1 rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-4 py-0.5 text-xs text-[#3f3227] focus-within:border-[#a67a45] focus-within:outline-none focus-within:ring-0">
            <div className="min-w-0 flex-1">
              <HighlightedInput
                value={inputValue}
                onChange={onInputChange}
                onKeyDown={onKeyDown}
                placeholder="Enter task... (e.g., 'Fix bug today @urgent')"
                className="w-full bg-transparent outline-none leading-none"
                autoFocus
                inputRef={inputRef}
              />
            </div>
            <div ref={recurringPickerRef} className="relative flex shrink-0 items-center">
              <button
                type="button"
                onClick={onRecurringPickerToggle}
                className={`rounded-lg p-1.5 transition ${
                  recurringDays.length > 0
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
                <div
                  className="absolute right-0 top-full z-50 mt-1 flex flex-col gap-1 rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] p-2 shadow-lg"
                >
                  <span className="text-xs font-semibold text-[#3f3227]">Repeat on</span>
                  <div className="flex flex-wrap gap-1">
                    {DAY_NAMES.map((name, dayIndex) => {
                      const selected = recurringDays.includes(dayIndex);
                      return (
                        <button
                          key={dayIndex}
                          type="button"
                          onClick={() => {
                            if (selected) {
                              onRecurringDaysChange(recurringDays.filter((d) => d !== dayIndex));
                            } else {
                              onRecurringDaysChange([...recurringDays, dayIndex].sort((a, b) => a - b));
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
                  {recurringDays.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onRecurringDaysChange([])}
                      className="mt-1 text-xs text-[#8c7a63] underline hover:text-[#3f3227]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {showTagDropdown && tagSuggestions.length > 0 && (
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
                  onClick={() => onTagSelect(tag)}
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
      ) : (
        <div className="flex justify-start">
          <button
            onClick={onAddTask}
            className="text-sm font-bold text-[#3f3227] transition hover:border-l-2 hover:border-[#b99c6b] hover:pl-2"
          >
            + Add task
          </button>
        </div>
      )}
    </div>
  );
}

// Todoist View Component (for School and Recruiting)
function TodoistView({
  tasks,
  onDelete,
  onDateChange,
  onTimeChange,
  onTagsChange,
  onTextChange,
  onCheckboxChange,
  onAddTask,
  isInputActive,
  inputValue,
  onInputChange,
  onKeyDown,
  inputRef,
  section,
  onBlur,
  showTagDropdown,
  tagSuggestions,
  selectedTagIndex,
  tagDropdownPosition,
  onTagSelect,
  tagDropdownRef,
  recurringDays,
  onRecurringDaysChange,
  showRecurringPicker,
  onRecurringPickerToggle,
  recurringPickerRef,
}: {
  tasks: Task[];
  onDelete: (taskId: string) => void;
  onDateChange: (taskId: string, date: string | undefined) => void;
  onTimeChange: (taskId: string, time: string | undefined) => void;
  onTagsChange: (taskId: string, tags: string[]) => void;
  onTextChange: (taskId: string, text: string) => void;
  onCheckboxChange?: (task: Task, checked: boolean) => void;
  onAddTask: () => void;
  isInputActive: boolean;
  inputValue: string;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  section: string;
  onBlur: () => void;
  showTagDropdown: boolean;
  tagSuggestions: string[];
  selectedTagIndex: number;
  tagDropdownPosition: { top: number; left: number };
  onTagSelect: (tag: string) => void;
  tagDropdownRef: React.RefObject<HTMLDivElement | null>;
  recurringDays: number[];
  onRecurringDaysChange: (days: number[]) => void;
  showRecurringPicker: boolean;
  onRecurringPickerToggle: () => void;
  recurringPickerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="rounded-3xl border border-[#d6c2a1] bg-[#f9f3e7] p-4 shadow-[0_14px_32px_rgba(47,38,32,0.08)]">
      <div className="mb-4 space-y-2">
        {tasks.map((task) => (
          <TodoistTaskCard
            key={task.id}
            task={task}
            onDelete={onDelete}
            onDateChange={onDateChange}
            onTimeChange={onTimeChange}
            onTagsChange={onTagsChange}
            onTextChange={onTextChange}
            onCheckboxChange={onCheckboxChange}
            section={section}
          />
        ))}
        {tasks.length === 0 && (
          <p className="py-4 text-center text-sm text-[#8c7a63]">
            No tasks yet. Add one below!
          </p>
        )}
      </div>
      {isInputActive ? (
        <div className="relative">
          <div className="flex w-full items-center gap-1 rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-4 py-0.5 text-sm text-[#3f3227] focus-within:border-[#a67a45] focus-within:outline-none focus-within:ring-0">
            <div className="min-w-0 flex-1">
              <HighlightedInput
                value={inputValue}
                onChange={onInputChange}
                onKeyDown={onKeyDown}
                placeholder="Enter task... (e.g., 'Study for exam tomorrow @math')"
                className="w-full bg-transparent outline-none leading-tight"
                autoFocus
                inputRef={inputRef as React.RefObject<HTMLInputElement | null>}
              />
            </div>
            <div ref={recurringPickerRef} className="relative flex shrink-0 items-center">
              <button
                type="button"
                onClick={onRecurringPickerToggle}
                className={`rounded-lg p-1.5 transition ${
                  recurringDays.length > 0
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
                <div
                  className="absolute right-0 top-full z-50 mt-1 flex flex-col gap-1 rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] p-2 shadow-lg"
                >
                  <span className="text-xs font-semibold text-[#3f3227]">Repeat on</span>
                  <div className="flex flex-wrap gap-1">
                    {DAY_NAMES.map((name, dayIndex) => {
                      const selected = recurringDays.includes(dayIndex);
                      return (
                        <button
                          key={dayIndex}
                          type="button"
                          onClick={() => {
                            if (selected) {
                              onRecurringDaysChange(recurringDays.filter((d) => d !== dayIndex));
                            } else {
                              onRecurringDaysChange([...recurringDays, dayIndex].sort((a, b) => a - b));
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
                  {recurringDays.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onRecurringDaysChange([])}
                      className="mt-1 text-xs text-[#8c7a63] underline hover:text-[#3f3227]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {showTagDropdown && tagSuggestions.length > 0 && (
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
                  onClick={() => onTagSelect(tag)}
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
      ) : (
        <div className="flex justify-start">
          <button
            onClick={onAddTask}
            className="text-sm font-bold text-[#3f3227] transition hover:border-l-2 hover:border-[#b99c6b] hover:pl-2"
          >
            + Add task
          </button>
        </div>
      )}
    </div>
  );
}

// Task Card for Board View
function TaskCard({
  task,
  onStatusChange,
  onDelete,
  onDateChange,
  onTimeChange,
  onTextChange,
  onTagsChange,
  onDragStart,
  isDragging,
}: {
  task: Task;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
  onDateChange: (taskId: string, date: string | undefined) => void;
  onTimeChange: (taskId: string, time: string | undefined) => void;
  onTextChange: (taskId: string, text: string) => void;
  onTagsChange?: (taskId: string, tags: string[]) => void;
  onDragStart: (taskId: string) => void;
  isDragging: boolean;
}) {
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [editDate, setEditDate] = useState(task.date || "");
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [editTime, setEditTime] = useState(task.time || "");
  const [isEditingText, setIsEditingText] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [editTags, setEditTags] = useState(task.tags.join(", "));
  const [isHovered, setIsHovered] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Check if task has no metadata (no date, time, or tags) and not editing anything
  const hasNoMetadata = !task.date && !task.time && task.tags.length === 0 && 
    !isEditingTags && !isEditingDate && !isEditingTime && !isEditingText;

  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-move rounded-xl border p-3 transition-all duration-200 ${
        isDragging 
          ? "opacity-50" 
          : isHovered
            ? "border-[#b99c6b] bg-[#fdf8ef] shadow-md"
            : "border-[#d0c0a0] bg-[#fffbf8]"
      } ${hasNoMetadata ? "flex items-center" : ""}`}
    >
      <div className={`${hasNoMetadata ? "flex items-center justify-between gap-2 w-full" : "mb-2 flex items-start justify-between gap-2"}`}>
        <div className="flex items-center gap-2 flex-1">
          {isEditingText ? (
            <input
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="flex-1 rounded border border-[#d0c0a0] bg-white px-2 py-1 text-xs"
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
              className="flex-1 text-sm text-[#3f3227] cursor-pointer hover:opacity-80"
              onClick={() => setIsEditingText(true)}
            >
              {task.text}
            </p>
          )}
        </div>
        <div className={`flex items-center gap-1 transition-opacity duration-200 ${isHovered ? "opacity-100" : "opacity-0"}`}>
          {isEditingDate && !task.date && (
            <input
              ref={dateInputRef}
              data-task-id={task.id}
              type="date"
              value={editDate}
              onChange={(e) => {
                setEditDate(e.target.value);
                if (e.target.value) {
                  // If a date was selected, save it and exit edit mode
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
          {!isEditingDate && (
            <>
              {onTagsChange && (
                <button
                  onClick={() => {
                    setEditTags(task.tags.join(", "));
                    setIsEditingTags(true);
                  }}
                  className="text-xs text-[#8c7a63] hover:text-[#3f6b4a] transition"
                  title="Edit tags"
                >
                  🏷️
                </button>
              )}
              {!task.date && (
                <button
                  onClick={() => {
                    setEditDate(task.date || "");
                    setIsEditingDate(true);
                    setTimeout(() => {
                      dateInputRef.current?.showPicker?.() || dateInputRef.current?.click();
                    }, 0);
                  }}
                  className="text-xs text-[#8c7a63] hover:text-[#3f6b4a] transition"
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
                      className="text-xs text-[#8c7a63] hover:text-[#3f6b4a] transition"
                      title={task.time ? "Edit time" : "Add time"}
                    >
                      🕐
                    </button>
                  )}
                </>
              )}
              <button
                onClick={() => onDelete(task.id)}
                className="text-xs text-[#8c7a63] hover:text-[#a7342d] transition"
              >
                ×
              </button>
            </>
          )}
        </div>
      </div>
      {task.tags.length > 0 && !isEditingTags && (
        <div className="mb-2 flex flex-wrap gap-1">
          {task.tags
            .filter((tag) => {
              // Don't show status tags (@done, @doing, @todo) or urgency tags (@high, @medium, @low) as tags
              // since they're used for status/urgency instead
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
      {isEditingTags && onTagsChange && (
        <div className="mb-2">
          <input
            type="text"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder="Tags (comma separated)"
            className="w-full rounded border border-[#d0c0a0] bg-white px-2 py-1 text-xs"
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
      {task.date && (
        <div className="flex items-center gap-2">
          {isEditingDate ? (
            <input
              ref={dateInputRef}
              data-task-id={task.id}
              type="date"
              value={editDate}
              onChange={(e) => {
                setEditDate(e.target.value);
                if (e.target.value) {
                  // If a date was selected, save it and exit edit mode
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
          ) : (
            <span className="text-xs">
              <button
                type="button"
                onClick={() => {
                  setEditDate(task.date || "");
                  setIsEditingDate(true);
                  // Focus the date input that will appear here when editing
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
                  📅 {formatRelativeDate(task.date, task.time).label}
                </span>
              </button>
              {task.time && (
                <span className="ml-1 text-[#8c7a63]">
                  {formatTime12Hour(task.time)}
                </span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Task Card for Todoist View (inbox)
function TodoistTaskCard({
  task,
  onDelete,
  onDateChange,
  onTimeChange,
  onTagsChange,
  onTextChange,
  onCheckboxChange: onCheckboxChangeProp,
  section,
}: {
  task: Task;
  onDelete: (taskId: string) => void;
  onDateChange: (taskId: string, date: string | undefined) => void;
  onTimeChange: (taskId: string, time: string | undefined) => void;
  onTagsChange: (taskId: string, tags: string[]) => void;
  onTextChange: (taskId: string, text: string) => void;
  onCheckboxChange?: (task: Task, checked: boolean) => void;
  section?: string;
}) {
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  useEffect(() => {
    if (task.tags.includes("done") && isAnimatingOut) {
      setIsAnimatingOut(false);
    }
  }, [task.tags, isAnimatingOut]);

  const handleCheckboxChange = (checked: boolean) => {
    if (onCheckboxChangeProp) {
      onCheckboxChangeProp(task, checked);
      if (task.recurringDays?.length && checked) {
        setIsAnimatingOut(true);
        setTimeout(() => setIsAnimatingOut(false), 600);
      } else if (!task.recurringDays?.length && checked && !task.tags.includes("done")) {
        setIsAnimatingOut(true);
        setTimeout(() => setIsAnimatingOut(false), 600);
      }
      return;
    }
    if (checked) {
      if (!task.tags.includes("done")) {
        setIsAnimatingOut(true);
        setTimeout(() => {
          onTagsChange(task.id, [...task.tags, "done"]);
          setTimeout(() => setIsAnimatingOut(false), 100);
        }, 600);
      }
    } else {
      setIsAnimatingOut(false);
      onTagsChange(task.id, task.tags.filter((tag) => tag !== "done"));
    }
  };
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

  const isDone = task.tags.includes("done");

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        relative flex items-start gap-3 rounded-xl border p-3 transition-all duration-200
        ${
          isAnimatingOut
            ? "pointer-events-none"
            : isDone
              ? "border-[#3f6b4a]/30 bg-[#e4f1e9]/30 opacity-75"
              : isHovered
                ? "border-[#b99c6b] bg-[#fdf8ef] shadow-md"
                : "border-[#d0c0a0] bg-[#fffbf8]"
        }
      `}
      style={{
        transition: isAnimatingOut
          ? "opacity 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.4s ease-out"
          : undefined,
        transform: isAnimatingOut
          ? "translateY(-12px) scale(1.05)"
          : undefined,
        opacity: isAnimatingOut
          ? 0
          : undefined,
        filter: isAnimatingOut
          ? "blur(4px)"
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
          {task.recurringDays?.length ? (
            <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-xs text-[#1e3a8a]">
              Recurring on {task.recurringDays.map((d) => DAY_NAMES[d]).join(", ")}
            </span>
          ) : null}
          {task.tags.length > 0 && !isEditingTags && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
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
                  // Focus the date input that will appear here when editing
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
                  📅 {formatRelativeDate(task.date, task.time).label}
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
                  // If a date was selected, save it and exit edit mode
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
                // If a date was selected, save it and exit edit mode
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
              }
            }}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

