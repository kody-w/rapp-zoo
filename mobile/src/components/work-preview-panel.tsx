import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { FieldEncounter } from "@/field/field";
import {
  WORK_PREVIEW_CATEGORIES,
  advanceLocalWorkPreview,
  createLocalWorkPreview,
  workPreviewStatus,
  type LocalWorkPreview,
  type WorkPreviewCategory,
} from "@/field/work-preview";
import { colors } from "@/theme/colors";
import { Button, SectionTitle } from "./ui";

export function WorkPreviewPanel({
  encounter,
}: {
  encounter: FieldEncounter | null;
}) {
  const [category, setCategory] = useState<WorkPreviewCategory>("research");
  const [preview, setPreview] = useState<LocalWorkPreview | null>(null);
  const activePreview =
    preview?.organismId === encounter?.organism.id ? preview : null;

  if (!encounter) {
    return (
      <View style={styles.card}>
        <SectionTitle>Work preview</SectionTitle>
        <Text style={styles.copy}>Select a Rapter signal first.</Text>
      </View>
    );
  }

  const status = activePreview ? workPreviewStatus(activePreview) : null;
  const phaseIndex = activePreview
    ? [
        "draft",
        "status_walkthrough",
        "proof_walkthrough",
        "delivery_walkthrough",
      ].indexOf(activePreview.phase)
    : -1;
  const start = () => {
    setPreview(
      createLocalWorkPreview({
        organismId: encounter.organism.id,
        organismRappid: encounter.organism.previewFrame.subjectRappid,
        category,
        requestedUtc: new Date().toISOString(),
      }),
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>WORK MODE · UI WALKTHROUGH ONLY</Text>
      <SectionTitle>Request {encounter.organism.displayName}</SectionTitle>
      <Text style={styles.copy}>
        This previews the future proof-first dispatch experience. It creates no
        official RapterWorks job, payment, tip, Coin, public proof, or service
        claim.
      </Text>
      <View style={styles.categories}>
        {WORK_PREVIEW_CATEGORIES.map((item) => (
          <Pressable
            key={item.code}
            accessibilityRole="button"
            accessibilityState={{ selected: category === item.code }}
            disabled={activePreview !== null}
            onPress={() => setCategory(item.code)}
            style={[
              styles.category,
              category === item.code && styles.categoryActive,
              activePreview !== null && styles.disabled,
            ]}
          >
            <Text style={styles.categoryName}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.request}>
        {
          WORK_PREVIEW_CATEGORIES.find((item) => item.code === category)!
            .request
        }
      </Text>
      {activePreview && status ? (
        <View style={styles.status}>
          <Text style={styles.statusLabel}>{status.label}</Text>
          <Text style={styles.statusDetail}>{status.detail}</Text>
          <View style={styles.dispatchTrack}>
            {["REQUEST UI", "STATUS UI", "PROOF UI", "DELIVERY UI"].map(
              (label, index) => (
                <View key={label} style={styles.trackStep}>
                  <View
                    style={[
                      styles.trackDot,
                      index <= phaseIndex && styles.trackDotActive,
                    ]}
                  />
                  <Text
                    style={[
                      styles.trackLabel,
                      index <= phaseIndex && styles.trackLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              ),
            )}
          </View>
          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>SELECTED RAPTER</Text>
              <Text style={styles.metricValue}>
                {encounter.organism.displayName}
              </Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>SAMPLE ETA</Text>
              <Text style={styles.metricValue}>≤ 15 min</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>PRIVACY</Text>
              <Text style={styles.metricValue}>On-device</Text>
            </View>
          </View>
          <Text style={styles.limit}>
            Bounded sample · {activePreview.maxMinutes} min ·{" "}
            {activePreview.maxOutputTokens.toLocaleString("en-US")} output tokens max
          </Text>
          {status.nextAction ? (
            <Button
              tone="accent"
              onPress={() =>
                setPreview(advanceLocalWorkPreview(activePreview))
              }
            >
              {status.nextAction}
            </Button>
          ) : (
            <Text style={styles.complete}>
              No job, work, proof, artifact, delivery, payment, tip, or public
              publication occurred.
            </Text>
          )}
        </View>
      ) : (
        <Button tone="accent" onPress={start}>
          Draft local work preview
        </Button>
      )}
      <Text style={styles.constitution}>
        Work mode cannot alter companion affection, memory, power, House,
        encounter odds, Growth Points, or access to an owned local capsule.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  eyebrow: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  copy: {
    color: colors.text,
    lineHeight: 20,
  },
  categories: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  category: {
    minWidth: 86,
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  categoryActive: {
    borderColor: colors.amber,
  },
  categoryName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  request: {
    color: colors.muted,
    lineHeight: 18,
  },
  status: {
    gap: 9,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  statusLabel: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  statusDetail: {
    color: colors.text,
    lineHeight: 19,
  },
  dispatchTrack: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 4,
    paddingVertical: 4,
  },
  trackStep: {
    flex: 1,
    alignItems: "center",
    gap: 5,
  },
  trackDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  trackDotActive: {
    borderColor: colors.amber,
    backgroundColor: colors.amber,
  },
  trackLabel: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  trackLabelActive: {
    color: colors.text,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  metric: {
    minWidth: 90,
    flex: 1,
    gap: 3,
    padding: 9,
    borderRadius: 10,
    backgroundColor: colors.panelRaised,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  metricValue: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
  },
  limit: {
    color: colors.muted,
    fontSize: 11,
  },
  complete: {
    color: colors.green,
    fontWeight: "800",
    lineHeight: 19,
  },
  constitution: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
});
