/** Custom grouping (user-created section) stored in localStorage */
export interface CustomSection {
  id: string;
  name: string;
}

export const CUSTOM_SECTIONS_KEY = "lifeTodo_customSections";

/** Built-in section ids (order: tambareni first, then todoist-style sections) */
export const BUILT_IN_SECTION_IDS = ["tambareni", "school", "socialmedia", "recruiting"] as const;

/** Display names for built-in sections */
export const BUILT_IN_SECTION_NAMES: Record<string, string> = {
  tambareni: "@tambareni careers",
  school: "@school",
  socialmedia: "@socialmedia",
  recruiting: "@recruiting",
};

export function getCustomSections(): CustomSection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_SECTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomSection[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setCustomSections(sections: CustomSection[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_SECTIONS_KEY, JSON.stringify(sections));
}

/** All sections: built-in (with display names) + custom. Each item has { id, name }. */
export function getAllSections(): { id: string; name: string }[] {
  const custom = getCustomSections();
  const builtIn = BUILT_IN_SECTION_IDS.map((id) => ({
    id,
    name: BUILT_IN_SECTION_NAMES[id] ?? id,
  }));
  return [...builtIn, ...custom];
}

/** Tag memory key for a section (built-in use existing keys for backward compat, custom use id). */
export const TAG_MEMORY_KEY_PREFIX = "lifeTodo_tagMemory_";

export function getTagMemoryKey(sectionId: string): string {
  return `${TAG_MEMORY_KEY_PREFIX}${sectionId}`;
}

/** Slug from display name: lowercase, replace spaces with hyphens, strip non-alphanumeric. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "group";
}
