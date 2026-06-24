export function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const absolute = Math.abs(Math.round(seconds));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const remainder = absolute % 60;
  const value =
    hours > 0
      ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
      : `${minutes}:${remainder.toString().padStart(2, "0")}`;
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
