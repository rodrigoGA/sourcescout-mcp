export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function truncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) {
    return { text, truncated: false };
  }

  const buffer = Buffer.from(text, "utf8").subarray(0, maxBytes);
  return {
    text: buffer.toString("utf8") + "\n[SourceScout: output truncated]",
    truncated: true,
  };
}
