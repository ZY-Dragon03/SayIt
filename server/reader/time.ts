const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let value = dateFormatterCache.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    dateFormatterCache.set(timezone, value);
  }
  return value;
}

export interface LocalDateTime {
  date: string;
  time: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localDateTime(instant: Date, timezone: string): LocalDateTime {
  const parts = Object.fromEntries(
    formatter(timezone)
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = parts.hour;
  const minute = parts.minute;
  const second = parts.second;
  return {
    date: `${year.toString().padStart(4, "0")}-${month
      .toString()
      .padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
    time: `${hour.toString().padStart(2, "0")}:${minute
      .toString()
      .padStart(2, "0")}`,
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

function sameWallMinute(
  instant: Date,
  timezone: string,
  target: { year: number; month: number; day: number; hour: number; minute: number },
): boolean {
  const local = localDateTime(instant, timezone);
  return (
    local.year === target.year &&
    local.month === target.month &&
    local.day === target.day &&
    local.hour === target.hour &&
    local.minute === target.minute
  );
}

function offsetAt(instant: Date, timezone: string): number {
  const local = localDateTime(instant, timezone);
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return localAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function exactCandidates(
  target: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
): Date[] {
  const wallUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  );
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 3) {
    offsets.add(offsetAt(new Date(wallUtc + delta * 60 * 60 * 1000), timezone));
  }
  const matches: Date[] = [];
  for (const offset of offsets) {
    const instant = new Date(wallUtc - offset);
    if (sameWallMinute(instant, timezone, target)) matches.push(instant);
  }
  return matches.sort((a, b) => a.getTime() - b.getTime());
}

function addWallMinutes(
  target: { year: number; month: number; day: number; hour: number; minute: number },
  minutes: number,
) {
  const date = new Date(
    Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute) +
      minutes * 60_000,
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

/**
 * Resolve a scheduled wall time. Ambiguous overlap minutes use the first
 * instant. A nonexistent gap minute moves forward to the first valid minute.
 */
export function resolveScheduledTime(
  localDate: string,
  localTime: string,
  timezone: string,
): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!dateMatch || !timeMatch) throw new Error("Invalid local date or time.");
  const target = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  const calendarCheck = new Date(
    Date.UTC(target.year, target.month - 1, target.day),
  );
  if (
    target.month < 1 ||
    target.month > 12 ||
    target.day < 1 ||
    target.day > 31 ||
    target.hour > 23 ||
    target.minute > 59 ||
    calendarCheck.getUTCFullYear() !== target.year ||
    calendarCheck.getUTCMonth() + 1 !== target.month ||
    calendarCheck.getUTCDate() !== target.day
  ) {
    throw new Error("Invalid local date or time.");
  }
  formatter(timezone);
  const exact = exactCandidates(target, timezone);
  if (exact.length > 0) return exact[0];

  for (let minute = 1; minute <= 180; minute += 1) {
    const shifted = addWallMinutes(target, minute);
    const candidates = exactCandidates(shifted, timezone);
    if (candidates.length > 0) return candidates[0];
    if (shifted.year !== target.year || shifted.month !== target.month || shifted.day !== target.day) {
      break;
    }
  }
  throw new Error("Could not resolve the scheduled time in this time zone.");
}

export function addLocalDays(date: string, amount: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("Invalid local date.");
  const value = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount),
  );
  return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(value.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${value.getUTCDate().toString().padStart(2, "0")}`;
}

export function dateRange(startExclusive: string, endExclusive: string): string[] {
  const result: string[] = [];
  let current = addLocalDays(startExclusive, 1);
  while (current < endExclusive && result.length < 366) {
    result.push(current);
    current = addLocalDays(current, 1);
  }
  return result;
}
