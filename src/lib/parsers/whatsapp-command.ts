export interface PassCommand {
  visitorName: string;
  visitorPhone: string;
  durationHours: number;
}

const DEFAULT_DURATION_HOURS = 8;
const MAX_DURATION_HOURS = 72;

/**
 * Parses "Pass <Name...> <Phone> [<N>h]", e.g.
 * "Pass John Doe 0821234567 4h" or "Pass Sam 0829998888".
 * Returns null if the message isn't a recognizable pass command.
 */
export function parsePassCommand(text: string): PassCommand | null {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 3 || tokens[0]?.toLowerCase() !== "pass") {
    return null;
  }

  let rest = tokens.slice(1);

  let durationHours = DEFAULT_DURATION_HOURS;
  const durationMatch = rest[rest.length - 1]?.match(/^(\d+)h$/i);
  if (durationMatch?.[1]) {
    durationHours = Math.min(parseInt(durationMatch[1], 10), MAX_DURATION_HOURS);
    rest = rest.slice(0, -1);
  }

  const phoneToken = rest[rest.length - 1];
  if (!phoneToken || !/^\+?\d{7,15}$/.test(phoneToken)) {
    return null;
  }
  const visitorPhone = phoneToken;
  const visitorName = rest.slice(0, -1).join(" ").trim();

  if (!visitorName || durationHours <= 0) {
    return null;
  }

  return { visitorName, visitorPhone, durationHours };
}
