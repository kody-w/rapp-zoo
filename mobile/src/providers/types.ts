export type OpenAICompatibleMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type OpenAICompatibleRequest = {
  model: string;
  messages: OpenAICompatibleMessage[];
  max_tokens?: number;
  temperature?: number;
};

export type OpenAICompatibleResponse = {
  id?: string;
  choices?: {
    message?: {
      role?: string;
      content?: string | null;
    };
  }[];
  [key: string]: unknown;
};

export type OpenAICompatibleProvider = {
  mode: "direct" | "wild";
  endpoint: string;
  model: string;
  complete: (
    request: OpenAICompatibleRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<OpenAICompatibleResponse>;
};

export type DirectProviderSettings = {
  endpoint: string;
  model: string;
  apiKey: string;
};

export type BreathKeyStatus =
  | "missing"
  | "stored-unverified"
  | "testing"
  | "verified"
  | "revoked"
  | "offline";

export type DirectBreathingState =
  | "breath-held"
  | "waking"
  | "awake"
  | "sleeping";

export type DirectBreathingLimits = {
  intervalSeconds: number;
  maxTicks: number;
  maxContextBytes: number;
  maxOutputTokensPerTick: number;
  maxTotalOutputTokens: number;
  maxSessionSeconds: number;
};

export type DirectBreathingStatus = {
  state: DirectBreathingState;
  attemptedTicks: number;
  successfulTicks: number;
  reservedOutputTokens: number;
  wakeLeaseMs: number | null;
  nextTickUtc: string | null;
  lastTickUtc: string | null;
  holdReason: string | null;
};
