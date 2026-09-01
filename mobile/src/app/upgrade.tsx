import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SectionTitle } from "@/components/ui";
import { HOLO_ZOO_RELEASE_POLICY } from "@/release-policy";
import { colors } from "@/theme/colors";

export default function UpgradeScreen() {
  if (HOLO_ZOO_RELEASE_POLICY.realCommerceEnabled) {
    throw new Error("This internal release has no enabled commerce screen.");
  }
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>INTERNAL TESTFLIGHT</Text>
      <Text style={styles.title}>Commerce is disabled.</Text>
      <Text style={styles.subtitle}>
        This build exercises Holo Field, local companionship, Stage playback,
        history, import/export, Houses, and the local Work walkthrough without
        real charges or production service claims.
      </Text>
      <View style={styles.card}>
        <SectionTitle>Available now</SectionTitle>
        <Text style={styles.instructions}>
          Offline Field discovery, local Companion mode, signed capsule
          inspection, local playback, history, import/export, optional
          foreground Direct updates, and a visibly non-executing Work
          walkthrough.
        </Text>
      </View>
      <View style={styles.card}>
        <SectionTitle>Constitutional boundary</SectionTitle>
        <Text style={styles.instructions}>
          Purchases, tips, sponsorships, rentals, resale, managed compute,
          production RapterWorks, Coin economics, public sharing, and
          irreversible protocol writes remain unavailable until their
          independent authority, recovery, privacy, and release gates are
          proven.
        </Text>
      </View>
      <Text style={styles.policy}>
        Release channel: {HOLO_ZOO_RELEASE_POLICY.channel} · audience:{" "}
        {HOLO_ZOO_RELEASE_POLICY.audience}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 48,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 38,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  instructions: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
  },
  policy: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
  },
});
