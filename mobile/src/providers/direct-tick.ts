import {
  validateHoloValue,
  validateRappFrameValue,
  verifySourceFrame,
} from "@/lib/holo";
import {
  canonicalize,
  domainHash,
  strictParse,
} from "@/lib/strict-json";
import type { JsonObject, JsonValue, ValidatedHolo } from "@/lib/types";
import { createDirectProvider } from "./openai-compatible";
import type { DirectProviderSettings } from "./types";

const DIRECT_DEADLINE_MS = 30_000;

export async function requestDirectSuccessorTick({
  settings,
  current,
  previousSourceFrame,
  previousBodyFrame,
  maxContextBytes,
  maxOutputTokens,
  wakeLeaseMs,
  signal,
  fetchImpl = fetch,
  now = () => new Date(),
}: {
  settings: DirectProviderSettings;
  current: ValidatedHolo;
  previousSourceFrame: JsonObject;
  previousBodyFrame: JsonObject;
  maxContextBytes: number;
  maxOutputTokens: number;
  wakeLeaseMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<{ holo: ValidatedHolo; source: JsonObject }> {
  if (
    !Number.isSafeInteger(maxContextBytes) ||
    maxContextBytes < 4_096 ||
    maxContextBytes > 131_072
  ) {
    throw new Error("Direct tick context budget must be 4,096-131,072 bytes.");
  }
  if (
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 64 ||
    maxOutputTokens > 4_096
  ) {
    throw new Error("Direct tick output budget must be 64-4096 tokens.");
  }
  const currentRecord = canonicalize(current.record);
  if (utf8Length(currentRecord) > maxContextBytes) {
    throw new Error(
      "Current Rolling Core exceeds the configured Direct context byte budget.",
    );
  }
  if (!Number.isSafeInteger(wakeLeaseMs) || wakeLeaseMs < 60_000) {
    throw new Error("Direct tick wake lease must be at least 60 seconds.");
  }
  const provider = createDirectProvider(settings, fetchImpl);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), DIRECT_DEADLINE_MS);
  const startedAt = Date.now();
  let response;
  try {
    response = await provider.complete(
      {
        model: provider.model,
        max_tokens: maxOutputTokens,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Author exactly one successor for a living digital organism. Return strict JSON only with exactly {\"text\":string,\"authored\":rapp-holo-output/1}. Preserve identity and continuity. authored.base_holo_id must equal the supplied current Holo ID. Change the inspectable experience-state; do not merely rewrite base_holo_id. Do not invent Growl notes: omit growl unless complete NOTE data is intentionally authored.",
          },
          {
            role: "user",
            content: `CURRENT_HOLO_ID=${current.id}\nCURRENT_RECORD=${currentRecord}`,
          },
        ],
      },
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Direct provider returned no successor candidate.");
  }
  const candidate = exactObject(strictParse(content), ["text", "authored"]);
  const text = string(candidate.text, "successor.text");
  if (text.length > 16_384) {
    throw new Error("Direct successor text exceeds 16,384 characters.");
  }
  const authored = exactJsonObject(candidate.authored, "successor.authored");
  require(
    authored.base_holo_id === current.id,
    "Direct successor base_holo_id does not match the current Rolling Core.",
  );
  require(
    expressionWithoutBase(authored) !== expressionWithoutBase(current.authored),
    "Direct successor did not mutate the inspectable experience-state.",
  );
  return materializeDirectSuccessor({
    current,
    previousSourceFrame,
    previousBodyFrame,
    text,
    authored,
    wakeLeaseMs,
    turnLatencyMs: Math.max(0, Date.now() - startedAt),
    utc: now().toISOString(),
  });
}

