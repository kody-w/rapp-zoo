import {
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { FieldEncounter } from "@/field/field";
import { colors } from "@/theme/colors";
import { Button, SectionTitle } from "./ui";

export function CompanionField({
  encounter,
  onMeet,
}: {
  encounter: FieldEncounter | null;
  onMeet: (encounter: FieldEncounter) => void;
}) {
  if (!encounter) {
    return (
      <View style={styles.card}>
        <SectionTitle>Companion mode</SectionTitle>
        <Text style={styles.copy}>No local Rapter signals are available.</Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>COMPANION MODE · NO COMMERCE</Text>
      <SectionTitle>{encounter.organism.displayName}</SectionTitle>
      <Text style={styles.identity}>
        {encounter.habitat} · {encounter.signal}% signal · {encounter.band}
      </Text>
      <Text style={styles.copy}>{encounter.organism.description}</Text>
      <Text style={styles.value}>{encounter.organism.valueSummary}</Text>
      <Button tone="accent" onPress={() => onMeet(encounter)}>
        Meet on Holo Stage
      </Button>
      <Text style={styles.constitution}>
        Meeting, memory, affection, playback, and local companionship are
        unconditional and remain complete in every House.
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
    color: colors.green,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  identity: {
    color: colors.accent,
    fontWeight: "800",
  },
  copy: {
    color: colors.text,
    lineHeight: 20,
  },
  value: {
    color: colors.muted,
    lineHeight: 18,
  },
  constitution: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
});
