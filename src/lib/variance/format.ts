export function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const absolute = Math.abs(Math.round(seconds));
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  const value = `${minutes}:${remainder.toString().padStart(2, "0")}`;
  return seconds < 0 ? `−${value}` : value;
}

export function formatDelta(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds === 0) return "0:00";
  return `${seconds > 0 ? "+" : ""}${formatDuration(seconds)}`;
}

export function formatPercent(percent: number | null) {
  if (percent === null) return "—";
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

export function formatServiceDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

/**
 * Human-facing plan title. Planning Center plan titles are often internal
 * codes ("#4", "#2 - PDarin") that mean nothing to leadership; prefer the
 * series title and fall back to a generic label rather than surface those.
 */
export function displayPlanTitle(
  title: string | null,
  seriesTitle: string | null,
) {
  const looksInternal = (value: string) => /^#|^\d+$/.test(value.trim());
  if (seriesTitle && !looksInternal(seriesTitle)) return seriesTitle;
  if (title && !looksInternal(title)) return title;
  return "Weekend service";
}

export function parseDurationInput(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;

  const parts = normalized.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some((part) => !/^\d+$/.test(part))) return null;

  const numbers = parts.map(Number);
  const seconds = numbers.at(-1) ?? 0;
  const minutes = numbers.at(-2) ?? 0;
  const hours = parts.length === 3 ? (numbers[0] ?? 0) : 0;

  if (seconds >= 60 || minutes >= 60 && parts.length === 3) return null;

  return (hours * 60 * 60) + (minutes * 60) + seconds;
}
