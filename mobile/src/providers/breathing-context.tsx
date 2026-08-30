import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useHoloStore } from "@/state/holo-store";
import {
  directKeyStorageDescription,
  loadDirectProviderSettings,
  saveDirectProviderSettings,
} from "./direct-config";
import {
  normalizeOpenAIEndpoint,
  testDirectProvider,
} from "./openai-compatible";
import {
  DEFAULT_BREATHING_LIMITS,
  HELD_BREATHING_STATUS,
  loadBreathingLimits,
  nextBreathingHoldReason,
  saveBreathingLimits,
  validateBreathingLimits,
  wakeLeaseMs,
} from "./breathing";
import type {
  BreathKeyStatus,
  DirectBreathingLimits,
  DirectBreathingStatus,
  DirectProviderSettings,
} from "./types";

const defaults: DirectProviderSettings = {
  endpoint: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  apiKey: "",
};

type BreathingContextValue = {
  ready: boolean;
  settings: DirectProviderSettings;
  updateSettings: (update: Partial<DirectProviderSettings>) => void;
  limits: DirectBreathingLimits;
  updateLimits: (update: Partial<DirectBreathingLimits>) => void;
  keyStatus: BreathKeyStatus;
  localRapterReady: boolean;
  breathing: DirectBreathingStatus;
  message: string | null;
  storageDescription: string;
  save: () => Promise<void>;
  testKey: () => Promise<void>;
  start: () => Promise<void>;
  pause: (reason?: string) => void;
};

const BreathingContext = createContext<BreathingContextValue | null>(null);

