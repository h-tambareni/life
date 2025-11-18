"use client";

import { useState, useEffect, useRef, KeyboardEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Task, TaskStatus, Urgency } from "@/types/todo";
import { parseNaturalDate, extractTags, cleanTaskText } from "@/lib/date-parser";
import { getISODateString, formatDisplayDate, formatRelativeDate, toDateFromISO, differenceInDays } from "@/lib/date-utils";
import { parseNaturalTime, formatTime12Hour } from "@/lib/time-parser";
import HighlightedInput from "@/components/HighlightedInput";
import SatisfyingCheckbox from "@/components/SatisfyingCheckbox";

const TODO_STORAGE_KEY = "lifeTodo_tasks";
const TAG_MEMORY_KEY_SCHOOL = "lifeTodo_tagMemory_school";
const TAG_MEMORY_KEY_RECRUITING = "lifeTodo_tagMemory_recruiting";
const TAG_MEMORY_KEY_TAMBARENI = "lifeTodo_tagMemory_tambareni";

export default function TodoPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeInput, setActiveInput] = useState<"tambareni" | "school" | "recruiting" | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagDropdownPosition, setTagDropdownPosition] = useState({ top: 0, left: 0 });
  const [selectedTagIndex, setSelectedTagIndex] = useState(0);
  const [showDoneTasks, setShowDoneTasks] = useState(false);
  const [showDoneTasksRecruiting, setShowDoneTasksRecruiting] = useState(false);
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "error">("idle");
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const inputRefs = {
    tambareni: useRef<HTMLInputElement>(null),
    school: useRef<HTMLInputElement>(null),
    recruiting: useRef<HTMLInputElement>(null),
  };
  const tagDropdownRef = useRef<HTMLDivElement>(null);

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
    
    // Update tag memory per section
    const schoolTags = new Set<string>();
    const recruitingTags = new Set<string>();
    const tambareniTags = new Set<string>();
    
    tasks.forEach((task) => {
      task.tags.forEach((tag) => {
        const normalizedTag = tag.toLowerCase();
        if (task.section === "school") {
          schoolTags.add(normalizedTag);
        } else if (task.section === "recruiting") {
          recruitingTags.add(normalizedTag);
        } else if (task.section === "tambareni") {
          tambareniTags.add(normalizedTag);
        }
      });
    });
    
    window.localStorage.setItem(TAG_MEMORY_KEY_SCHOOL, JSON.stringify(Array.from(schoolTags)));
    window.localStorage.setItem(TAG_MEMORY_KEY_RECRUITING, JSON.stringify(Array.from(recruitingTags)));
    window.localStorage.setItem(TAG_MEMORY_KEY_TAMBARENI, JSON.stringify(Array.from(tambareniTags)));
  }, [tasks, isLoaded]);

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

  // Get remembered tags for a specific section
  const getRememberedTags = (section: "tambareni" | "school" | "recruiting"): string[] => {
    if (typeof window === "undefined") return [];
    const key = section === "school" 
      ? TAG_MEMORY_KEY_SCHOOL 
      : section === "recruiting" 
        ? TAG_MEMORY_KEY_RECRUITING 
        : TAG_MEMORY_KEY_TAMBARENI;
    const stored = window.localStorage.getItem(key);
    const rememberedTags: string[] = [];
    if (stored) {
      try {
        rememberedTags.push(...JSON.parse(stored) as string[]);
      } catch {
        // Ignore parse errors
      }
    }
    // For tambareni section, always include urgency tags and status tags
    if (section === "tambareni") {
      const urgencyTags = ["high", "medium", "low"];
      const statusTags = ["done", "doing", "todo"];
      [...urgencyTags, ...statusTags].forEach(tag => {
        if (!rememberedTags.includes(tag)) {
          rememberedTags.push(tag);
        }
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

  const createTask = (text: string, section: "tambareni" | "school" | "recruiting", status?: TaskStatus) => {
    const date = parseNaturalDate(text);
    const time = parseNaturalTime(text);
    const tags = extractTags(text);
    
    // For tambareni section, check if status and urgency are mentioned in text
    let detectedStatus = status;
    let detectedUrgency: Urgency | undefined;
    let textToClean = text;
    
    if (section === "tambareni") {
      const extractedStatus = extractStatus(text);
      if (extractedStatus) {
        detectedStatus = extractedStatus;
        textToClean = removeStatusKeywords(textToClean);
      }
      
      // Extract urgency from @high, @medium, @low tags
      const extractedUrgency = extractUrgency(text);
      if (extractedUrgency) {
        detectedUrgency = extractedUrgency;
        // Remove urgency tags from text (but keep in tags array)
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
      section,
      status: detectedStatus || (section === "tambareni" ? "todo" : undefined),
      urgency: detectedUrgency,
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
  };

  const handleInputChange = (
    e: ChangeEvent<HTMLInputElement>,
    section: "tambareni" | "school" | "recruiting"
  ) => {
    const value = e.target.value;
    setInputValue(value);
    
    // Check for @ symbol and show tag suggestions
    const atIndex = value.lastIndexOf("@");
    if (atIndex !== -1) {
      const afterAt = value.substring(atIndex + 1);
      const spaceIndex = afterAt.indexOf(" ");
      const tagQuery = spaceIndex === -1 ? afterAt : afterAt.substring(0, spaceIndex);
      
      // Check if the @ is part of a complete tag
      // A complete tag is: @ followed by word characters, then space or end of string
      // If tagQuery is empty (just @) or has non-word characters, it's incomplete
      const isCompleteTag = tagQuery.length > 0 && /^\w+$/.test(tagQuery) && (
        spaceIndex === 0 || // Space immediately after tag
        (spaceIndex === -1 && atIndex + 1 + tagQuery.length === value.length) // End of string after tag
      );
      
      // Only show dropdown if @ is not part of a complete tag
      if (!isCompleteTag) {
        const rememberedTags = getRememberedTags(section);
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

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    section: "tambareni" | "school" | "recruiting"
  ) => {
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
              const input = inputRefs[section].current;
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
      const status = section === "tambareni" ? "todo" : undefined;
      createTask(inputValue, section, status);
    } else if (e.key === "Escape") {
      setActiveInput(null);
      setInputValue("");
      setShowTagDropdown(false);
    }
  };

  const handleAddTaskClick = (section: "tambareni" | "school" | "recruiting") => {
    if (activeInput === section) return;
    setActiveInput(section);
    setInputValue("");
    setTimeout(() => {
      inputRefs[section].current?.focus();
    }, 0);
  };

  const handleInputBlur = (section: "tambareni" | "school" | "recruiting") => {
    // Delay blur to allow Enter key to fire first and tag dropdown clicks
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
        const input = inputRefs[activeInput || "tambareni"].current;
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
  
  const schoolTasks = sortTasksByDate(tasks.filter((t) => t.section === "school"));
  const schoolActiveTasks = sortTasksByDate(schoolTasks.filter((t) => !t.tags.includes("done")));
  const schoolDoneTasks = sortTasksByDate(schoolTasks.filter((t) => t.tags.includes("done")));
  
  const recruitingTasks = sortTasksByDate(tasks.filter((t) => t.section === "recruiting"));
  const recruitingActiveTasks = sortTasksByDate(recruitingTasks.filter((t) => !t.tags.includes("done")));
  const recruitingDoneTasks = sortTasksByDate(recruitingTasks.filter((t) => t.tags.includes("done")));

  return (
    <main className="min-h-screen bg-[#f4f0e6] py-8 text-[#2f2820]">
      <div className="mx-auto w-full max-w-7xl px-4">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-heading text-4xl font-bold text-[#3b2f25]">
            To-Do Inbox
          </h1>
          <button
            onClick={() => {
              router.push("/todo/upcoming");
            }}
            className="text-sm font-semibold text-[#8c7a63] underline decoration-dotted underline-offset-4 hover:text-[#3f3227] transition"
          >
            Show Upcoming
          </button>
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
          />
        </section>

        {/* School - Todoist Format */}
        <section id="school" className="mb-12 scroll-mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-2xl font-bold text-[#3b2f25]">School</h2>
            <button
              onClick={() => setShowDoneTasks(!showDoneTasks)}
              className="text-sm font-semibold text-[#8c7a63] underline decoration-dotted underline-offset-4 hover:text-[#3f3227] transition"
            >
              {showDoneTasks
                ? `Show To-Do${schoolActiveTasks.length > 0 ? ` (${schoolActiveTasks.length})` : ""}`
                : `Show Done${schoolDoneTasks.length > 0 ? ` (${schoolDoneTasks.length})` : ""}`}
            </button>
          </div>
          <TodoistView
            tasks={showDoneTasks ? schoolDoneTasks : schoolActiveTasks}
            onDelete={deleteTask}
            onDateChange={updateTaskDate}
            onTimeChange={updateTaskTime}
            onTagsChange={updateTaskTags}
            onTextChange={updateTaskText}
            onAddTask={() => handleAddTaskClick("school")}
            isInputActive={activeInput === "school"}
            inputValue={inputValue}
            onInputChange={(e) => handleInputChange(e, "school")}
            onKeyDown={(e) => handleKeyDown(e, "school")}
            inputRef={inputRefs.school}
            section="school"
            onBlur={() => handleInputBlur("school")}
            showTagDropdown={showTagDropdown && activeInput === "school"}
            tagSuggestions={tagSuggestions}
            selectedTagIndex={selectedTagIndex}
            tagDropdownPosition={tagDropdownPosition}
            onTagSelect={handleTagSelect}
            tagDropdownRef={tagDropdownRef}
          />
        </section>

        {/* Recruiting - Todoist Format */}
        <section id="recruiting" className="mb-12 scroll-mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-2xl font-bold text-[#3b2f25]">
              Recruiting
            </h2>
            <button
              onClick={() => setShowDoneTasksRecruiting(!showDoneTasksRecruiting)}
              className="text-sm font-semibold text-[#8c7a63] underline decoration-dotted underline-offset-4 hover:text-[#3f3227] transition"
            >
              {showDoneTasksRecruiting
                ? `Show To-Do${recruitingActiveTasks.length > 0 ? ` (${recruitingActiveTasks.length})` : ""}`
                : `Show Done${recruitingDoneTasks.length > 0 ? ` (${recruitingDoneTasks.length})` : ""}`}
            </button>
          </div>
          <TodoistView
            tasks={showDoneTasksRecruiting ? recruitingDoneTasks : recruitingActiveTasks}
            onDelete={deleteTask}
            onDateChange={updateTaskDate}
            onTimeChange={updateTaskTime}
            onTagsChange={updateTaskTags}
            onTextChange={updateTaskText}
            onAddTask={() => handleAddTaskClick("recruiting")}
            isInputActive={activeInput === "recruiting"}
            inputValue={inputValue}
            onInputChange={(e) => handleInputChange(e, "recruiting")}
            onKeyDown={(e) => handleKeyDown(e, "recruiting")}
            inputRef={inputRefs.recruiting}
            section="recruiting"
            onBlur={() => handleInputBlur("recruiting")}
            showTagDropdown={showTagDropdown && activeInput === "recruiting"}
            tagSuggestions={tagSuggestions}
            selectedTagIndex={selectedTagIndex}
            tagDropdownPosition={tagDropdownPosition}
            onTagSelect={handleTagSelect}
            tagDropdownRef={tagDropdownRef}
          />
        </section>
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
  tagDropdownRef: React.RefObject<HTMLDivElement>;
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
          <div className="w-full rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-4 py-0.5 text-xs text-[#3f3227] focus-within:border-[#a67a45] focus-within:outline-none focus-within:ring-0">
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
}: {
  tasks: Task[];
  onDelete: (taskId: string) => void;
  onDateChange: (taskId: string, date: string | undefined) => void;
  onTimeChange: (taskId: string, time: string | undefined) => void;
  onTagsChange: (taskId: string, tags: string[]) => void;
  onTextChange: (taskId: string, text: string) => void;
  onAddTask: () => void;
  isInputActive: boolean;
  inputValue: string;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  section: "school" | "recruiting";
  onBlur: () => void;
  showTagDropdown: boolean;
  tagSuggestions: string[];
  selectedTagIndex: number;
  tagDropdownPosition: { top: number; left: number };
  onTagSelect: (tag: string) => void;
  tagDropdownRef: React.RefObject<HTMLDivElement>;
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
          <div className="w-full rounded-xl border border-[#d0c0a0] bg-[#fdf8ef] px-4 py-0.5 text-sm text-[#3f3227] focus-within:border-[#a67a45] focus-within:outline-none focus-within:ring-0">
            <HighlightedInput
              value={inputValue}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              placeholder="Enter task... (e.g., 'Study for exam tomorrow @math')"
              className="w-full bg-transparent outline-none leading-tight"
              autoFocus
              inputRef={inputRef}
            />
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

// Task Card for Todoist View
function TodoistTaskCard({
  task,
  onDelete,
  onDateChange,
  onTimeChange,
  onTagsChange,
  onTextChange,
  section,
}: {
  task: Task;
  onDelete: (taskId: string) => void;
  onDateChange: (taskId: string, date: string | undefined) => void;
  onTimeChange: (taskId: string, time: string | undefined) => void;
  onTagsChange: (taskId: string, tags: string[]) => void;
  onTextChange: (taskId: string, text: string) => void;
  section?: "school" | "recruiting";
}) {
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  useEffect(() => {
    // Reset animation state when task becomes done
    if (task.tags.includes("done") && isAnimatingOut) {
      setIsAnimatingOut(false);
    }
  }, [task.tags, isAnimatingOut]);

  const handleCheckboxChange = (checked: boolean) => {
    if (checked) {
      // Add "done" tag if not already present
      if (!task.tags.includes("done")) {
        // Start animation first, then update after animation completes
        setIsAnimatingOut(true);
        setTimeout(() => {
          onTagsChange(task.id, [...task.tags, "done"]);
          // Keep animation state briefly to ensure smooth transition
          setTimeout(() => {
            setIsAnimatingOut(false);
          }, 100);
        }, 600); // Let animation complete before updating
      }
    } else {
      // Remove "done" tag
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

