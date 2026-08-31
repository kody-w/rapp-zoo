import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking } from "react-native";
import { useBilling } from "@/billing/billing-context";
import { lumenDriftCapsuleRaw } from "@/generated/capsule-fixtures";
import { demoSourceRaw } from "@/generated/holo-fixtures";
import { validateCapsuleRaw } from "@/capsules/capsule";
import {
  loadCapsuleLibrary,
  storeCapsule,
} from "@/capsules/capsule-library";
import { loadBundledGallery } from "@/capsules/gallery";
import {
  configuredCapsuleServiceEndpoint,
  createCapsuleRedemptionClient,
  createPreviewRedemptionClient,
} from "@/capsules/redemption";
import {
  configuredCreditRegistryEndpoint,
  createCreditRegistryClient,
} from "@/capsules/registry-client";
import {
  loadRegistryMirror,
  storeRegistryRecord,
} from "@/capsules/registry-mirror";
import { validateRegistryRecordRaw } from "@/capsules/registry";
import type {
  CapsuleLibraryEntry,
  GalleryOrganism,
  RapterCreditRegistryRecord,
  ValidatedCapsule,
} from "@/capsules/types";
import { ZooApi, type ZooHealth } from "@/lib/api";
import {
  exportJsonFile,
  pickJsonFile,
  readSharedFileUrl,
} from "@/lib/file-transfer";
import {
  buildPlayerUpdate,
  validateHoloRaw,
  verifySourceFrame,
} from "@/lib/holo";
import {
  loadBaseUrl,
  loadLibrary,
  saveBaseUrl,
  storeHolo,
} from "@/lib/library";
import { strictParse } from "@/lib/strict-json";
import { requestDirectSuccessorTick } from "@/providers/direct-tick";
import type { DirectProviderSettings } from "@/providers/types";
import type {
  FantasyDraft,
  HoloHead,
  HoloPresence,
  JsonObject,
  LibraryEntry,
  PlayerStatus,
  RollingCoreLiveness,
  ValidatedHolo,
} from "@/lib/types";

type Selection =
  | { kind: "live"; subjectRappid: string }
  | { kind: "library"; id: string }
  | { kind: "capsule"; id: string }
  | { kind: "gallery"; id: string };

type SourceProof =
  | { kind: "unavailable"; message: string }
  | { kind: "verified"; message: string; source: JsonObject }
  | { kind: "refused"; message: string };

type HoloStore = {
  ready: boolean;
  loading: boolean;
  baseUrl: string;
  health: ZooHealth | null;
  heads: HoloHead[];
  library: LibraryEntry[];
  capsules: CapsuleLibraryEntry[];
  gallery: GalleryOrganism[];
  selection: Selection | null;
  selectedCapsule: ValidatedCapsule | null;
  registryRecords: Record<string, RapterCreditRegistryRecord>;
  selectedRegistryRecord: RapterCreditRegistryRecord | null;
  selected: ValidatedHolo | null;
  availableFrames: ValidatedHolo[];
  authoritativeHoloId: string | null;
  selectedHead: HoloHead | null;
  presence: HoloPresence | null;
  liveness: RollingCoreLiveness | null;
  awaitingSuccessorRappid: string | null;
  verifiedLivenessTick: {
    holoId: string;
    sourceFrameHash: string;
  } | null;
  sourceProof: SourceProof;
  playerStatus: PlayerStatus;
  error: string | null;
  info: string | null;
  fantasyDraft: FantasyDraft | null;
  fantasyError: string | null;
  playerUpdate: (reducedMotion: boolean) => JsonObject | null;
  refresh: () => Promise<void>;
  updateHost: (value: string) => Promise<void>;
  selectHead: (head: HoloHead) => Promise<void>;
  selectLibrary: (entry: LibraryEntry) => void;
  selectCapsule: (entry: CapsuleLibraryEntry) => void;
  previewGalleryOrganism: (organism: GalleryOrganism) => void;
  redeemGalleryOrganism: (organism: GalleryOrganism) => Promise<void>;
  recoverCapsule: (capsuleId: string) => Promise<void>;
  refreshSelectedRegistry: () => Promise<void>;
  selectFrame: (frame: ValidatedHolo) => Promise<void>;
  importJson: () => Promise<void>;
  exportSelected: () => Promise<void>;
  exportGrowl: () => Promise<void>;
  updatePlayerStatus: (status: PlayerStatus) => void;
  setInfo: (message: string | null) => void;
  clearError: () => void;
  loadFantasyDraft: () => Promise<void>;
  requestDirectSuccessor: (
    settings: DirectProviderSettings,
    maxOutputTokens: number,
    maxContextBytes: number,
    wakeLeaseMs: number,
    signal?: AbortSignal,
  ) => Promise<boolean>;
};

