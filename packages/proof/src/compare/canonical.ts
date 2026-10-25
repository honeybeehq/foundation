import { createHash } from "node:crypto";
/** Sorted object keys, preserved array order, JSON scalar encoding; rejects non-JSON values. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object" && value) {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  }
  throw Error("Canonical reports must contain only JSON values");
}
export function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function seal<T extends Record<string, unknown>>(value: T) {
  const { reportHash, ...body } = value;
  return { ...body, reportHash: hash(body) };
}
export function checkHash(value: Record<string, unknown>): boolean {
  const { reportHash, ...body } = value;
  return typeof reportHash === "string" && hash(body) === reportHash;
}
