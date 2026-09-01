import { Link } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useBilling } from "@/billing/billing-context";
import { directPlan } from "@/billing/catalog";
import { brand } from "@/config/brand";
import {
  livenessExpiresAtMs,
  presentLiveness,
} from "@/lib/liveness";
import { useLivenessClock } from "@/lib/use-liveness-clock";
import { useHoloStore } from "@/state/holo-store";
import { colors } from "@/theme/colors";
import { Button, SectionTitle } from "./ui";
import { ProviderSettings } from "./provider-settings";

export function Sidebar({
  onSelected,
  onShowOnboarding,
}: {
  onSelected: () => void;
  onShowOnboarding: () => void;
}) {
  const store = useHoloStore();
  const billing = useBilling();
  const [draftHost, setDraftHost] = useState(store.baseUrl);
  const livenessNow = useLivenessClock(
    store.heads.map((head) => livenessExpiresAtMs(head.liveness)),
  );
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Holo Zoo Rapters and immutable Rolling Core library"
    >
      <View style={styles.brand}>
        <Text style={styles.eyebrow}>{brand.product.toUpperCase()}</Text>
        <Text style={styles.title}>{brand.displayName}</Text>
        <Text style={styles.tagline}>{brand.tagline}</Text>
        <Text style={styles.from}>
          {brand.poweredBy} {brand.from}
        </Text>
      </View>

      <SectionTitle
        trailing={<Text style={styles.caption}>{store.gallery.length}</Text>}
      >
        Rapter Gallery
      </SectionTitle>
      {store.gallery.map((organism) => {
        const localCapsule = store.capsules.find(
          (entry) => entry.capsule.capsuleId === organism.capsuleId,
        );
        const registry = localCapsule?.capsule.credit
          ? store.registryRecords[localCapsule.capsule.credit.creditId]
          : null;
        return (
          <View key={organism.id} style={styles.card}>
            <Text style={styles.cardTitle}>{organism.displayName}</Text>
            <Text style={styles.cardMeta}>{organism.description}</Text>
            <Text style={styles.creditValue}>
              {localCapsule
                ? "Signed local capsule"
                : "Local preview · not available for purchase"}
            </Text>
            <View style={styles.actionRow}>
              <Button
                onPress={() => {
                  store.previewGalleryOrganism(organism);
                  onSelected();
                }}
              >
                Preview
              </Button>
              {localCapsule ? (
                <Text
                  style={[
                    styles.owned,
                    localCapsule.capsule.credit &&
                      registry?.status !== "official" &&
                      styles.unverified,
                  ]}
                >
                  {!localCapsule.capsule.credit
                    ? "BUNDLED LOCAL"
                    : registry?.status === "official"
                      ? "OFFICIAL · LOCAL"
                      : "UNVERIFIED COPY"}
                </Text>
              ) : (
                <Text style={styles.unverified}>PREVIEW ONLY</Text>
              )}
            </View>
          </View>
        );
      })}

      <SectionTitle
        trailing={<Text style={styles.caption}>{store.capsules.length}</Text>}
      >
        Owned Rolling Core Capsules
      </SectionTitle>
      {store.capsules.map((entry) => {
        const selected =
          store.selection?.kind === "capsule" && store.selection.id === entry.id;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            onPress={() => {
              store.selectCapsule(entry);
              onSelected();
            }}
            style={[styles.card, selected && styles.selectedCard]}
          >
            <Text style={styles.cardTitle}>
              {entry.capsule.organism.displayName}
            </Text>
            <Text style={styles.cardMeta}>
              Signed capsule · {entry.capsule.frames.length} frame
              {entry.capsule.frames.length === 1 ? "" : "s"}
            </Text>
            <Text
              style={[
                styles.owned,
                entry.capsule.credit &&
                  store.registryRecords[entry.capsule.credit.creditId]
                    ?.status !== "official" &&
                  styles.unverified,
              ]}
            >
              {!entry.capsule.credit
                ? "BUNDLED LOCAL"
                : store.registryRecords[entry.capsule.credit.creditId]
                      ?.status === "official"
                  ? "SIGNED · LOCAL"
                  : "UNVERIFIED COPY / PREVIEW"}
            </Text>
            <Text numberOfLines={1} style={styles.hash}>
              {entry.capsule.capsuleId}
            </Text>
          </Pressable>
        );
      })}

      <SectionTitle
        trailing={<Text style={styles.caption}>{store.library.length}</Text>}
      >
        Legacy Holo Imports
      </SectionTitle>
      {store.library.map((entry) => {
        const selected =
          store.selection?.kind === "library" && store.selection.id === entry.id;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            onPress={() => {
              store.selectLibrary(entry);
              onSelected();
            }}
            style={[styles.card, selected && styles.selectedCard]}
          >
            <Text numberOfLines={2} style={styles.cardTitle}>
              {entry.holo.accessibilityDescription}
            </Text>
            <Text style={styles.cardMeta}>H{entry.holo.holoSequence}</Text>
            <Text numberOfLines={1} style={styles.hash}>
              {entry.id}
            </Text>
          </Pressable>
        );
      })}
      <View style={styles.actionRow}>
        <Button onPress={() => void store.importJson()}>
          Import Capsule / JSON
        </Button>
        <Button disabled={!store.selected} onPress={() => void store.exportSelected()}>
          Export
        </Button>
      </View>
      <Text style={styles.caption}>
        {store.capsules.length} signed capsules and {store.library.length} legacy
        frames. Owned local data is never gated, hidden, or deleted.
      </Text>
      <SectionTitle>Optional compute & connectivity</SectionTitle>
      <ProviderSettings />

      <View style={styles.connection}>
        <SectionTitle
          trailing={
            store.loading ? <ActivityIndicator color={colors.accent} /> : undefined
          }
        >
          Wild RAPP Zoo
        </SectionTitle>
        <TextInput
          accessibilityLabel="RAPP Zoo base URL"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={draftHost}
          onChangeText={setDraftHost}
          placeholder="http://192.168.1.10:5000"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <View style={styles.actionRow}>
          <Button onPress={() => void store.updateHost(draftHost)}>Save</Button>
          <Button tone="accent" onPress={() => void store.refresh()}>
            {billing.features.remoteAccess ? "Refresh" : "Refresh · Wild"}
          </Button>
        </View>

        <View
          style={styles.planCard}
          accessibilityLabel={`Current compute mode ${billing.features.accessMode}. Commerce is disabled in this build.`}
        >
          <View>
            <Text style={styles.planLabel}>COMPUTE MODE</Text>
            <Text style={styles.planName}>
              {billing.features.accessMode === "wild"
                ? `Wild · ${billing.ledger.activeWildRapters} active`
                : directPlan.title}
            </Text>
          </View>
          <Text style={styles.planLink}>NO COMMERCE</Text>
        </View>
        <Text style={styles.caption}>
          {store.health
            ? `${store.health.name} ${store.health.version} · ${store.health.status}`
            : "Cloud access is optional. Owned capsules remain available offline."}
        </Text>
      </View>

      <SectionTitle>Connected Rapters / Holo Heads</SectionTitle>
      {store.heads.length === 0 ? (
        <Text style={styles.empty}>No connected Rapters loaded.</Text>
      ) : (
        store.heads.map((head) => {
          const selected =
            store.selection?.kind === "live" &&
            store.selection.subjectRappid === head.subjectRappid;
          const liveness = presentLiveness(
            head.liveness,
            selected
              ? {
                  holoId: store.verifiedLivenessTick?.holoId ?? "",
                  sourceFrameHash:
                    store.verifiedLivenessTick?.sourceFrameHash ?? "",
                  expectedHoloId: head.holoId,
                  expectedSourceFrameHash: head.sourceFrameHash,
                  sourceVerified: store.verifiedLivenessTick !== null,
                }
              : undefined,
            livenessNow,
            store.awaitingSuccessorRappid === head.subjectRappid,
          );
          return (
            <Pressable
              key={head.subjectRappid}
              accessibilityRole="button"
              accessibilityLabel={`${head.displayName}, ${liveness.state}`}
              onPress={() => {
                void store.selectHead(head);
                onSelected();
              }}
              style={[styles.card, selected && styles.selectedCard]}
            >
              <View style={styles.row}>
                <Text style={styles.cardTitle}>{head.displayName}</Text>
                <Text style={styles.sequence}>
                  {head.holoSequence === null
                    ? "NO GENESIS"
                    : `H${head.holoSequence}`}
                </Text>
              </View>
              <Text style={styles.cardMeta}>
                {liveness.state} · verified tick cadence
              </Text>
              <Text style={styles.caption}>
                {head.liveness?.lastTickUtc
                  ? `Last tick ${head.liveness.lastTickUtc} · age ${
                      liveness.effectiveAgeMs ?? head.liveness.ageMs
                    } ms / lease ${
                      head.liveness.wakeLeaseMs === null
                        ? "none"
                        : `${head.liveness.wakeLeaseMs} ms`
                    }`
                  : "No verified tick yet"}
              </Text>
              <Text numberOfLines={1} style={styles.hash}>
                {head.holoId ?? head.subjectRappid}
              </Text>
            </Pressable>
          );
        })
      )}
      <Link href="/fantasy" asChild>
        <Pressable style={styles.fantasy} accessibilityRole="link">
          <Text style={styles.fantasyTitle}>Fantasy Draft Sample →</Text>
          <Text style={styles.caption}>
            Load Rapter One, Rapter Two, and AI participants from the host.
          </Text>
        </Pressable>
      </Link>
      <Text style={styles.privacy}>
        Local app data can include the House code, host URL, signed or imported
        capsules, Holo history and evidence, provider endpoint/model/settings,
        and preferences. A provider key stays in device secure storage. No
        automatic RapterBox telemetry. See Privacy below.
      </Text>
      <View style={styles.brandLinks}>
        <Pressable onPress={() => void Linking.openURL(brand.marketingUrl)}>
          <Text style={styles.brandLink}>Holo Zoo</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(brand.privacyUrl)}>
          <Text style={styles.brandLink}>Privacy</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(brand.supportUrl)}>
          <Text style={styles.brandLink}>Support</Text>
        </Pressable>
      </View>
      <Text style={styles.laneNote}>
        A Rappter is a flock of Rapters. RAPP/1 remains the separate protocol
        and developer lane.
      </Text>
      <Button onPress={onShowOnboarding}>Vocabulary & onboarding</Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.panel,
  },
  content: {
    padding: 18,
    gap: 14,
  },
  brand: {
    gap: 4,
    paddingBottom: 6,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
  },
  tagline: {
    color: colors.muted,
    fontSize: 14,
  },
  from: {
    color: colors.violet,
    fontSize: 11,
    fontWeight: "800",
  },
  connection: {
    gap: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  planCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: "#12344a",
  },
  planLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  planName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  planLink: {
    color: colors.accent,
    fontWeight: "800",
  },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    backgroundColor: colors.panelRaised,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  caption: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  empty: {
    color: colors.muted,
    paddingVertical: 8,
  },
  card: {
    gap: 5,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  selectedCard: {
    borderColor: colors.accent,
    backgroundColor: "#12344a",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    color: colors.text,
    fontWeight: "800",
    fontSize: 14,
  },
  sequence: {
    color: colors.amber,
    fontWeight: "900",
  },
  cardMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  valueSummary: {
    color: colors.amber,
    fontSize: 11,
    lineHeight: 16,
  },
  creditValue: {
    color: colors.green,
    fontFamily: "monospace",
    fontSize: 10,
  },
  owned: {
    alignSelf: "center",
    color: colors.green,
    fontSize: 10,
    fontWeight: "900",
  },
  unverified: {
    color: colors.amber,
  },
  hash: {
    color: colors.muted,
    fontFamily: "monospace",
    fontSize: 10,
  },
  fantasy: {
    gap: 5,
    padding: 14,
    borderRadius: 14,
    borderColor: colors.violet,
    borderWidth: 1,
    backgroundColor: "#211a3c",
  },
  fantasyTitle: {
    color: colors.text,
    fontWeight: "800",
  },
  privacy: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    paddingVertical: 12,
  },
  brandLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  brandLink: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
  },
  laneNote: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 15,
    paddingBottom: 10,
  },
});
