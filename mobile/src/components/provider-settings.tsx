import { StyleSheet, Text, TextInput, View } from "react-native";
import { useBilling } from "@/billing/billing-context";
import { useDirectBreathing } from "@/providers/breathing-context";
import { wakeLeaseMs } from "@/providers/breathing";
import { configuredWildBrainstem } from "@/providers/openai-compatible";
import type { DirectBreathingLimits } from "@/providers/types";
import { HOLO_ZOO_RELEASE_POLICY } from "@/release-policy";
import { colors } from "@/theme/colors";
import { Button, SectionTitle } from "./ui";

export function ProviderSettings() {
  const billing = useBilling();
  const direct = useDirectBreathing();
  const wild = configuredWildBrainstem();
  const active = direct.breathing.state !== "breath-held";
  const updateState =
    direct.breathing.state === "breath-held"
      ? "PAUSED"
      : direct.breathing.state === "awake"
        ? "PROCESSING"
        : direct.breathing.state.replaceAll("-", " ").toUpperCase();
  const setLimit = (key: keyof DirectBreathingLimits, value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isSafeInteger(parsed)) {
      direct.updateLimits({ [key]: parsed });
    }
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.modeHeader}>
        <SectionTitle>Provider mode</SectionTitle>
        <Text style={styles.mode}>
          {billing.features.accessMode === "wild" ? "WILD" : "DIRECT"}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Direct · included</Text>
        <Text style={styles.caption}>
          One local Rapter uses your own OpenAI-compatible endpoint and key.
          Local playback, history, import, validation, and owned-data export
          remain available without a purchase. A successfully tested key is
          an approved provider key, but saving or testing never starts a model
          request or spend.
        </Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>SECURE KEY</Text>
          <Text
            style={[
              styles.statusValue,
              direct.keyStatus !== "verified" && styles.statusPending,
            ]}
          >
            {direct.keyStatus.replaceAll("-", " ").toUpperCase()}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>LOCAL UPDATES</Text>
          <Text
            style={[
              styles.statusValue,
              direct.breathing.state !== "awake" && styles.statusPending,
            ]}
          >
            {updateState}
          </Text>
        </View>
        <TextInput
          accessibilityLabel="Direct OpenAI-compatible endpoint"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={direct.settings.endpoint}
          onChangeText={(endpoint) =>
            direct.updateSettings({ endpoint })
          }
          placeholder="https://api.openai.com/v1"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Direct model identifier"
          autoCapitalize="none"
          autoCorrect={false}
          value={direct.settings.model}
          onChangeText={(model) =>
            direct.updateSettings({ model })
          }
          placeholder="gpt-5-mini"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Direct provider API key"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={direct.settings.apiKey}
          onChangeText={(apiKey) =>
            direct.updateSettings({ apiKey })
          }
          placeholder="Your API key"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <View style={styles.actionRow}>
          <Button disabled={!direct.ready} onPress={() => void direct.save()}>
            Save
          </Button>
          <Button
            disabled={
              !direct.ready ||
              !direct.settings.apiKey ||
              direct.keyStatus === "testing"
            }
            onPress={() => void direct.testKey()}
          >
            Test Provider Key
          </Button>
        </View>
        <Text style={styles.storage}>{direct.storageDescription}</Text>

        <Text style={styles.cardTitle}>Bounded local updates</Text>
        <Text style={styles.caption}>
          Opt in to request verified successors only while Holo Zoo remains
          active. Every session has hard cadence, tick, token, and time
          ceilings. There is no unlimited-spend setting. Your provider may
          charge for every attempt; Holo Zoo cannot predict its currency price.
        </Text>
        <View style={styles.limitGrid}>
          <LimitInput
            label="Cadence seconds"
            value={direct.limits.intervalSeconds}
            onChange={(value) => setLimit("intervalSeconds", value)}
          />
          <LimitInput
            label="Maximum updates"
            value={direct.limits.maxTicks}
            onChange={(value) => setLimit("maxTicks", value)}
          />
          <LimitInput
            label="Context byte budget"
            value={direct.limits.maxContextBytes}
            onChange={(value) => setLimit("maxContextBytes", value)}
          />
          <LimitInput
            label="Tokens per update"
            value={direct.limits.maxOutputTokensPerTick}
            onChange={(value) => setLimit("maxOutputTokensPerTick", value)}
          />
          <LimitInput
            label="Total token budget"
            value={direct.limits.maxTotalOutputTokens}
            onChange={(value) => setLimit("maxTotalOutputTokens", value)}
          />
          <LimitInput
            label="Session seconds"
            value={direct.limits.maxSessionSeconds}
            onChange={(value) => setLimit("maxSessionSeconds", value)}
          />
        </View>
        <Text style={styles.caption}>
          Attempts {direct.breathing.attemptedTicks}/
          {direct.limits.maxTicks} · verified updates{" "}
          {direct.breathing.successfulTicks} · reserved output tokens{" "}
          {direct.breathing.reservedOutputTokens}/
          {direct.limits.maxTotalOutputTokens} · processing lease{" "}
          {wakeLeaseMs(direct.limits) / 1_000}s · context ≤{" "}
          {direct.limits.maxContextBytes} bytes
        </Text>
        <View style={styles.actionRow}>
          <Button
            tone="accent"
            disabled={
              !direct.ready ||
              direct.keyStatus !== "verified" ||
              !direct.localRapterReady ||
              active
            }
            onPress={() => void direct.start()}
          >
            Start Bounded Updates
          </Button>
          <Button disabled={!active} onPress={() => direct.pause()}>
            Pause Updates
          </Button>
        </View>
        <Text style={styles.caption}>
          iOS may suspend this app moments after it leaves the foreground.
          Holo Zoo pauses Direct updates immediately; it never pretends local
          background activity continued. Select an owned or imported local
          Rapter before starting.
        </Text>
        {direct.message ? (
          <Text
            style={[
              styles.status,
              direct.keyStatus === "revoked" ||
              direct.keyStatus === "offline"
                ? styles.error
                : undefined,
            ]}
          >
            {direct.message}
          </Text>
        ) : null}
      </View>

      {HOLO_ZOO_RELEASE_POLICY.managedComputeSalesEnabled ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Wild · {billing.ledger.activeWildRapters} active Rapters
          </Text>
          <Text style={styles.caption}>
            Managed processing uses the hosted Azure Function Brainstem,
            provider routing, quota, revocation, and remote access.
          </Text>
          <Text style={[styles.status, wild.error ? styles.error : undefined]}>
            {wild.error ??
              `Managed Brainstem ready at ${wild.endpoint} using ${wild.model}.`}
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Managed processing unavailable</Text>
          <Text style={styles.caption}>
            This internal TestFlight keeps managed compute sales, continuous
            cloud updates, and production RapterWorks disabled. Local
            companionship and owned data remain available.
          </Text>
        </View>
      )}
    </View>
  );
}

function LimitInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.limit}>
      <Text style={styles.limitLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType="number-pad"
        value={String(value)}
        onChangeText={onChange}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 10,
  },
  modeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mode: {
    color: colors.amber,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  card: {
    gap: 9,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  caption: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  input: {
    minHeight: 42,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    backgroundColor: colors.panelRaised,
  },
  storage: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 15,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  statusLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  statusValue: {
    color: colors.green,
    fontSize: 10,
    fontWeight: "900",
  },
  statusPending: {
    color: colors.amber,
  },
  limitGrid: {
    gap: 8,
  },
  limit: {
    gap: 4,
  },
  limitLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  status: {
    color: colors.green,
    fontSize: 10,
    lineHeight: 15,
  },
  error: {
    color: colors.amber,
  },
});
