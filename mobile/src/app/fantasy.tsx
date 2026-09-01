import { useEffect } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, SectionTitle } from "@/components/ui";
import { useHoloStore } from "@/state/holo-store";
import { colors } from "@/theme/colors";

export default function FantasyDraftScreen() {
  const store = useHoloStore();
  useEffect(() => {
    const timer = setTimeout(() => void store.loadFantasyDraft(), 0);
    return () => clearTimeout(timer);
    // The route performs one load on mount; Retry handles later attempts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {store.fantasyDraft ? (
        <>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>
              /api/holo/examples/fantasy-draft
            </Text>
            <Text style={styles.title}>{store.fantasyDraft.title}</Text>
            <Text style={styles.status}>
              {store.fantasyDraft.status.toUpperCase()}
            </Text>
          </View>
          <SectionTitle>Participants</SectionTitle>
          {store.fantasyDraft.participants.map((participant) => (
            <View
              key={participant.id}
              style={styles.participant}
              accessibilityLabel={`${participant.displayName}, ${participant.kind}, seat ${participant.seat}`}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {participant.kind === "rappter" ? "R" : "AI"}
                </Text>
              </View>
              <View style={styles.participantCopy}>
                <Text style={styles.name}>{participant.displayName}</Text>
                <Text style={styles.kind}>{participant.kind.toUpperCase()}</Text>
              </View>
              <Text style={styles.seat}>Seat {participant.seat}</Text>
            </View>
          ))}
        </>
      ) : store.fantasyError ? (
        <View style={styles.empty}>
          <Text style={styles.title}>Draft unavailable</Text>
          <Text style={styles.error}>{store.fantasyError}</Text>
          <Button tone="accent" onPress={() => void store.loadFantasyDraft()}>
            Retry
          </Button>
          <Text style={styles.kind}>
            This sample uses the tester-configured RAPP Zoo and has no paid
            unlock.
          </Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.kind}>Loading fantasy draft…</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
    padding: 20,
    gap: 14,
  },
  hero: {
    gap: 6,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.violet,
    backgroundColor: "#211a3c",
  },
  eyebrow: {
    color: colors.violet,
    fontFamily: "monospace",
    fontSize: 11,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "900",
  },
  status: {
    color: colors.green,
    fontWeight: "900",
    letterSpacing: 1,
  },
  participant: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.panelRaised,
  },
  avatarText: {
    color: colors.accent,
    fontWeight: "900",
  },
  participantCopy: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  kind: {
    color: colors.muted,
    fontSize: 12,
  },
  seat: {
    color: colors.amber,
    fontWeight: "800",
  },
  empty: {
    minHeight: 300,
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
  },
  error: {
    color: colors.red,
    textAlign: "center",
  },
});
