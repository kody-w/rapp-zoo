import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  CapsuleLifecycleSnapshot,
  LifecycleUxState,
} from "./types";

const PREFIX = "@holo-zoo/lifecycle/";
const EVENT_ID = /^rce_[0-9a-f]{32}$/;
const STATES = new Set<LifecycleUxState>([
  "owned",
  "return-eligible",
  "return-pending",
  "returned",
  "listed",
  "sold",
  "unverified-copy",
]);

export async function loadLifecycleSnapshot(
  creditId: string,
): Promise<CapsuleLifecycleSnapshot | null> {
  const raw = await AsyncStorage.getItem(`${PREFIX}${creditId}`);
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as {
      schema?: unknown;
      snapshot?: CapsuleLifecycleSnapshot;
    };
    if (envelope.schema !== "holo-zoo-lifecycle-mirror/1") return null;
    const value = envelope.snapshot;
    if (
      !value ||
      value.creditId !== creditId ||
      !STATES.has(value.state) ||
      typeof value.officialOwned !== "boolean" ||
      typeof value.updatedUtc !== "string"
    ) {
      return null;
    }
    if (
      ["returned", "listed", "sold"].includes(value.state) &&
      (!value.eventVerified ||
        typeof value.lastEventId !== "string" ||
        !EVENT_ID.test(value.lastEventId))
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function storeLifecycleSnapshot(
  snapshot: CapsuleLifecycleSnapshot,
): Promise<void> {
  if (!snapshot.creditId) return;
  await AsyncStorage.setItem(
    `${PREFIX}${snapshot.creditId}`,
    JSON.stringify({
      schema: "holo-zoo-lifecycle-mirror/1",
      snapshot,
    }),
  );
}
