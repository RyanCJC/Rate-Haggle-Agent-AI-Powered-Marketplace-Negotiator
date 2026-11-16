import type { Pickup } from "../types";

export function formatRm(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const [whole, fraction] = (Number.isInteger(n) ? n.toString() : n.toFixed(2)).split(".");
  const sign = n < 0 ? "-" : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `RM ${sign}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function formatRmAbs(value: string | number | null | undefined): string {
  return formatRm(value).replace(/^-/, "");
}

export function savings(
  asking: string,
  final: string | null,
): { amount: number; percent: number } | null {
  if (final === null) return null;
  const a = Number(asking);
  const f = Number(final);
  if (!Number.isFinite(a) || !Number.isFinite(f) || a <= 0) return null;
  const amount = a - f;
  return { amount, percent: Math.round((amount / a) * 100) };
}

export function formatPickup(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(iso));
}

export function pickupLine(pickup: Pickup | null): string | null {
  if (!pickup) return null;
  switch (pickup.status) {
    case "booked":
    case "already_booked":
      return pickup.start_at
        ? `Pickup booked: ${formatPickup(pickup.start_at)} (Malaysia time)`
        : "Pickup booked";
    case "declined":
      return "Pickup not booked: you chose not to book it.";
    case "error":
      return "The calendar was unavailable, so no pickup is booked. The deal still stands.";
    case "no_slots":
      return "No free pickup slot was found.";
    default:
      return `Pickup status: ${pickup.status}`;
  }
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
