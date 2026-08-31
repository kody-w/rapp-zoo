import { useRouter } from "expo-router";
import { useMemo, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { buildPlayerHtml } from "@/lib/player-html";
import { canonicalize, strictParse } from "@/lib/strict-json";
import type { JsonObject } from "@/lib/types";
import { useBilling } from "@/billing/billing-context";
import { useHoloStore } from "@/state/holo-store";
import { colors } from "@/theme/colors";
import HoloStage from "./holo-stage";
import type { HoloStageHandle } from "./holo-stage-types";
import { Button, SectionTitle } from "./ui";

export function StagePanel({
  reducedMotion,
  commerce = "allowed",
}: {
  reducedMotion: boolean;
  commerce?: "allowed" | "hidden";
}) {
  const store = useHoloStore();
  const billing = useBilling();
  const router = useRouter();
  const stage = useRef<HoloStageHandle>(null);
  const update = store.playerUpdate(reducedMotion);
  const updateJson = update ? canonicalize(update) : null;
  const html = useMemo(
    () =>
      updateJson
        ? buildPlayerHtml(strictParse(updateJson) as JsonObject)
        : null,
    [updateJson],
  );
  const growl = store.selected?.growl;
  const wildSelection = store.selection?.kind === "live";
  const wildGrowlWithinQuota =
    growl?.kind !== "playable" ||
    growl.notes.length <= billing.features.wildGrowlMaxNotes;
  const growlAllowed =
    !wildSelection ||
    (billing.features.remoteAccess && wildGrowlWithinQuota);
  const commerceAllowed = commerce === "allowed";
  const playGrowl = () => {
    if (growl?.kind !== "playable") return;
    if (!growlAllowed) {
      if (commerceAllowed) router.push("/upgrade");
      else store.setInfo("Managed Growl is unavailable in Companion Stage.");
      return;
    }
    stage.current?.playGrowl(growl);
  };
  const growlMessage =
    growl?.kind === "playable" && !growlAllowed
      ? commerceAllowed
        ? `This managed Growl needs a Wild plan supporting ${growl.notes.length} NOTE events.`
        : "Managed Growl is unavailable in Companion Stage."
      : growl?.message ?? "Select a Holo frame to inspect Growl.";
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>LIVE HOLO STAGE</Text>
          <Text style={styles.title}>
            {store.selectedHead?.displayName ?? "Local projection"}
          </Text>
        </View>
        <View
          style={[
            styles.status,
            store.playerStatus.error ? styles.statusError : styles.statusGood,
          ]}
        >
          <Text style={styles.statusText}>
            {store.playerStatus.error
              ? "Refused"
              : store.playerStatus.playerActiveHoloId
                ? "Player active"
                : "Loading"}
          </Text>
        </View>
      </View>

      <View style={styles.stage}>
        {html ? (
          <HoloStage
            ref={stage}
            html={html}
            onStatus={store.updatePlayerStatus}
            onGrowlResult={store.setInfo}
          />
        ) : (
          <View style={styles.emptyStage}>
            <Text style={styles.emptyTitle}>No Rolling Core selected</Text>
            <Text style={styles.emptyText}>
              Choose a Rapter or an immutable local Rolling Core frame.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.growlRow}>
        <View style={styles.growlCopy}>
          <Text style={styles.growlTitle}>Completed MIDI Growl</Text>
          <Text style={styles.growlStatus}>
            {growlMessage}
          </Text>
        </View>
        <Button
          tone="accent"
          disabled={growl?.kind !== "playable" || (!growlAllowed && !commerceAllowed)}
          onPress={playGrowl}
          accessibilityLabel="Play Growl"
        >
          {growlAllowed || !commerceAllowed ? "Play Growl" : "Play Growl · Wild"}
        </Button>
        <Button
          disabled={growl?.kind !== "playable"}
          onPress={() =>
            !wildSelection || billing.features.wildGrowlExport
              ? void store.exportGrowl()
              : commerceAllowed
                ? router.push("/upgrade")
                : store.setInfo(
                    "Managed Growl export is unavailable in Companion Stage.",
                  )
          }
        >
          {!wildSelection ||
          billing.features.wildGrowlExport ||
          !commerceAllowed
            ? "Export NOTE JSON"
            : "Export · Wild"}
        </Button>
      </View>

      <View style={styles.flipbook}>
        <SectionTitle
          trailing={
            <Text style={styles.count}>{store.availableFrames.length} frames</Text>
          }
        >
          Immutable Growth · Frame by Frame
        </SectionTitle>
        <Text style={styles.growthCopy}>
          Interactions grow a Rolling Core by adding verified immutable frames;
          prior frames remain available for replay and recursive history.
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.frames}>
            {store.availableFrames.map((frame) => {
              const active = frame.id === store.playerStatus.playerActiveHoloId;
              const current = frame.id === store.authoritativeHoloId;
              const selected = frame.id === store.selected?.id;
              return (
                <Pressable
                  key={frame.id}
                  onPress={() => void store.selectFrame(frame)}
                  accessibilityRole="button"
                  accessibilityLabel={`Holo frame ${frame.holoSequence}`}
                  style={[styles.frame, selected && styles.selectedFrame]}
                >
                  <Text style={styles.frameSequence}>H{frame.holoSequence}</Text>
                  <Text style={styles.frameHash}>{frame.id.slice(0, 10)}…</Text>
                  <Text style={styles.frameFlags}>
                    {current ? "◆ current " : ""}
                    {active ? "▶ active" : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 18,
    gap: 14,
    backgroundColor: colors.background,
  },
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  status: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusGood: {
    borderColor: colors.green,
  },
  statusError: {
    borderColor: colors.red,
  },
  statusText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  stage: {
    flex: 1,
    minHeight: 330,
    overflow: "hidden",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.black,
  },
  emptyStage: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  emptyText: {
    color: colors.muted,
    textAlign: "center",
  },
  growlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.panel,
  },
  growlCopy: {
    flex: 1,
    gap: 3,
  },
  growlTitle: {
    color: colors.text,
    fontWeight: "800",
  },
  growlStatus: {
    color: colors.muted,
    fontSize: 12,
  },
  flipbook: {
    gap: 9,
  },
  count: {
    color: colors.muted,
    fontSize: 12,
  },
  growthCopy: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  frames: {
    flexDirection: "row",
    gap: 8,
  },
  frame: {
    width: 126,
    gap: 4,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  selectedFrame: {
    borderColor: colors.accent,
    backgroundColor: "#12344a",
  },
  frameSequence: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  frameHash: {
    color: colors.muted,
    fontFamily: "monospace",
    fontSize: 10,
  },
  frameFlags: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: "800",
  },
});
