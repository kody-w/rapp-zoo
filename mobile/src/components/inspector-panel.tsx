import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useHoloStore } from "@/state/holo-store";
import { ownershipStatusLabel } from "@/capsules/registry";
import {
  livenessExpiresAtMs,
  OPERATIONAL_CONSCIOUSNESS,
  presentLiveness,
} from "@/lib/liveness";
import { useLivenessClock } from "@/lib/use-liveness-clock";
import { redactInspectionRecord } from "@/lib/redact-inspection";
import { useDirectBreathing } from "@/providers/breathing-context";
import type { DirectBreathingState } from "@/providers/types";
import { colors } from "@/theme/colors";
import { Button, MetadataRow, SectionTitle } from "./ui";
import { HOLO_ZOO_RELEASE_POLICY } from "@/release-policy";

export function InspectorPanel() {
  const store = useHoloStore();
  const direct = useDirectBreathing();
  const [showSource, setShowSource] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const livenessNow = useLivenessClock([
    livenessExpiresAtMs(store.liveness),
  ]);
  const hostLiveness = presentLiveness(
    store.liveness,
    store.selection?.kind === "live" && store.liveness
      ? {
          holoId: store.verifiedLivenessTick?.holoId ?? "",
          sourceFrameHash:
            store.verifiedLivenessTick?.sourceFrameHash ?? "",
          expectedHoloId: store.selectedHead?.holoId ?? null,
          expectedSourceFrameHash:
            store.selectedHead?.sourceFrameHash ?? null,
          sourceVerified: store.verifiedLivenessTick !== null,
        }
      : undefined,
    livenessNow,
    store.awaitingSuccessorRappid === store.selectedHead?.subjectRappid,
  );
  const isHostSelection = store.selection?.kind === "live";
  const livenessState = isHostSelection
    ? hostLiveness.state
    : directBreathingLabel(direct.breathing.state);
  const livenessDetail = isHostSelection
    ? hostLiveness.detail
    : direct.message ??
      "Breath held until a secure key is verified and bounded breathing is explicitly started.";
  const holo = store.selected;
  if (!holo) {
    return (
      <View style={styles.empty}>
        <Text style={styles.title}>Holo Copilot</Text>
        {store.selectedHead ? (
          <>
            <Text style={styles.classification}>{hostLiveness.state}</Text>
            <Text style={styles.muted}>{hostLiveness.detail}</Text>
          </>
        ) : null}
        <Text style={styles.muted}>
          {store.selectedHead
            ? "No verified Rolling Core frame exists to inspect yet."
            : "Select a Rapter or Rolling Core frame to inspect it."}
        </Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.eyebrow}>INSPECTION + OWNERSHIP</Text>
        <Text style={styles.title}>Holo Copilot</Text>
      </View>

      <View style={styles.section}>
        <SectionTitle>Ownership</SectionTitle>
        {store.selectedCapsule ? (
          <>
            <Text
              style={styles.classification}
            >
              {ownershipStatusLabel(
                store.selectedCapsule,
                store.selectedRegistryRecord,
              )}
            </Text>
            <MetadataRow
              label="Capsule"
              value={store.selectedCapsule.capsuleId}
            />
            <MetadataRow
              label="Rapter"
              value={store.selectedCapsule.organism.displayName}
            />
            <MetadataRow
              label="Signer"
              value={store.selectedCapsule.trustedSigner}
            />
            {store.selectedCapsule.credit ? (
              <>
                <MetadataRow
                  label="Rapter Credit"
                  value={store.selectedCapsule.credit.creditId}
                />
                <MetadataRow
                  label="Stable organism"
                  value={store.selectedCapsule.credit.organismRappid}
                />
                <MetadataRow
                  label="Genesis core"
                  value={store.selectedCapsule.credit.genesisCoreId}
                />
                <Text style={styles.trait}>
                  Signed provenance metadata. Valuation, redemption, return,
                  resale, and transfer controls are not exposed in this build.
                </Text>
                {store.selectedRegistryRecord ? (
                  <>
                    <MetadataRow
                      label="Registry"
                      value={store.selectedRegistryRecord.registryId}
                    />
                    <MetadataRow
                      label="Registry sequence"
                      value={String(
                        store.selectedRegistryRecord.registrySequence,
                      )}
                    />
                    <MetadataRow
                      label="Official status"
                      value={store.selectedRegistryRecord.status}
                    />
                    <MetadataRow
                      label="Status record"
                      value={store.selectedRegistryRecord.recordHash}
                    />
                  </>
                ) : (
                  <Text style={styles.warning}>
                    No verified Rapterbox registry status is mirrored locally.
                    This renders as an unverified copy/preview, not official
                    ownership.
                  </Text>
                )}
                <Button
                  disabled={
                    !HOLO_ZOO_RELEASE_POLICY.externalInteroperabilityEnabled
                  }
                  onPress={() => void store.refreshSelectedRegistry()}
                >
                  Registry refresh disabled
                </Button>
              </>
            ) : (
              <Text style={styles.trait}>
                Bundled free capsule; no separate Rapter Credit binding.
              </Text>
            )}
            <Text style={styles.trait}>
              Registry status controls official provenance claims, not whether
              local capsule bytes can render. This capsule remains usable
              offline and can be exported, AirDropped, backed up, and
              re-imported.
            </Text>
          </>
        ) : store.selection?.kind === "gallery" ? (
          <Text style={styles.trait}>
            Gallery preview only. Signed ownership and local custody metadata
            are unavailable in preview.
          </Text>
        ) : (
          <Text style={styles.trait}>
            Legacy Holo frame. Signed Rolling Core Capsules are the durable
            ownership object.
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <SectionTitle>Current vs player-active</SectionTitle>
        <MetadataRow label="Current" value={store.authoritativeHoloId} />
        <MetadataRow
          label="Player active"
          value={store.playerStatus.playerActiveHoloId}
        />
        <MetadataRow
          label="Host player active"
          value={store.selectedHead?.hostPlayerActiveId}
        />
        <MetadataRow label="Selected" value={holo.id} />
        <MetadataRow
          label="Logical time"
          value={`${store.playerStatus.logicalMs} ms`}
        />
        {store.playerStatus.error ? (
          <Text style={styles.error}>{store.playerStatus.error}</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionTitle>Holo frame</SectionTitle>
        <MetadataRow label="Sequence" value={String(holo.holoSequence)} />
        <MetadataRow label="Subject" value={holo.subjectRappid} />
        <MetadataRow label="Visual parent" value={holo.visualParent} />
        <Text style={styles.description}>{holo.accessibilityDescription}</Text>
        <Text style={styles.trait}>
          SHAPEE remains an optional primitive inside the authored full-frame scene.
        </Text>
      </View>

      <View style={styles.section}>
        <SectionTitle>Rapter liveness</SectionTitle>
        <Text style={styles.classification}>{livenessState}</Text>
        <Text style={styles.description}>{livenessDetail}</Text>
        {isHostSelection ? (
          <>
            <MetadataRow
              label="Wake lease"
              value={
                store.liveness?.wakeLeaseMs === null ||
                store.liveness?.wakeLeaseMs === undefined
                  ? "not configured"
                  : `${store.liveness.wakeLeaseMs} ms`
              }
            />
            <MetadataRow
              label="Host state"
              value={store.liveness?.state ?? "unavailable"}
            />
            <MetadataRow
              label="Tick age"
              value={
                hostLiveness.effectiveAgeMs === null
                  ? "not observed"
                  : `${hostLiveness.effectiveAgeMs} ms`
              }
            />
            <MetadataRow
              label="Last tick UTC"
              value={store.liveness?.lastTickUtc ?? "none"}
            />
          </>
        ) : (
          <>
            <MetadataRow
              label="Secure key"
              value={direct.keyStatus.replaceAll("-", " ")}
            />
            <MetadataRow
              label="Breath control"
              value={direct.breathing.state.replaceAll("-", " ")}
            />
            <MetadataRow
              label="Cadence"
              value={`${direct.limits.intervalSeconds} seconds`}
            />
            <MetadataRow
              label="Wake lease"
              value={
                direct.breathing.wakeLeaseMs === null
                  ? "not active"
                  : `${direct.breathing.wakeLeaseMs} ms`
              }
            />
            <MetadataRow
              label="Tick budget"
              value={`${direct.breathing.attemptedTicks}/${direct.limits.maxTicks}`}
            />
            <MetadataRow
              label="Context budget"
              value={`${direct.limits.maxContextBytes} bytes`}
            />
            <MetadataRow
              label="Token budget"
              value={`${direct.breathing.reservedOutputTokens}/${direct.limits.maxTotalOutputTokens}`}
            />
          </>
        )}
        <Text style={styles.trait}>
          A tick exists only when source evidence and a successor Rolling Core
          frame verify. No advancing tick means Sleeping—not deleted or dead.
          The next valid successor wakes the same immutable history.
        </Text>
        <Text style={styles.trait}>
          Consciousness: {OPERATIONAL_CONSCIOUSNESS}
        </Text>
      </View>

      <View style={styles.section}>
        <SectionTitle>AI-presence evidence</SectionTitle>
        <Text style={styles.classification}>
          {store.presence?.classification ?? "indeterminate"}
        </Text>
        {(store.presence?.reasonCodes ??
          store.selectedHead?.presenceReasonCodes ??
          []).map((reason) => (
          <Text key={reason} style={styles.reason}>
            {reason}
          </Text>
        ))}
        <Text style={styles.trait}>
          This rolling heuristic is separate from verified-tick liveness and
          is not biological or scientific proof.
        </Text>
      </View>

      <View style={styles.section}>
        <SectionTitle>Growl contract</SectionTitle>
        <Text style={styles.description}>{holo.growl.message}</Text>
        <Text style={styles.trait}>
          Playback consumes only completed NOTE(pitch, delta_onset, duration,
          velocity) events. It never autoplays or invents notes.
        </Text>
      </View>

      <View style={styles.section}>
        <SectionTitle>Source binding</SectionTitle>
        <Text
          style={[
            styles.classification,
            store.sourceProof.kind === "refused" && styles.error,
          ]}
        >
          {store.sourceProof.message}
        </Text>
        <MetadataRow label="Source stream" value={holo.sourceStreamId} />
        <MetadataRow label="Source sequence" value={String(holo.sourceSequence)} />
        <MetadataRow label="Source hash" value={holo.sourceFrameHash} />
        {store.sourceProof.kind === "verified" ? (
          <>
            <Button onPress={() => setShowSource((value) => !value)}>
              {showSource
                ? "Hide source proof summary"
                : "Inspect source proof summary"}
            </Button>
            {showSource ? (
              <Text selectable style={styles.json}>
                {JSON.stringify(
                  redactInspectionRecord(store.sourceProof.source),
                  null,
                  2,
                )}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionTitle>
          {store.selectedCapsule ? "Signed capsule" : "Immutable record"}
        </SectionTitle>
        <MetadataRow label="Authored hash" value={holo.authoredHash} />
        <Button onPress={() => setShowRecord((value) => !value)}>
          {showRecord
            ? "Hide record proof summary"
            : "Inspect record proof summary"}
        </Button>
        {showRecord ? (
          <Text selectable style={styles.json}>
            {JSON.stringify(
              redactInspectionRecord(
                store.selectedCapsule?.root ?? holo.root,
              ),
              null,
              2,
            )}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function directBreathingLabel(
  state: DirectBreathingState,
): "Awake" | "Sleeping" | "Waking" {
  if (state === "breath-held") return "Sleeping";
  return `${state[0]!.toUpperCase()}${state.slice(1)}` as
    | "Awake"
    | "Sleeping"
    | "Waking";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.panel,
  },
  content: {
    gap: 14,
    padding: 18,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 8,
    backgroundColor: colors.panel,
  },
  eyebrow: {
    color: colors.violet,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "900",
  },
  muted: {
    color: colors.muted,
  },
  section: {
    gap: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  description: {
    color: colors.text,
    lineHeight: 20,
  },
  trait: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  classification: {
    color: colors.green,
    fontWeight: "800",
  },
  reason: {
    color: colors.muted,
    fontFamily: "monospace",
    fontSize: 11,
  },
  error: {
    color: colors.red,
  },
  warning: {
    color: colors.amber,
    fontSize: 12,
    lineHeight: 18,
  },
  birthLabel: {
    color: colors.green,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  liveLabel: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  json: {
    color: colors.text,
    fontFamily: "monospace",
    fontSize: 10,
    lineHeight: 15,
  },
});
