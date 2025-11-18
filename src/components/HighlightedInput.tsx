"use client";

import { useRef, useEffect, ChangeEvent } from "react";
import { parseNaturalDate, extractTags } from "@/lib/date-parser";
import { parseNaturalTime } from "@/lib/time-parser";

interface HighlightedInputProps {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export default function HighlightedInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className,
  autoFocus,
  inputRef,
}: HighlightedInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overlayRef.current || !inputRef.current) return;

    const input = inputRef.current;
    const overlay = overlayRef.current;

    // Get computed styles from input
    const inputStyles = window.getComputedStyle(input);
    overlay.style.fontSize = inputStyles.fontSize;
    overlay.style.fontFamily = inputStyles.fontFamily;
    overlay.style.fontWeight = inputStyles.fontWeight;
    overlay.style.letterSpacing = inputStyles.letterSpacing;
    overlay.style.padding = inputStyles.padding;
    overlay.style.paddingLeft = inputStyles.paddingLeft;
    overlay.style.paddingRight = inputStyles.paddingRight;
    overlay.style.paddingTop = inputStyles.paddingTop;
    overlay.style.paddingBottom = inputStyles.paddingBottom;
    overlay.style.lineHeight = inputStyles.lineHeight;
    overlay.style.borderLeft = inputStyles.borderLeft;
    overlay.style.borderRight = inputStyles.borderRight;
    overlay.style.boxSizing = inputStyles.boxSizing;
    overlay.style.width = inputStyles.width;
    overlay.style.height = inputStyles.height;
    overlay.style.minWidth = `${input.scrollWidth}px`; // Ensure overlay can accommodate full text width
    
    // Sync scroll position
    const syncScroll = () => {
      if (overlay && input) {
        overlay.scrollLeft = input.scrollLeft;
      }
    };
    input.addEventListener("scroll", syncScroll);
    syncScroll();
    
    // Also sync on input events to catch cursor movements
    const handleInputSync = () => {
      syncScroll();
      // Update minWidth to match scrollWidth
      if (overlay && input) {
        overlay.style.minWidth = `${input.scrollWidth}px`;
      }
    };
    input.addEventListener("input", handleInputSync);
    input.addEventListener("keydown", handleInputSync);

    // Get all tags, dates, and times in the text
    const tags = extractTags(value);
    const date = parseNaturalDate(value);
    const time = parseNaturalTime(value);

    const tagRanges: Array<{ start: number; end: number; type: "tag" | "date" | "time" }> = [];

    // Find all @tag occurrences
    tags.forEach((tag) => {
      const regex = new RegExp(`@${tag}\\b`, "g");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(value)) !== null) {
        // Use exact match to preserve width
        const matchText = match[0];
        const matchIndex = match.index;
        tagRanges.push({
          start: matchIndex,
          end: matchIndex + matchText.length,
          type: "tag",
        });
      }
    });

    // Find time occurrences - always check, not just when parseNaturalTime returns a value
    const timePatterns = [
      /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/gi,
      /\b\d{1,2}:\d{2}\b/g,
    ];

    timePatterns.forEach((pattern) => {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(value)) !== null) {
        // Don't trim - use exact match to preserve width
        const matchText = match[0];
        const matchIndex = match.index;
        // Check if this range doesn't overlap with existing ranges
        const overlaps = tagRanges.some(
          (r) => !(matchIndex >= r.end || matchIndex + matchText.length <= r.start)
        );
        if (!overlaps) {
          tagRanges.push({
            start: matchIndex,
            end: matchIndex + matchText.length,
            type: "time",
          });
        }
      }
    });

    // Find date occurrences
    if (date) {
      const datePatterns = [
        /\b(today|td|tod|tdy)\b/gi,
        /\b(tomorrow|tmrw|tmr|tom)\b/gi,
        /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|wedn|thu|thur|thurs|fri|sat)\b/gi,
        /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janu|febr|marc|apri|augu|sept|octo|nove|dece|novem|decem|novemb|decemb|novembe|decembe)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
        /\b\d{1,2}\/\d{1,2}\b/g,
        /\b\d{1,2}-\d{1,2}\b/g,
      ];

      datePatterns.forEach((pattern) => {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(value)) !== null) {
          // Use exact match to preserve width
          const matchText = match[0];
          const matchIndex = match.index;
          // Check if this range doesn't overlap with existing ranges
          const overlaps = tagRanges.some(
            (r) => !(matchIndex >= r.end || matchIndex + matchText.length <= r.start)
          );
          if (!overlaps) {
            tagRanges.push({
              start: matchIndex,
              end: matchIndex + matchText.length,
              type: "date",
            });
          }
        }
      });
    }

    // Sort ranges by start position
    tagRanges.sort((a, b) => a.start - b.start);

    // Build overlay HTML - use regular spaces to match input exactly
    let overlayHTML = "";
    let lastIndex = 0;

    const escapeHtml = (text: string) => {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    tagRanges.forEach((range) => {
      // Add text before highlight (transparent/invisible)
      if (range.start > lastIndex) {
        const text = value.substring(lastIndex, range.start);
        overlayHTML += `<span style="color: #3f3227;">${escapeHtml(text)}</span>`;
      }
      // Add highlighted text with more visible colors
      const highlightClass =
        range.type === "tag"
          ? "bg-[#10b981] rounded text-[#ffffff]"
          : range.type === "date"
            ? "bg-[#f59e0b] rounded text-[#ffffff]"
            : "bg-[#3b82f6] rounded text-[#ffffff]"; // Time - blue
      const text = value.substring(range.start, range.end);
      // No padding to ensure exact width matching - use margin for visual spacing instead
      overlayHTML += `<span class="${highlightClass}" style="display: inline;">${escapeHtml(text)}</span>`;
      lastIndex = range.end;
    });

    // Add remaining text (transparent/invisible)
    if (lastIndex < value.length) {
      const text = value.substring(lastIndex);
      overlayHTML += `<span style="color: #3f3227;">${escapeHtml(text)}</span>`;
    }

    if (!overlayHTML && value) {
      overlayHTML = `<span style="color: #3f3227;">${escapeHtml(value)}</span>`;
    }
    overlay.innerHTML = overlayHTML || "";
    
    // Sync scroll and width after content update
    requestAnimationFrame(() => {
      if (input && overlay) {
        overlay.scrollLeft = input.scrollLeft;
        overlay.style.minWidth = `${input.scrollWidth}px`;
      }
    });
    
    return () => {
      input.removeEventListener("scroll", syncScroll);
      input.removeEventListener("input", handleInputSync);
      input.removeEventListener("keydown", handleInputSync);
    };
  }, [value, inputRef]);

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`${className} relative z-10 bg-transparent`}
        autoFocus={autoFocus}
        style={{ caretColor: "#3f3227", color: "transparent", lineHeight: "1", height: "auto", minHeight: "unset", padding: "0" }}
      />
      {value && (
        <div
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 z-0 text-xs"
          style={{
            whiteSpace: "pre",
            overflow: "hidden",
            wordWrap: "normal",
            wordBreak: "normal",
            textOverflow: "clip",
            lineHeight: "1",
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

