export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type GrowlNote = {
  pitch: number;
  delta_onset: number;
  duration: number;
  velocity: number;
};

export type GrowlState =
  | { kind: "missing"; message: string }
  | { kind: "unsupported"; message: string }
  | {
      kind: "playable";
      message: string;
      notes: GrowlNote[];
      ticksPerQuarter: number;
      tempoMilliBpm: number;
      program: number;
      title: string;
      value: JsonObject;
    };

export type ValidatedHolo = {
  id: string;
  raw: string;
  root: JsonObject;
  outerFrame: JsonObject | null;
  record: JsonObject;
  authored: JsonObject;
  subjectRappid: string;
  holoSequence: number;
  visualParent: string | null;
  sourceStreamId: string;
  sourceSequence: number;
  sourceFrameHash: string;
  authoredHash: string;
  accessibilityDescription: string;
  growl: GrowlState;
};

export type HoloHead = {
  subjectRappid: string;
  displayName: string;
  bodySequence: number | null;
  holoSequence: number | null;
  holoId: string | null;
  sourceFrameHash: string | null;
  hostPlayerActiveId: string | null;
  presenceClassification: string;
  presenceReasonCodes: string[];
  liveness: RollingCoreLiveness | null;
};

export type HoloPresence = {
  classification: string;
  reasonCodes: string[];
  raw: JsonObject;
};

export type RollingCoreLivenessState =
  | "sleeping"
  | "awake"
  | "quarantined"
  | "unborn";

export type RollingCoreLiveness = {
  state: RollingCoreLivenessState;
  lastTickUtc: string | null;
  ageMs: number | null;
  wakeLeaseMs: number | null;
  receivedAtMs: number;
  raw: JsonObject;
};

export type PlayerStatus = {
  authoritativeHoloId: string | null;
  playerActiveHoloId: string | null;
  logicalMs: number;
  error: string | null;
};

export type FantasyParticipant = {
  id: string;
  displayName: string;
  kind: string;
  seat: number;
};

export type FantasyDraft = {
  title: string;
  status: string;
  participants: FantasyParticipant[];
};

export type LibraryEntry = {
  id: string;
  importedAt: string;
  holo: ValidatedHolo;
  source: JsonObject | null;
};
