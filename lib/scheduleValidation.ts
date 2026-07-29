const VALID_DAYS = new Set(["L", "K", "M", "J", "V", "S", "D"]);
const MAX_COURSES = 80;
const MAX_NAME_LENGTH = 80;
const MAX_ID_LENGTH = 80;
const MIN_SLOT_HOUR = 7;
const MAX_SLOT_HOUR = 22;

interface SerializedCourse {
  id: string;
  name: string;
  days: string[];
  start: string;
  end: string;
  color: string;
}

export interface ValidatedSchedule {
  schedule: SerializedCourse[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCourseId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9_-]+(?:-[A-Za-z0-9_-]+)*$/.test(value)
  );
}

function isValidName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_NAME_LENGTH
  );
}

function isValidDays(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > VALID_DAYS.size) {
    return false;
  }

  const seen = new Set<string>();
  for (const day of value) {
    if (typeof day !== "string" || !VALID_DAYS.has(day) || seen.has(day)) {
      return false;
    }
    seen.add(day);
  }

  return true;
}

function parseSlotTime(value: unknown, expectedMinute: "00" | "50"): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || match[2] !== expectedMinute) return null;

  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < MIN_SLOT_HOUR || hour > MAX_SLOT_HOUR) {
    return null;
  }

  return hour;
}

function isValidColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

export function validateSchedulePayload(body: unknown): ValidatedSchedule | null {
  if (!isPlainObject(body) || !Array.isArray(body.schedule)) {
    return null;
  }

  if (body.schedule.length === 0 || body.schedule.length > MAX_COURSES) {
    return null;
  }

  const schedule: SerializedCourse[] = [];

  for (const item of body.schedule) {
    if (!isPlainObject(item)) return null;

    const startHour = parseSlotTime(item.start, "00");
    const endHour = parseSlotTime(item.end, "50");
    if (
      !isValidCourseId(item.id) ||
      !isValidName(item.name) ||
      !isValidDays(item.days) ||
      startHour === null ||
      endHour === null ||
      endHour < startHour ||
      !isValidColor(item.color)
    ) {
      return null;
    }

    schedule.push({
      id: item.id,
      name: item.name.trim(),
      days: [...item.days],
      start: item.start,
      end: item.end,
      color: item.color.toLowerCase(),
    });
  }

  return { schedule };
}