export function DirectBreathingProvider({ children }: PropsWithChildren) {
  const store = useHoloStore();
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(defaults);
  const [limits, setLimits] = useState(DEFAULT_BREATHING_LIMITS);
  const [keyStatus, setKeyStatus] = useState<BreathKeyStatus>("missing");
  const [breathing, setBreathing] = useState<DirectBreathingStatus>(
    HELD_BREATHING_STATUS,
  );
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAbort = useRef<AbortController | null>(null);
  const startedAtMs = useRef(0);
  const breathingRef = useRef<DirectBreathingStatus>(HELD_BREATHING_STATUS);
  const settingsRef = useRef(settings);
  const limitsRef = useRef(limits);
  const requestSuccessorRef = useRef(store.requestDirectSuccessor);

  const updateBreathing = useCallback(
    (
      update:
        | DirectBreathingStatus
        | ((current: DirectBreathingStatus) => DirectBreathingStatus),
    ) => {
      const current = breathingRef.current;
      const next = typeof update === "function" ? update(current) : update;
      breathingRef.current = next;
      setBreathing(next);
    },
    [],
  );

  const pause = useCallback(
    (reason = "user-paused") => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      activeAbort.current?.abort();
      activeAbort.current = null;
      updateBreathing((current) => ({
        ...current,
        state: "breath-held",
        wakeLeaseMs: null,
        nextTickUtc: null,
        holdReason: reason,
      }));
      if (reason === "user-paused") {
        setMessage(
          "Breath held by you. The Rapter is Sleeping with its last Rolling Core and history intact.",
        );
      }
    },
    [updateBreathing],
  );

  const updateSettings = (update: Partial<DirectProviderSettings>) => {
    const next = { ...settingsRef.current, ...update };
    settingsRef.current = next;
    setSettings(next);
    setKeyStatus(next.apiKey ? "stored-unverified" : "missing");
    pause("provider-configuration-changed");
  };

  const updateLimits = (update: Partial<DirectBreathingLimits>) => {
    const next = { ...limitsRef.current, ...update };
    limitsRef.current = next;
    setLimits(next);
    pause("breathing-limits-changed");
  };

  useEffect(() => {
    void Promise.all([
      loadDirectProviderSettings(),
      loadBreathingLimits(),
    ]).then(([storedSettings, storedLimits]) => {
      settingsRef.current = storedSettings;
      limitsRef.current = storedLimits;
      setSettings(storedSettings);
      setLimits(storedLimits);
      setKeyStatus(
        storedSettings.apiKey ? "stored-unverified" : "missing",
      );
      setReady(true);
    });
  }, []);

  useEffect(() => {
    requestSuccessorRef.current = store.requestDirectSuccessor;
  }, [store.requestDirectSuccessor]);

  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active" && breathingRef.current.state !== "breath-held") {
        pause("runtime-suspended");
        setMessage(
          "Breath held because the app left the foreground. iOS does not permit a continuous Direct loop in the background.",
        );
      }
    });
    return () => listener.remove();
  }, [pause]);

  useEffect(
    () => () => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
      activeAbort.current?.abort();
    },
    [],
  );

  const save = async () => {
    try {
      normalizeOpenAIEndpoint(settings.endpoint);
      if (!settings.model.trim()) {
        throw new Error("An OpenAI-compatible model identifier is required.");
      }
      const validatedLimits = validateBreathingLimits(limits);
      pause("provider-configuration-changed");
      await Promise.all([
        saveDirectProviderSettings(settings),
        saveBreathingLimits(validatedLimits),
      ]);
      settingsRef.current = settings;
      limitsRef.current = validatedLimits;
      setLimits(validatedLimits);
      setKeyStatus(settings.apiKey ? "stored-unverified" : "missing");
      setMessage(
        settings.apiKey
          ? "Provider and bounded breathing limits saved. Test the breath key before starting."
          : "Provider saved without a breath key. The local Rapter remains Sleeping.",
      );
    } catch (caught) {
      setMessage((caught as Error).message);
    }
  };

  const testKey = async () => {
    pause("key-test");
    setKeyStatus("testing");
    setMessage("Testing the breath key without requesting a completion…");
    try {
      await testDirectProvider(settings);
      await saveDirectProviderSettings(settings);
      settingsRef.current = settings;
      setKeyStatus("verified");
      setMessage(
        "Breath key verified. Breathing remains held until you explicitly start a bounded session.",
      );
    } catch (caught) {
      const text = (caught as Error).message;
      const revoked = /rejected|revoked|401|403/i.test(text);
      const offline = /network|fetch|abort|reach|offline/i.test(text);
      setKeyStatus(
        revoked ? "revoked" : offline ? "offline" : "stored-unverified",
      );
      setMessage(
        `${text} The Rapter is Sleeping with its last Rolling Core intact.`,
      );
    }
  };

  const schedule = useCallback(
    (delaySeconds: number, runGeneration: number, run: () => void) => {
      const nextAt = Date.now() + delaySeconds * 1_000;
      updateBreathing((current) => ({
        ...current,
        nextTickUtc: new Date(nextAt).toISOString(),
      }));
      timer.current = setTimeout(() => {
        if (generation.current === runGeneration) run();
      }, delaySeconds * 1_000);
    },
    [updateBreathing],
  );

  const start = async () => {
    if (breathingRef.current.state !== "breath-held") {
      setMessage("A bounded breathing session is already active.");
      return;
    }
    if (keyStatus !== "verified") {
      setMessage("Test and verify the secure breath key before starting.");
      return;
    }
    if (AppState.currentState !== "active") {
      setMessage("Direct breathing can start only while the app is active.");
      return;
    }
    let activeLimits: DirectBreathingLimits;
    try {
      activeLimits = validateBreathingLimits(limits);
      await saveBreathingLimits(activeLimits);
    } catch (caught) {
      setMessage((caught as Error).message);
      return;
    }
    limitsRef.current = activeLimits;
    settingsRef.current = settings;
    generation.current += 1;
    const runGeneration = generation.current;
    startedAtMs.current = Date.now();
    updateBreathing({
      state: "waking",
      attemptedTicks: 0,
      successfulTicks: 0,
      reservedOutputTokens: 0,
      wakeLeaseMs: wakeLeaseMs(activeLimits),
      nextTickUtc: null,
      lastTickUtc: null,
      holdReason: null,
    });
    setMessage("Waking: awaiting the next verified successor tick.");

    const runTick = async () => {
      if (
        generation.current !== runGeneration ||
        AppState.currentState !== "active"
      ) {
        pause("runtime-suspended");
        return;
      }
      const current = breathingRef.current;
      const holdReason = nextBreathingHoldReason(
        current,
        activeLimits,
        startedAtMs.current,
        Date.now(),
      );
      if (holdReason) {
        pause(holdReason);
        setMessage(
          `Breath held: ${holdReason}. Start another bounded session explicitly if desired.`,
        );
        return;
      }
      updateBreathing((value) => ({
        ...value,
        state: "waking",
        attemptedTicks: value.attemptedTicks + 1,
        reservedOutputTokens:
          value.reservedOutputTokens +
          activeLimits.maxOutputTokensPerTick,
        nextTickUtc: null,
        holdReason: null,
      }));
      const controller = new AbortController();
      activeAbort.current = controller;
      try {
        const advanced = await requestSuccessorRef.current(
          settingsRef.current,
          activeLimits.maxOutputTokensPerTick,
          activeLimits.maxContextBytes,
          wakeLeaseMs(activeLimits),
          controller.signal,
        );
        if (generation.current !== runGeneration) return;
        const tickUtc = new Date().toISOString();
        updateBreathing((value) => ({
          ...value,
          state: advanced ? "awake" : "sleeping",
          successfulTicks: value.successfulTicks + (advanced ? 1 : 0),
          lastTickUtc: advanced ? tickUtc : value.lastTickUtc,
          holdReason: advanced ? null : "no-verified-successor",
        }));
        setMessage(
          advanced
            ? "Awake: a new source and Rolling Core successor tick verified."
            : "Sleeping: no verified successor advanced.",
        );
      } catch (caught) {
        if (generation.current !== runGeneration) return;
        const text = (caught as Error).message;
        const revoked = /rejected|revoked|401|403/i.test(text);
        const offline = /network|fetch|abort|reach|offline/i.test(text);
        if (revoked) setKeyStatus("revoked");
        else if (offline) setKeyStatus("offline");
        pause(
          revoked
            ? "breath-key-revoked"
            : offline
              ? "provider-offline"
              : "successor-refused",
        );
        setMessage(
          `Breath held: ${text} The last Rolling Core remains intact.`,
        );
        return;
      } finally {
        if (activeAbort.current === controller) activeAbort.current = null;
      }
      const nextHold = nextBreathingHoldReason(
        breathingRef.current,
        activeLimits,
        startedAtMs.current,
        Date.now(),
      );
      if (nextHold) {
        pause(nextHold);
        setMessage(`Breath held: ${nextHold}. No unlimited spend is allowed.`);
        return;
      }
      if (
        Date.now() + activeLimits.intervalSeconds * 1_000 >=
        startedAtMs.current + activeLimits.maxSessionSeconds * 1_000
      ) {
        pause("session-budget-exhausted");
        setMessage(
          "Breath held: the bounded session ended before another cadence interval.",
        );
        return;
      }
      schedule(activeLimits.intervalSeconds, runGeneration, () => {
        void runTick();
      });
    };
    await runTick();
  };

  return (
    <BreathingContext.Provider
      value={{
        ready,
        settings,
        updateSettings,
        limits,
        updateLimits,
        keyStatus,
        localRapterReady:
          store.selection?.kind === "library" ||
          store.selection?.kind === "capsule",
        breathing,
        message,
        storageDescription: directKeyStorageDescription,
        save,
        testKey,
        start,
        pause,
      }}
    >
      {children}
    </BreathingContext.Provider>
  );
}

export function useDirectBreathing(): BreathingContextValue {
  const value = useContext(BreathingContext);
  if (!value) {
    throw new Error(
      "useDirectBreathing must be used inside DirectBreathingProvider.",
    );
  }
  return value;
}