const StoreContext = createContext<HoloStore | null>(null);
const emptyStatus: PlayerStatus = {
  authoritativeHoloId: null,
  playerActiveHoloId: null,
  logicalMs: 0,
  error: null,
};

export function HoloStoreProvider({ children }: PropsWithChildren) {
  const billing = useBilling();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:5000");
  const [health, setHealth] = useState<ZooHealth | null>(null);
  const [heads, setHeads] = useState<HoloHead[]>([]);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [capsules, setCapsules] = useState<CapsuleLibraryEntry[]>([]);
  const gallery = useRef(loadBundledGallery()).current;
  const previewRedemption = useRef(createPreviewRedemptionClient()).current;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedCapsule, setSelectedCapsule] =
    useState<ValidatedCapsule | null>(null);
  const [registryRecords, setRegistryRecords] = useState<
    Record<string, RapterCreditRegistryRecord>
  >({});
  const [selectedRegistryRecord, setSelectedRegistryRecord] =
    useState<RapterCreditRegistryRecord | null>(null);
  const [selected, setSelected] = useState<ValidatedHolo | null>(null);
  const [availableFrames, setAvailableFrames] = useState<ValidatedHolo[]>([]);
  const [authoritativeHoloId, setAuthoritativeHoloId] = useState<string | null>(
    null,
  );
  const [presence, setPresence] = useState<HoloPresence | null>(null);
  const [awaitingSuccessorRappid, setAwaitingSuccessorRappid] = useState<
    string | null
  >(null);
  const [verifiedLivenessTick, setVerifiedLivenessTick] = useState<{
    holoId: string;
    sourceFrameHash: string;
  } | null>(null);
  const [sourceProof, setSourceProof] = useState<SourceProof>({
    kind: "unavailable",
    message: "Source proof unavailable.",
  });
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>(emptyStatus);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fantasyDraft, setFantasyDraft] = useState<FantasyDraft | null>(null);
  const [fantasyError, setFantasyError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const bundledCapsule = validateCapsuleRaw(lumenDriftCapsuleRaw);
        await storeCapsule(bundledCapsule);
        const [host, entries, capsuleEntries, mirroredRegistry] =
          await Promise.all([
            loadBaseUrl(),
            loadLibrary(),
            loadCapsuleLibrary(),
            loadRegistryMirror(),
          ]);
        setBaseUrl(host);
        setLibrary(entries);
        setCapsules(capsuleEntries);
        setRegistryRecords(mirroredRegistry);
        const firstCapsule = capsuleEntries[0];
        const firstLegacy = entries[0];
        if (firstCapsule) applyCapsule(firstCapsule, mirroredRegistry);
        else if (firstLegacy) applyLibrary(firstLegacy, entries);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setReady(true);
      }
    })();
    // Bootstrap once from persisted local ownership state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      try {
        const raw = await readSharedFileUrl(url);
        if (raw) await importLocalRaw(raw);
      } catch (caught) {
        setError(`Shared capsule import failed: ${(caught as Error).message}`);
      }
    };
    void Linking.getInitialURL().then(handleUrl);
    const listener = Linking.addEventListener("url", (event) => {
      void handleUrl(event.url);
    });
    return () => listener.remove();
    // Bind the OS file-open listener once; imports use current persisted storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(): Promise<void> {
    if (!billing.features.remoteAccess) {
      setError(
        "Holo Zoo Wild unlocks remote Rapters and the managed Brainstem.",
      );
      return;
    }
    setLoading(true);
    setError(null);
    const refreshingSubject =
      selection?.kind === "live" &&
      heads.find(
        (head) => head.subjectRappid === selection.subjectRappid,
      )?.liveness?.state === "sleeping"
        ? selection.subjectRappid
        : null;
    setAwaitingSuccessorRappid(refreshingSubject);
    try {
      const api = new ZooApi(baseUrl);
      const [nextHealth, nextHeads] = await Promise.all([
        api.health(),
        api.heads(),
      ]);
      setHealth(nextHealth);
      setHeads(nextHeads);
      if (selection?.kind === "live") {
        const head = nextHeads.find(
          (item) => item.subjectRappid === selection.subjectRappid,
        );
        if (head) await loadLive(head, api);
      }
    } catch (caught) {
      setHealth(null);
      setError((caught as Error).message);
    } finally {
      setAwaitingSuccessorRappid(null);
      setLoading(false);
    }
  }

  async function updateHost(value: string): Promise<void> {
    const normalized = new ZooApi(value).baseUrl;
    await saveBaseUrl(normalized);
    setBaseUrl(normalized);
    setInfo("RAPP Zoo host saved. Refresh to reconnect.");
  }

  async function loadSource(
    holo: ValidatedHolo,
    api: ZooApi,
  ): Promise<boolean> {
    try {
      const source = await api.source(holo.sourceFrameHash);
      verifySourceFrame(source, holo);
      setSourceProof({
        kind: "verified",
        message: "Exact host source binding verified.",
        source,
      });
      return true;
    } catch (caught) {
      setSourceProof({
        kind: "refused",
        message: `Source proof refused: ${(caught as Error).message}`,
      });
      return false;
    }
  }

  async function loadLive(head: HoloHead, api = new ZooApi(baseUrl)): Promise<void> {
    if (!billing.features.remoteAccess) {
      setError(
        "Holo Zoo Wild unlocks remote Rapters and the managed Brainstem.",
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (head.liveness?.state === "unborn" || head.holoId === null) {
        setSelection({ kind: "live", subjectRappid: head.subjectRappid });
        setSelectedCapsule(null);
        setSelectedRegistryRecord(null);
        setSelected(null);
        setAvailableFrames([]);
        setAuthoritativeHoloId(null);
        setPresence(null);
        setVerifiedLivenessTick(null);
        setSourceProof({
          kind: "unavailable",
          message:
            "This Rapter is Unborn. Holo Zoo is waiting for its first verified genesis tick.",
        });
        setPlayerStatus(emptyStatus);
        return;
      }
      const [history, nextPresence] = await Promise.all([
        api.history(head.subjectRappid, billing.features.wildHistoryDepth),
        api.presence(head.subjectRappid),
      ]);
      const currentId = history.currentHeadId ?? head.holoId;
      const current = await api.frame(currentId);
      const frames = [
        current,
        ...history.frames.filter((frame) => frame.id !== current.id),
      ];
      setSelection({ kind: "live", subjectRappid: head.subjectRappid });
      setSelectedCapsule(null);
      setSelectedRegistryRecord(null);
      setSelected(current);
      setAvailableFrames(frames);
      setAuthoritativeHoloId(currentId);
      setPresence(nextPresence);
      setVerifiedLivenessTick(null);
      setPlayerStatus(emptyStatus);
      await storeHolo(current);
      setLibrary(await loadLibrary());
      if (await loadSource(current, api)) {
        setVerifiedLivenessTick({
          holoId: current.id,
          sourceFrameHash: current.sourceFrameHash,
        });
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function selectHead(head: HoloHead): Promise<void> {
    await loadLive(head);
  }

  function selectLibrary(entry: LibraryEntry): void {
    applyLibrary(entry, library);
  }

  function selectCapsule(entry: CapsuleLibraryEntry): void {
    applyCapsule(entry);
  }

  function previewGalleryOrganism(organism: GalleryOrganism): void {
    setSelection({ kind: "gallery", id: organism.id });
    setSelectedCapsule(null);
    setSelectedRegistryRecord(null);
    setSelected(organism.previewFrame);
    setAvailableFrames([organism.previewFrame]);
    setAuthoritativeHoloId(organism.previewFrame.id);
    setPresence(null);
    setAwaitingSuccessorRappid(null);
    setVerifiedLivenessTick(null);
    setSourceProof({
      kind: "unavailable",
      message:
        "Gallery preview only. Exact signed source and custody proof are unavailable in preview.",
    });
    setPlayerStatus(emptyStatus);
  }

  async function redeemGalleryOrganism(
    organism: GalleryOrganism,
  ): Promise<void> {
    if (billing.ledger.availableRapterCredits < 1) {
      setError("A one-time Rapter credit is required to redeem this organism.");
      return;
    }
    setLoading(true);
    try {
      const pendingKey = `@rolling-cores/pending-redemption/${organism.id}`;
      let redemptionId = await AsyncStorage.getItem(pendingKey);
      if (!redemptionId) {
        redemptionId = `rolling-core-${organism.id}-${Date.now()}`;
        await AsyncStorage.setItem(pendingKey, redemptionId);
      }
      let redemption;
      if (billing.billingEnvironment === "preview") {
        redemption = await previewRedemption.redeem({
          organismId: organism.id,
          capsuleAsset: organism.capsuleAsset,
          registryAsset: organism.registryAsset,
          redemptionId,
        });
        await billing.consumeRapterCredit(redemptionId);
      } else {
        const configured = configuredCapsuleServiceEndpoint();
        if (!configured.endpoint) throw new Error(configured.error!);
        redemption = await createCapsuleRedemptionClient(
          configured.endpoint,
        ).redeem({
          organismId: organism.id,
          redemptionId,
        });
        await billing.refreshLedger();
      }
      const { capsule, registryRecord } = redemption;
      await storeRegistryRecord(registryRecord);
      await storeCapsule(capsule);
      const entries = await loadCapsuleLibrary();
      const mirroredRegistry = await loadRegistryMirror();
      setCapsules(entries);
      setRegistryRecords(mirroredRegistry);
      const stored = entries.find((entry) => entry.id === capsule.capsuleId);
      if (stored) applyCapsule(stored, mirroredRegistry);
      await AsyncStorage.removeItem(pendingKey);
      setInfo(`${capsule.organism.displayName} now belongs to this device.`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function recoverCapsule(capsuleId: string): Promise<void> {
    const normalized = capsuleId.trim();
    if (!/^[0-9a-f]{64}$/.test(normalized)) {
      setError("Capsule recovery requires a 64-character capsule ID.");
      return;
    }
    setLoading(true);
    try {
      const redemption =
        billing.billingEnvironment === "preview"
          ? await previewRedemption.redownload(normalized)
          : await (async () => {
              const configured = configuredCapsuleServiceEndpoint();
              if (!configured.endpoint) throw new Error(configured.error!);
              return createCapsuleRedemptionClient(
                configured.endpoint,
              ).redownload(normalized);
            })();
      const { capsule, registryRecord } = redemption;
      await storeRegistryRecord(registryRecord);
      await storeCapsule(capsule);
      const entries = await loadCapsuleLibrary();
      const mirroredRegistry = await loadRegistryMirror();
      setCapsules(entries);
      setRegistryRecords(mirroredRegistry);
      const stored = entries.find((entry) => entry.id === capsule.capsuleId);
      if (stored) applyCapsule(stored, mirroredRegistry);
      setInfo(`Recovered ${capsule.organism.displayName}'s signed capsule.`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function selectFrame(frame: ValidatedHolo): Promise<void> {
    setPlayerStatus(emptyStatus);
    if (selection?.kind !== "live") {
      setSelected(frame);
      if (selection?.kind === "capsule" && selectedCapsule) {
        const source = selectedCapsule.sourceFrames.find(
          (candidate) =>
            candidate.frame_hash === frame.sourceFrameHash,
        );
        setSourceProof({
          kind: "verified",
          message: `Signed capsule verified by ${selectedCapsule.trustedSigner}.`,
          source: source ?? selectedCapsule.root,
        });
      } else {
        setSourceProof(
          localSourceProof(
            frame,
            library.find((entry) => entry.id === frame.id)?.source ?? null,
          ),
        );
      }
      return;
    }
    setLoading(true);
    try {
      const api = new ZooApi(baseUrl);
      const exact = await api.frame(frame.id);
      setSelected(exact);
      await loadSource(exact, api);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshSelectedRegistry(): Promise<void> {
    if (!selectedCapsule?.credit) {
      setError("This local capsule has no purchased Rapter Credit binding.");
      return;
    }
    await refreshRegistryForCapsule(selectedCapsule, true, true);
  }

  async function refreshRegistryForCapsule(
    capsule: ValidatedCapsule,
    announce = false,
    selectRecord = false,
  ): Promise<void> {
    if (!capsule.credit) return;
    const configured = configuredCreditRegistryEndpoint();
    if (!configured.endpoint) {
      if (announce) setError(configured.error!);
      return;
    }
    try {
      const record = await createCreditRegistryClient(
        configured.endpoint,
      ).fetchStatus(capsule.credit.creditId, capsule);
      await storeRegistryRecord(record);
      const next = { ...registryRecords, [record.creditId]: record };
      setRegistryRecords(next);
      if (
        selectRecord ||
        selectedCapsule?.capsuleId === capsule.capsuleId
      ) {
        setSelectedRegistryRecord(record);
      }
      if (announce) {
        setInfo(`Official ownership status refreshed: ${record.status}.`);
      }
    } catch (caught) {
      if (announce) setError((caught as Error).message);
    }
  }

  async function importJson(): Promise<void> {
    try {
      const raw = await pickJsonFile();
      if (raw === null) return;
      await importLocalRaw(raw);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function importLocalRaw(raw: string): Promise<void> {
    try {
      const parsed = strictParse(raw);
      const isCapsule =
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        parsed.schema === "rolling-core-capsule/1";
      if (isCapsule) {
        const capsule = validateCapsuleRaw(raw);
        await storeCapsule(capsule);
        const capsuleEntries = await loadCapsuleLibrary();
        setCapsules(capsuleEntries);
        const stored = capsuleEntries.find(
          (entry) => entry.id === capsule.capsuleId,
        );
        if (stored) applyCapsule(stored);
        setInfo(
          `Imported signed capsule for ${capsule.organism.displayName}.`,
        );
        return;
      }
      const holo = validateHoloRaw(raw);
      await storeHolo(holo);
      const entries = await loadLibrary();
      setLibrary(entries);
      const entry = entries.find((item) => item.id === holo.id);
      if (entry) applyLibrary(entry, entries);
      setInfo(`Imported immutable Holo ${holo.id.slice(0, 12)}…`);
    } catch (caught) {
      throw new Error((caught as Error).message);
    }
  }

  async function exportSelected(): Promise<void> {
    if (!selected) return;
    try {
      if (selectedCapsule) {
        await exportJsonFile(
          `${selectedCapsule.organism.id}-${selectedCapsule.capsuleId}.rollingcore.json`,
          selectedCapsule.raw,
        );
        setInfo(
          `Exported ${selectedCapsule.organism.displayName}'s signed capsule.`,
        );
      } else {
        await exportJsonFile(`holo-${selected.id}.json`, selected.raw);
        setInfo("Exported the selected legacy Holo JSON.");
      }
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function exportGrowl(): Promise<void> {
    if (!selected || selected.growl.kind !== "playable") return;
    if (
      selection?.kind === "live" &&
      !billing.features.wildGrowlExport
    ) {
      setError("Holo Zoo Wild unlocks managed Growl NOTE export.");
      return;
    }
    try {
      await exportJsonFile(
        `growl-${selected.id}.json`,
        `${JSON.stringify(selected.growl.value, null, 2)}\n`,
      );
      setInfo("Exported the completed Growl NOTE data.");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function loadFantasyDraft(): Promise<void> {
    setFantasyError(null);
    if (!billing.features.fantasyDrafts) {
      setFantasyDraft(null);
      setFantasyError(
        "A 3- or 10-slot Rappter flock Wild plan unlocks fantasy drafts.",
      );
      return;
    }
    try {
      setFantasyDraft(await new ZooApi(baseUrl).fantasyDraft());
    } catch (caught) {
      setFantasyDraft(null);
      setFantasyError((caught as Error).message);
    }
  }

  async function requestDirectSuccessor(
    settings: DirectProviderSettings,
    maxOutputTokens: number,
    maxContextBytes: number,
    leaseMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (
      !selected ||
      selection?.kind === "live" ||
      selection?.kind === "gallery"
    ) {
      throw new Error(
        "Select an owned or imported local Rapter before starting Direct breathing.",
      );
    }
    if (sourceProof.kind !== "verified") {
      throw new Error(
        "Direct breathing requires the selected Rolling Core's verified source.",
      );
    }
    if (!selected.outerFrame) {
      throw new Error(
        "Direct breathing requires the selected Rolling Core's verified body frame.",
      );
    }
    const result = await requestDirectSuccessorTick({
      settings,
      current: selected,
      previousSourceFrame: sourceProof.source,
      previousBodyFrame: selected.outerFrame,
      maxContextBytes,
      maxOutputTokens,
      wakeLeaseMs: leaseMs,
      ...(signal ? { signal } : {}),
    });
    await storeHolo(result.holo, undefined, result.source);
    const nextLibrary = await loadLibrary();
    setLibrary(nextLibrary);
    setSelection({ kind: "library", id: result.holo.id });
    setSelected(result.holo);
    setAvailableFrames([
      result.holo,
      ...availableFrames.filter((frame) => frame.id !== result.holo.id),
    ]);
    setAuthoritativeHoloId(result.holo.id);
    setPresence(null);
    setAwaitingSuccessorRappid(null);
    setVerifiedLivenessTick(null);
    setSourceProof({
      kind: "verified",
      message: "Direct breath successor and exact source binding verified.",
      source: result.source,
    });
    setPlayerStatus(emptyStatus);
    setInfo("A verified Direct successor tick joined this Rapter's history.");
    return true;
  }

  function applyLibrary(entry: LibraryEntry, entries: LibraryEntry[]): void {
    const frames = entries
      .map((item) => item.holo)
      .filter((holo) => holo.subjectRappid === entry.holo.subjectRappid)
      .sort((left, right) => right.holoSequence - left.holoSequence);
    setSelection({ kind: "library", id: entry.id });
    setSelectedCapsule(null);
    setSelectedRegistryRecord(null);
    setSelected(entry.holo);
    setAvailableFrames(frames);
    setAuthoritativeHoloId(frames[0]?.id ?? entry.id);
    setPresence(null);
    setAwaitingSuccessorRappid(null);
    setVerifiedLivenessTick(null);
    setSourceProof(localSourceProof(entry.holo, entry.source));
    setPlayerStatus(emptyStatus);
  }

  function applyCapsule(
    entry: CapsuleLibraryEntry,
    mirror = registryRecords,
  ): void {
    const frames = entry.capsule.frames;
    let registryRecord: RapterCreditRegistryRecord | null = null;
    if (entry.capsule.credit) {
      const mirrored = mirror[entry.capsule.credit.creditId];
      if (mirrored) {
        try {
          registryRecord = validateRegistryRecordRaw(
            mirrored.raw,
            entry.capsule,
          );
          registryRecord = {
            ...registryRecord,
            verifiedAt: mirrored.verifiedAt,
          };
        } catch {
          registryRecord = null;
        }
      }
    }
    setSelection({ kind: "capsule", id: entry.id });
    setSelectedCapsule(entry.capsule);
    setSelectedRegistryRecord(registryRecord);
    setSelected(frames[0] ?? null);
    setAvailableFrames(frames);
    setAuthoritativeHoloId(frames[0]?.id ?? null);
    setPresence(null);
    setAwaitingSuccessorRappid(null);
    setVerifiedLivenessTick(null);
    setSourceProof({
      kind: "verified",
      message: `Signed capsule verified by ${entry.capsule.trustedSigner}.`,
      source: entry.capsule.sourceFrames[0] ?? entry.capsule.root,
    });
    setPlayerStatus(emptyStatus);
    if (entry.capsule.credit && !registryRecord) {
      void refreshRegistryForCapsule(entry.capsule, false, true);
    }
  }

  const selectedHead =
    selection?.kind === "live"
      ? heads.find((head) => head.subjectRappid === selection.subjectRappid) ??
        null
      : null;
  const liveness = selectedHead?.liveness ?? null;
  const value: HoloStore = {
    ready,
    loading,
    baseUrl,
    health,
    heads,
    library,
    capsules,
    gallery,
    selection,
    selectedCapsule,
    registryRecords,
    selectedRegistryRecord,
    selected,
    availableFrames,
    authoritativeHoloId,
    selectedHead,
    presence,
    liveness,
    awaitingSuccessorRappid,
    verifiedLivenessTick,
    sourceProof,
    playerStatus,
    error,
    info,
    fantasyDraft,
    fantasyError,
    playerUpdate: (reducedMotion) =>
      selected
        ? buildPlayerUpdate(
            selected,
            availableFrames,
            authoritativeHoloId ?? selected.id,
            reducedMotion,
          )
        : null,
    refresh,
    updateHost,
    selectHead,
    selectLibrary,
    selectCapsule,
    previewGalleryOrganism,
    redeemGalleryOrganism,
    recoverCapsule,
    refreshSelectedRegistry,
    selectFrame,
    importJson,
    exportSelected,
    exportGrowl,
    updatePlayerStatus: setPlayerStatus,
    setInfo,
    clearError: () => setError(null),
    loadFantasyDraft,
    requestDirectSuccessor,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function localSourceProof(
  holo: ValidatedHolo,
  storedSource: JsonObject | null = null,
): SourceProof {
  try {
    const source = verifySourceFrame(
      storedSource ?? strictParse(demoSourceRaw),
      holo,
    );
    return {
      kind: "verified",
      message: "Exact bundled source binding verified.",
      source,
    };
  } catch {
    return {
      kind: "unavailable",
      message: "Source proof is not bundled with this local import.",
    };
  }
}

export function useHoloStore(): HoloStore {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useHoloStore must be used inside HoloStoreProvider.");
  return value;
}
