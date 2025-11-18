/**
 * Parses natural language time strings into 24-hour format (HH:MM)
 * Supports: 6:40pm, 5:00AM, 4pm, 3am, 14:30, etc.
 */
export function parseNaturalTime(input: string): string | null {
  const inputLower = input.trim().toLowerCase();
  
  // Pattern for 12-hour format with am/pm: 6:40pm, 5:00AM, 4pm, 3am
  const timePattern12 = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
  const match12 = inputLower.match(timePattern12);
  
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = match12[2] ? parseInt(match12[2], 10) : 0;
    const period = match12[3].toLowerCase();
    
    if (hours < 1 || hours > 12) return null;
    if (minutes < 0 || minutes > 59) return null;
    
    // Convert to 24-hour format
    if (period === "pm" && hours !== 12) {
      hours += 12;
    } else if (period === "am" && hours === 12) {
      hours = 0;
    }
    
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }
  
  // Pattern for 24-hour format: 14:30, 9:00, 23:45
  const timePattern24 = /(\d{1,2}):(\d{2})/;
  const match24 = inputLower.match(timePattern24);
  
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    }
  }
  
  return null;
}

/**
 * Formats 24-hour time (HH:MM) to 12-hour format with am/pm
 */
export function formatTime12Hour(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "pm" : "am";
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, "0")}${period}`;
}

