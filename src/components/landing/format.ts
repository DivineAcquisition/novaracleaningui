// Plain formatting helpers, safe to import from server components.

export function dollars(cents: number): string {
  const v = cents / 100;
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
