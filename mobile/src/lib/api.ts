import {
  validateHoloValue,
  validateRappFrameValue,
} from "./holo";
import { validateHeadLiveness } from "./liveness";
import { strictParse } from "./strict-json";
import type {
  FantasyDraft,
  FantasyParticipant,
  HoloHead,
  HoloPresence,
  JsonObject,
  JsonValue,
  ValidatedHolo,
} from "./types";

export class ZooApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZooApiError";
  }
}

export type ZooHealth = {
  name: string;
  version: string;
  status: string;
};

export type HoloHistory = {
  subjectRappid: string;
  currentHeadId: string | null;
  frames: ValidatedHolo[];
};

export class ZooApi {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async health(): Promise<ZooHealth> {
    const object = asObject(await this.get("/api/health"), "health");
    require(object.schema === "rapp-zoo-health/1.0", "health schema is invalid");
    return {
      name: string(object.name, "health.name"),
      version: string(object.version, "health.version"),
      status: string(object.status, "health.status"),
    };
  }

  async heads(): Promise<HoloHead[]> {
    return validateHoloHeadsPayload(
      await this.get("/api/holo/heads"),
      Date.now(),
    );
  }

  async history(subjectRappid: string, limit = 256): Promise<HoloHistory> {
    const query = new URLSearchParams({
      subject_rappid: subjectRappid,
      limit: String(Math.max(1, Math.min(256, limit))),
    });
    const object = asObject(
      await this.get(`/api/holo/history?${query.toString()}`),
      "history",
    );
    require(object.schema === "rapp-holo-history/1", "history schema is invalid");
    const frames = array(object.frames, "history.frames").map((value) => {
      const entry = asObject(value, "history entry");
      return validateHoloValue(entry.frame!);
    });
    const current = asOptionalObject(object.current_head);
    return {
      subjectRappid: string(object.subject_rappid, "history.subject_rappid"),
      currentHeadId:
        typeof current?.holo_id === "string" ? current.holo_id : frames[0]?.id ?? null,
      frames,
    };
  }

  async frame(holoId: string): Promise<ValidatedHolo> {
    const object = asObject(
      await this.get(`/api/holo/frames/${encodeURIComponent(holoId)}`),
      "frame view",
    );
    require(object.schema === "rapp-holo-frame-view/1", "frame view schema is invalid");
    const frame = validateHoloValue(object.frame!);
    require(frame.id === holoId, "requested and returned Holo IDs differ");
    return frame;
  }

  async source(frameHash: string): Promise<JsonObject> {
    return validateRappFrameValue(
      await this.get(`/api/holo/sources/${encodeURIComponent(frameHash)}`),
    );
  }

  async presence(subjectRappid: string): Promise<HoloPresence> {
    const query = new URLSearchParams({ subject_rappid: subjectRappid });
    const object = asObject(
      await this.get(`/api/holo/presence?${query.toString()}`),
      "presence",
    );
    require(object.schema === "rapp-holo-presence/1", "presence schema is invalid");
    return {
      classification: string(object.classification, "presence.classification"),
      reasonCodes: array(object.reason_codes, "presence.reason_codes").map((value) =>
        string(value, "presence.reason_code"),
      ),
      raw: object,
    };
  }

  async fantasyDraft(): Promise<FantasyDraft> {
    const frame = validateRappFrameValue(
      await this.get("/api/holo/examples/fantasy-draft"),
    );
    require(frame.kind === "body.pulse", "fantasy draft frame kind is invalid");
    const payload = asObject(frame.payload, "fantasy payload");
    require(payload.schema === "rapp-fantasy-draft/1", "fantasy draft schema is invalid");
    const participants: FantasyParticipant[] = array(
      payload.participants,
      "fantasy participants",
    ).map((value) => {
      const participant = asObject(value, "fantasy participant");
      const rawKind = string(participant.kind, "participant.kind");
      const rawName = string(participant.display_name, "participant.display_name");
      return {
        id: string(participant.id, "participant.id"),
        displayName:
          rawKind === "rappter"
            ? rawName.replace(/^Rappter\b/, "Rapter")
            : rawName,
        kind: rawKind === "rappter" ? "rapter" : rawKind,
        seat: integer(participant.seat, "participant.seat"),
      };
    });
    return {
      title: string(payload.title, "fantasy.title"),
      status: string(payload.status, "fantasy.status"),
      participants,
    };
  }

