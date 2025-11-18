/**
 * Parses natural language date strings into ISO date strings
 * Supports: 
 * - Today: today, td, tod, tdy
 * - Tomorrow: tomorrow, tmr, tom, tmrw
 * - Days: sunday/sun, monday/mon, tuesday/tue/tues, wednesday/wed/wedn, thursday/thu/thur/thurs, friday/fri, saturday/sat
 * - Months: january/jan/janu, february/feb/febr, march/mar/marc, april/apr/apri, may, june/jun, july/jul, august/aug/augu, september/sep/sept/septe, october/oct/octo, november/nov/nove/novem, december/dec/dece/decem
 * - Dates: nov 13, november 13th, nov 13th, november 13, etc.
 */
export function parseNaturalDate(input: string): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const inputLower = input.toLowerCase();
  
  // Handle relative dates - search anywhere in the text
  // Today variations: today, td, tod, tdy
  if (/\b(today|td|tod|tdy)\b/i.test(inputLower)) {
    return formatDate(today);
  }
  
  // Tomorrow variations: tomorrow, tmr, tom, tmrw
  // Note: "tom" must come after "tomorrow" to avoid partial matches, but regex alternation matches first, so order matters
  if (/\b(tomorrow|tmrw|tmr|tom)\b/i.test(inputLower)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
  }
  
  // Handle day names - search anywhere in the text
  // Full names and common abbreviations
  const dayNames = [
    ["sunday", "sun"],
    ["monday", "mon"],
    ["tuesday", "tue", "tues"],
    ["wednesday", "wed", "wedn"],
    ["thursday", "thu", "thur", "thurs"],
    ["friday", "fri"],
    ["saturday", "sat"]
  ];
  
  for (let i = 0; i < dayNames.length; i++) {
    const variations = dayNames[i];
    // Sort variations by length (longest first) to match longer words before shorter ones
    const sortedVariations = variations.sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`\\b(${sortedVariations.join("|")})\\b`, "i");
    if (pattern.test(inputLower)) {
      const targetDay = i;
      const currentDay = today.getDay();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // Next occurrence
      const date = new Date(today);
      date.setDate(date.getDate() + daysToAdd);
      return formatDate(date);
    }
  }
  
  // Handle month names and dates
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];
  
  // Month abbreviations and variations
  const monthVariations = [
    ["jan", "janu", "janua", "januar"],
    ["feb", "febr", "febru", "februa", "februar"],
    ["mar", "marc", "march"],
    ["apr", "apri", "april"],
    ["may"],
    ["jun", "june"],
    ["jul", "july"],
    ["aug", "augu", "augus", "august"],
    ["sep", "sept", "septe", "septem", "septemb", "septembe", "september"],
    ["oct", "octo", "octob", "octobe", "october"],
    ["nov", "nove", "novem", "novemb", "novembe", "november"],
    ["dec", "dece", "decem", "decemb", "decembe", "december"]
  ];
  
  // Try to match month name or abbreviation - search anywhere in the text
  for (let i = 0; i < monthNames.length; i++) {
    const fullName = monthNames[i];
    const variations = monthVariations[i];
    
    // Build pattern with full name and all variations
    const monthPattern = `(${fullName}|${variations.join("|")})`;
    const pattern = new RegExp(`\\b${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i");
    
    const match = inputLower.match(pattern);
    
    if (match) {
      const day = parseInt(match[2], 10);
      if (day >= 1 && day <= 31) {
        const year = today.getFullYear();
        const date = new Date(year, i, day);
        // If the date is in the past, use next year
        if (date < today) {
          date.setFullYear(year + 1);
        }
        return formatDate(date);
      }
    }
  }
  
  // Try to match "MM/DD" or "M/D" format - search anywhere in the text
  const slashMatch = inputLower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10) - 1;
    const day = parseInt(slashMatch[2], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const year = today.getFullYear();
      const date = new Date(year, month, day);
      if (date < today) {
        date.setFullYear(year + 1);
      }
      return formatDate(date);
    }
  }
  
  // Try to match "MM-DD" or "M-D" format - search anywhere in the text
  const dashMatch = inputLower.match(/\b(\d{1,2})-(\d{1,2})\b/);
  if (dashMatch) {
    const month = parseInt(dashMatch[1], 10) - 1;
    const day = parseInt(dashMatch[2], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const year = today.getFullYear();
      const date = new Date(year, month, day);
      if (date < today) {
        date.setFullYear(year + 1);
      }
      return formatDate(date);
    }
  }
  
  return null;
}

/**
 * Extracts tags from input string (words starting with @ or #)
 */
export function extractTags(input: string): string[] {
  const tagRegex = /[@#](\w+)/g;
  const tags: string[] = [];
  let match;
  while ((match = tagRegex.exec(input)) !== null) {
    tags.push(match[1]);
  }
  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Removes date, time, and tag patterns from input to get clean task text
 * Also removes @done, @doing, @todo status tags (but keeps urgency tags in tags array)
 */
export function cleanTaskText(input: string): string {
  let cleaned = input;
  
  // Remove time patterns first (before date patterns)
  const timePatterns = [
    /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/gi,
    /\b\d{1,2}:\d{2}\b/g,
  ];
  
  timePatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, "");
  });
  
  // Remove date patterns
  const datePatterns = [
    /\b(today|tomorrow|tmr|td|tod|tdy|tom|tmrw)\b/gi,
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|wedn|thu|thur|thurs|fri|sat)\b/gi,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?/gi,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janu|febr|marc|apri|augu|sept|octo|nove|dece|novem|decem|novemb|decemb|novembe|decembe)\s+\d{1,2}(?:st|nd|rd|th)?/gi,
    /\b\d{1,2}\/\d{1,2}\b/g,
    /\b\d{1,2}-\d{1,2}\b/g,
  ];
  
  datePatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, "");
  });
  
  // Remove status tags (@done, @doing, @todo) from display text
  cleaned = cleaned.replace(/@(done|doing|todo|completed|finished|in.?progress|working.?on|wip|to.?do|pending)\b/gi, "");
  
  // Remove all other tags (but urgency tags will be removed separately in createTask)
  cleaned = cleaned.replace(/[@#]\w+/g, "");
  
  return cleaned.trim().replace(/\s+/g, " ");
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

