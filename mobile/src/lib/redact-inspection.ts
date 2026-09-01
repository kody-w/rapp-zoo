const SAFE_FRAME_KEYS = [
  "v",
  "kind",
  "subject",
  "seq",
  "utc",
  "prev",
  "payload_hash",
  "frame_hash",
] as const;

export function redactInspectionRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return {
      schema: "holo-zoo-redacted-inspection/1",
      value_type: "array",
      item_count: value.length,
    };
  }
  if (value === null || typeof value !== "object") {
    return {
      schema: "holo-zoo-redacted-inspection/1",
      value_type: value === null ? "null" : typeof value,
    };
  }

  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    schema: "holo-zoo-redacted-inspection/1",
    value_type: "object",
    top_level_member_count: Object.keys(record).length,
    signature_present:
      (typeof record.sig === "string" && record.sig.length > 0) ||
      (typeof record.signature === "string" &&
        record.signature.length > 0),
  };
  for (const key of SAFE_FRAME_KEYS) {
    const item = record[key];
    if (
      item === null ||
      typeof item === "string" ||
      (typeof item === "number" && Number.isSafeInteger(item))
    ) {
      summary[key] = item;
    }
  }
  if (
    record.payload !== null &&
    typeof record.payload === "object" &&
    !Array.isArray(record.payload)
  ) {
    summary.payload_member_count = Object.keys(record.payload).length;
  }
  return summary;
}