  private async get(path: string): Promise<JsonValue> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        let message = response.statusText;
        try {
          const body = asObject(strictParse(raw), "error");
          if (typeof body.error === "string") message = body.error;
        } catch {
          // Keep the HTTP status text when the error body is not strict JSON.
        }
        throw new ZooApiError(`RAPP Zoo returned HTTP ${response.status}: ${message}`);
      }
      return strictParse(raw);
    } catch (error) {
      if (error instanceof ZooApiError) throw error;
      throw new ZooApiError(
        `Could not reach ${this.baseUrl}. ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function validateHoloHeadsPayload(
  value: JsonValue,
  receivedAtMs: number,
): HoloHead[] {
  const object = asObject(value, "heads");
  require(object.schema === "rapp-holo-heads/1", "heads schema is invalid");
  return array(object.heads, "heads.heads").map((entry) => {
    const head = asObject(entry, "head");
    const subjectRappid = string(head.subject_rappid, "head.subject_rappid");
    const identity =
      subjectRappid.replace("rappid:@", "").split(":")[0] ?? subjectRappid;
    const presence = asOptionalObject(head.presence);
    const liveness =
      head.liveness === null || head.liveness === undefined
        ? null
        : validateHeadLiveness(head.liveness, receivedAtMs);
    const result: HoloHead = {
      subjectRappid,
      displayName: identity.split("/").at(-1) ?? identity,
      bodySequence: nullableNonNegativeInteger(
        head.body_seq,
        "head.body_seq",
      ),
      holoSequence: nullableNonNegativeInteger(
        head.holo_seq,
        "head.holo_seq",
      ),
      holoId: nullableString(head.holo_id, "head.holo_id"),
      sourceFrameHash: nullableString(
        head.source_frame_hash,
        "head.source_frame_hash",
      ),
      hostPlayerActiveId:
        typeof head.player_active_holo_id === "string"
          ? head.player_active_holo_id
          : null,
      presenceClassification:
        typeof presence?.classification === "string"
          ? presence.classification
          : "indeterminate",
      presenceReasonCodes: Array.isArray(presence?.reason_codes)
        ? presence.reason_codes.filter(
            (reason): reason is string => typeof reason === "string",
          )
        : [],
      liveness,
    };
    if (liveness?.state !== "unborn") {
      require(
        result.bodySequence !== null &&
          result.holoSequence !== null &&
          result.holoId !== null &&
          result.sourceFrameHash !== null,
        "born Holo head fields cannot be null",
      );
    }
    return result;
  });
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ZooApiError("Enter a valid http or https RAPP Zoo URL.");
  }
  require(["http:", "https:"].includes(url.protocol), "Host URL must use http or https");
  require(url.username === "" && url.password === "", "Host URL cannot contain credentials");
  require(url.search === "" && url.hash === "", "Host URL cannot contain query or fragment");
  return url.toString().replace(/\/$/, "");
}

function asObject(value: JsonValue | undefined, path: string): JsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new ZooApiError(`${path} must be an object`);
  }
  return value;
}

function asOptionalObject(value: JsonValue | undefined): JsonObject | null {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function array(value: JsonValue | undefined, path: string): JsonValue[] {
  if (!Array.isArray(value)) throw new ZooApiError(`${path} must be an array`);
  return value;
}

function string(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") throw new ZooApiError(`${path} must be a string`);
  return value;
}

function integer(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ZooApiError(`${path} must be an integer`);
  }
  return value;
}

function nullableString(
  value: JsonValue | undefined,
  path: string,
): string | null {
  return value === null || value === undefined ? null : string(value, path);
}

function nullableNonNegativeInteger(
  value: JsonValue | undefined,
  path: string,
): number | null {
  if (value === null || value === undefined) return null;
  const result = integer(value, path);
  require(result >= 0, `${path} must not be negative`);
  return result;
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ZooApiError(message);
}
