import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { brand } from "@/config/brand";
import { colors } from "@/theme/colors";
import { Button } from "./ui";

export const ONBOARDING_KEY = "@holo-zoo/onboarding-v1";

export function Onboarding({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const finish = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "complete");
    onDismiss();
  };
  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={() => void finish()}
    >
      <View style={styles.backdrop}>
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.content}
          accessibilityViewIsModal
        >
          <Text style={styles.consumer}>{brand.product.toUpperCase()}</Text>
          <Text style={styles.title}>{brand.displayName}</Text>
          <Text style={styles.tagline}>{brand.tagline}</Text>
          <Text style={styles.from}>
            {brand.poweredBy} {brand.from}
          </Text>

          <VocabularyCard
            term="Rapter"
            definition="One organism with its own identity, stream, and Rolling Core."
          />
          <VocabularyCard
            term="Rappter"
            definition="A flock of Rapters. Rappter is never the singular noun."
          />
          <VocabularyCard
            term="RAPP/1"
            definition="The protocol that binds immutable frames, source evidence, and histories."
          />
          <VocabularyCard
            term="Rapterbox"
            definition="The storefront and company behind Holo Zoo and Rolling Cores."
          />
          <VocabularyCard
            term="Holo Zoo"
            definition="The consumer app: a habitat, player, and library for Rolling Cores."
          />
          <VocabularyCard
            term="Rolling Cores"
            definition="The underlying organism product system and whole-business thesis."
          />
          <VocabularyCard
            term="Living digital organism"
            definition={`${brand.rapterPositioning} Verified source plus Rolling Core successor mutations are ticks of existence. The host reports Awake, Sleeping, Quarantined, or Unborn. Holo Zoo uses Waking only while checking for the next verified successor.`}
          />
          <VocabularyCard
            term="Operational consciousness"
            definition="Continuous inspectable experience-state across verified ticks. This is a product definition, not biological or scientific proof."
          />
          <VocabularyCard
            term="Breath key"
            definition="A securely stored, successfully tested Direct provider key. It permits an explicitly started, bounded foreground breathing loop; it never starts spending by itself."
          />
          <VocabularyCard
            term="The ownership loop"
            definition="Discover a Rapter, preview and value it, redeem a one-time credit, receive its signed capsule, own it offline, import/export it, then interact and grow its immutable history frame by frame."
          />

          <Text style={styles.note}>
            Start in free Direct mode with one local Rapter and your own
            OpenAI-compatible provider. Wild mode adds the managed Brainstem
            and remote Rapters; 3- and 10-slot plans support a Rappter flock.
            iOS suspends local Direct breathing away from the app; continuous
            breathing requires optional bounded Wild cloud compute.
          </Text>
          <Button tone="accent" onPress={() => void finish()}>
            Enter Holo Zoo
          </Button>
        </ScrollView>
      </View>
    </Modal>
  );
}

function VocabularyCard({
  term,
  definition,
}: {
  term: string;
  definition: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.term}>{term}</Text>
      <Text style={styles.definition}>{definition}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "rgba(1, 5, 10, 0.88)",
  },
  sheet: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "92%",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.background,
  },
  content: {
    gap: 12,
    padding: 22,
  },
  consumer: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
  },
  tagline: {
    color: colors.muted,
    fontSize: 16,
    marginBottom: 4,
  },
  from: {
    color: colors.violet,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
  },
  card: {
    gap: 4,
    padding: 13,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  term: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  definition: {
    color: colors.muted,
    lineHeight: 19,
  },
  note: {
    color: colors.text,
    lineHeight: 20,
    paddingVertical: 4,
  },
});
