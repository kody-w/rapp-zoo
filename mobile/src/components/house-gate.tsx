import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  STARTING_HOUSES,
  type HouseCode,
} from "@/field/houses";
import { colors } from "@/theme/colors";
import { SectionTitle } from "./ui";

export function HouseGate({
  selected,
  onSelect,
}: {
  selected: HouseCode | null;
  onSelect: (code: HouseCode) => void;
}) {
  return (
    <View style={styles.section}>
      <SectionTitle>Choose one starting House</SectionTitle>
      <Text style={styles.copy}>
        House is your complete player profile: one local code, no account or
        PII. Houses change community and perspective—not power, encounters,
        companion capability, prices, or progress.
      </Text>
      <View style={styles.grid}>
        {STARTING_HOUSES.map((house) => {
          const active = selected === house.code;
          return (
            <Pressable
              key={house.code}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(house.code)}
              style={[styles.card, active && styles.cardActive]}
            >
              <Text style={styles.name}>{house.name}</Text>
              <Text style={styles.founder}>
                Founder profile · {house.founderProfile}
              </Text>
              <Text style={styles.purpose}>{house.purpose}</Text>
              <Text style={styles.action}>
                {active ? "YOUR HOUSE" : `JOIN ${house.name.toUpperCase()}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  copy: {
    color: colors.muted,
    lineHeight: 20,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  card: {
    minWidth: 220,
    flexBasis: 220,
    flexGrow: 1,
    gap: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  cardActive: {
    borderColor: colors.green,
    backgroundColor: colors.panelRaised,
  },
  name: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  founder: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
  },
  purpose: {
    color: colors.muted,
    lineHeight: 18,
  },
  action: {
    marginTop: 6,
    color: colors.green,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
});