export function materializeDirectSuccessor({
  current,
  previousSourceFrame,
  previousBodyFrame,
  text,
  authored,
  wakeLeaseMs,
  turnLatencyMs,
  utc,
}: {
  current: ValidatedHolo;
  previousSourceFrame: JsonObject;
  previousBodyFrame: JsonObject;
  text: string;
  authored: JsonObject;
  wakeLeaseMs: number;
  turnLatencyMs: number;
  utc: string;
}): { holo: ValidatedHolo; source: JsonObject } {
  const verifiedSource = verifySourceFrame(previousSourceFrame, current);
  const verifiedBody = validateHoloValue(previousBodyFrame);
  require(
    verifiedBody.outerFrame !== null &&
      verifiedBody.id === current.id &&
      canonicalize(verifiedBody.outerFrame) === canonicalize(current.outerFrame),
    "Previous body frame does not match the current Rolling Core.",
  );
  const sourcePayload: JsonObject = {
    role: "assistant",
    text,
    voice: null,
    outputs: { holo: authored },
    holo_channel: {
      enabled: true,
      turn_latency_ms: turnLatencyMs,
      deadline_ms: DIRECT_DEADLINE_MS,
      wake_lease_ms: wakeLeaseMs,
    },
  };
  const source = rappFrame({
    kind: "memory.chat-turn",
    streamId: current.sourceStreamId,
    sequence: current.sourceSequence + 1,
    utc,
    payload: sourcePayload,
    previous: verifiedSource.payload_hash as string,
  });
  validateContinuity(source, verifiedSource, "source");
  const record: JsonObject = {
    schema: "rapp-holo-record/1",
    holo_seq: current.holoSequence + 1,
    visual_parent: current.id,
    source: {
      stream_id: current.sourceStreamId,
      seq: current.sourceSequence + 1,
      frame_hash: source.frame_hash!,
    },
    authored_hash: domainHash("rapp-holo/1:authored", authored),
    producer_provenance: null,
    authored,
  };
  const outerSequence =
    current.outerFrame && typeof current.outerFrame.seq === "number"
      ? current.outerFrame.seq + 1
      : current.holoSequence + 1;
  const outer = rappFrame({
    kind: "body.pulse",
    streamId: current.subjectRappid,
    sequence: outerSequence,
    utc,
    payload: record,
    previous: verifiedBody.outerFrame.payload_hash as string,
  });
  validateContinuity(outer, verifiedBody.outerFrame, "body");
  const holo = validateHoloValue(outer);
  verifySourceFrame(source, holo);
  return { holo, source };
}

function rappFrame({
  kind,
  streamId,
  sequence,
  utc,
  payload,
  previous,
}: {
  kind: string;
  streamId: string;
  sequence: number;
  utc: string;
  payload: JsonObject;
  previous: string;
}): JsonObject {
  const preimage: JsonObject = {
    spec: "rapp/1",
    kind,
    stream_id: streamId,
    seq: sequence,
    utc,
    payload,
    payload_hash: domainHash("rapp/1:particle", payload),
    prev: previous,
    prev_wave: null,
  };
  return {
    ...preimage,
    frame_hash: domainHash("rapp/1:wave", preimage),
    sig: null,
  };
}

function validateContinuity(
  frame: JsonObject,
  previousFrame: JsonObject,
  label: string,
): void {
  const verifiedPrevious = validateRappFrameValue(previousFrame);
  require(
    frame.stream_id === verifiedPrevious.stream_id,
    `Direct ${label} successor changed stream_id.`,
  );
  require(
    frame.seq === (verifiedPrevious.seq as number) + 1,
    `Direct ${label} successor sequence is not contiguous.`,
  );
  require(
    frame.prev === verifiedPrevious.payload_hash,
    `Direct ${label} successor prev does not match prior payload_hash.`,
  );
  require(
    (frame.utc as string) >= (verifiedPrevious.utc as string),
    `Direct ${label} successor UTC precedes its prior frame.`,
  );
}

function expressionWithoutBase(value: JsonObject): string {
  const { base_holo_id: ignoredBase, ...expression } = value;
  void ignoredBase;
  return canonicalize(expression);
}

function exactObject(value: JsonValue, keys: string[]): JsonObject {
  const object = exactJsonObject(value, "successor");
  if (
    Object.keys(object).length !== keys.length ||
    Object.keys(object).some((key) => !keys.includes(key))
  ) {
    throw new Error("Direct successor response has missing or unknown members.");
  }
  return object;
}

function exactJsonObject(value: JsonValue | undefined, path: string): JsonObject {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function string(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function utf8Length(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    length +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return length;
}
