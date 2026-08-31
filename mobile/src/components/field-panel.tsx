import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  buildFieldEncounters,
  nextFieldEncounter,
  type FieldEncounter,
} from "@/field/field";
import {
  clearHouseMembership,
  houseForCode,
  loadHouseMembership,
  saveHouseMembership,
  type HouseCode,
} from "@/field/houses";
import { useHoloStore } from "@/state/holo-store";
import { colors } from "@/theme/colors";
import { CompanionField } from "./companion-field";
import { FieldRadar } from "./field-radar";
import { HouseGate } from "./house-gate";
import { WorkPreviewPanel } from "./work-preview-panel";

type FieldMode = "companion" | "work";

export function FieldPanel({ onOpenStage }: { onOpenStage: () => void }) {
  const store = useHoloStore();
  const { width } = useWindowDimensions();
  const [houseLoading, setHouseLoading] = useState(true);
  const [houseCode, setHouseCode] = useState<HouseCode | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<FieldMode>("companion");
  const encounters = useMemo(
    () => buildFieldEncounters(store.gallery),
    [store.gallery],
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    encounters[0]?.id ?? null,
  );

  useEffect(() => {
    void loadHouseMembership()
      .then(setHouseCode)
      .catch(() => {
        setStorageNotice(
          "House membership storage is unavailable; selection will last for this session.",
        );
      })
      .finally(() => setHouseLoading(false));
  }, []);

  const effectiveSelectedId = encounters.some(
    (encounter) => encounter.id === selectedId,
  )
    ? selectedId
    : encounters[0]?.id ?? null;
  const selected =
    encounters.find((encounter) => encounter.id === effectiveSelectedId) ??
    null;
  const selectedHouse = houseCode ? houseForCode(houseCode) : null;
  const chooseHouse = (code: HouseCode) => {
    setHouseCode(code);
    void saveHouseMembership(code).catch(() => {
      setStorageNotice(
        "House selected for this session; local persistence is unavailable.",
      );
    });
  };
  const clearHouse = () => {
    setHouseCode(null);
    setMode("companion");
    void clearHouseMembership().catch(() => {
      setStorageNotice("House cleared for this session.");
    });
  };
  const meet = (encounter: FieldEncounter) => {
    store.previewGalleryOrganism(encounter.organism);
    onOpenStage();
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        width >= 1080 && styles.contentWide,
      ]}
      style={styles.scroll}
    >
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>HOLO FIELD</Text>
          <Text style={styles.title}>Explore. Meet. Request.</Text>
          <Text style={styles.subtitle}>
            An offline field radar for living digital organisms plus an
            explicit proof-first work lane—all inside Holo Zoo.
          </Text>
        </View>
        <View style={styles.houseBadge}>
          <Text style={styles.houseLabel}>YOUR HOUSE</Text>
          <Text style={styles.houseName}>
            {selectedHouse?.name ?? "Required"}
          </Text>
          {selectedHouse ? (
            <Pressable accessibilityRole="button" onPress={clearHouse}>
              <Text style={styles.change}>Change house</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {houseLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>Opening local House membership…</Text>
        </View>
      ) : houseCode === null ? (
        <>
          {storageNotice ? (
            <Text style={styles.storageNotice}>{storageNotice}</Text>
          ) : null}
          <HouseGate selected={houseCode} onSelect={chooseHouse} />
        </>
      ) : (
        <>
          {storageNotice ? (
            <Text style={styles.storageNotice}>{storageNotice}</Text>
          ) : null}
          <View style={styles.modeSwitch}>
            {(["companion", "work"] as const).map((candidate) => (
              <Pressable
                key={candidate}
                accessibilityRole="tab"
                accessibilityLabel={`Open ${candidate} mode`}
                accessibilityState={{ selected: mode === candidate }}
                onPress={() => setMode(candidate)}
                style={[
                  styles.mode,
                  mode === candidate && styles.modeActive,
                ]}
              >
                <Text style={styles.modeName}>
                  {candidate === "companion" ? "COMPANION" : "WORK"}
                </Text>
                <Text style={styles.modeDetail}>
                  {candidate === "companion"
                    ? "Play, presence, discovery"
                    : "Explicit service preview"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.radarHeader}>
            <View style={styles.radarHeaderCopy}>
              <Text style={styles.sectionTitle}>Nearby Holo signals</Text>
              <Text style={styles.radarCopy}>
                Permissionless sample field · no GPS, map provider, or uploaded
                location
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const next = nextFieldEncounter(
                  encounters,
                  effectiveSelectedId,
                );
                if (next) setSelectedId(next.id);
              }}
              style={styles.pulse}
            >
              <Text style={styles.pulseText}>PULSE FIELD</Text>
            </Pressable>
          </View>

          <FieldRadar
            encounters={encounters}
            selectedId={effectiveSelectedId}
            onSelect={(encounter) => setSelectedId(encounter.id)}
          />

          {mode === "companion" ? (
            <CompanionField encounter={selected} onMeet={meet} />
          ) : (
            <WorkPreviewPanel encounter={selected} />
          )}

          <View style={styles.constitution}>
            <Text style={styles.constitutionTitle}>
              GAMEPLAY & COMPANIONSHIP CONSTITUTION
            </Text>
            <Text style={styles.constitutionCopy}>
              The relationship and the game outrank the business model.
              Spending cannot buy affection, memory, survival, House power,
              encounter odds, Growth, or provenance truth.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    width: "100%",
    gap: 16,
    padding: 14,
    paddingBottom: 48,
  },
  contentWide: {
    maxWidth: 1180,
    alignSelf: "center",
    padding: 24,
  },
  hero: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  heroCopy: {
    flex: 1,
    gap: 5,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1.1,
  },
  subtitle: {
    maxWidth: 720,
    color: colors.muted,
    lineHeight: 20,
  },
  houseBadge: {
    minWidth: 132,
    gap: 3,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  houseLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  houseName: {
    color: colors.green,
    fontSize: 17,
    fontWeight: "900",
  },
  change: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "800",
  },
  loading: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: colors.muted,
  },
  storageNotice: {
    color: colors.amber,
    fontSize: 12,
  },
  modeSwitch: {
    flexDirection: "row",
    gap: 8,
    padding: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  mode: {
    flex: 1,
    gap: 2,
    padding: 12,
    borderRadius: 12,
  },
  modeActive: {
    backgroundColor: colors.panelRaised,
  },
  modeName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.8,
  },
  modeDetail: {
    color: colors.muted,
    fontSize: 10,
    textAlign: "center",
  },
  radarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  radarHeaderCopy: {
    minWidth: 210,
    flex: 1,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  radarCopy: {
    color: colors.muted,
    fontSize: 11,
  },
  pulse: {
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.panelRaised,
  },
  pulseText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  constitution: {
    gap: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: colors.panel,
  },
  constitutionTitle: {
    color: colors.green,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  constitutionCopy: {
    color: colors.text,
    lineHeight: 19,
  },
});
