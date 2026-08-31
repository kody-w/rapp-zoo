import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import type { FieldEncounter } from "@/field/field";
import { colors } from "@/theme/colors";

export function FieldRadar({
  encounters,
  selectedId,
  onSelect,
}: {
  encounters: FieldEncounter[];
  selectedId: string | null;
  onSelect: (encounter: FieldEncounter) => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View
      accessibilityLabel="Offline Holo Field radar"
      onLayout={onLayout}
      style={styles.radar}
    >
      <View style={[styles.ring, styles.ringOuter]} />
      <View style={[styles.ring, styles.ringMiddle]} />
      <View style={[styles.ring, styles.ringInner]} />
      <View style={styles.horizontalPath} />
      <View style={styles.verticalPath} />
      <View style={styles.origin}>
        <View style={styles.originCore} />
      </View>
      {encounters.map((encounter) => {
        const left = Math.max(
          4,
          (encounter.xPercent / 100) * size.width - 26,
        );
        const top = Math.max(
          4,
          (encounter.yPercent / 100) * size.height - 26,
        );
        const selected = encounter.id === selectedId;
        return (
          <Pressable
            key={encounter.id}
            accessibilityRole="button"
            accessibilityLabel={`${encounter.organism.displayName}, ${encounter.signal} percent signal, ${encounter.habitat}`}
            onPress={() => onSelect(encounter)}
            style={[
              styles.marker,
              { left, top },
              selected && styles.markerSelected,
            ]}
          >
            <Text style={styles.markerGlyph}>
              {encounter.organism.displayName.slice(0, 1)}
            </Text>
            <Text numberOfLines={1} style={styles.markerLabel}>
              {encounter.organism.displayName}
            </Text>
          </Pressable>
        );
      })}
      <View pointerEvents="none" style={styles.privacyBadge}>
        <Text style={styles.privacyText}>LOCAL RADAR · NO LOCATION</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  radar: {
    height: 320,
    overflow: "hidden",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  ring: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    left: "50%",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    transform: [{ translateX: "-50%" }, { translateY: "-50%" }],
  },
  ringOuter: {
    width: 286,
    height: 286,
  },
  ringMiddle: {
    width: 196,
    height: 196,
  },
  ringInner: {
    width: 104,
    height: 104,
  },
  horizontalPath: {
    position: "absolute",
    top: "49.5%",
    left: 22,
    right: 22,
    height: 3,
    borderRadius: 3,
    backgroundColor: colors.border,
    transform: [{ rotate: "-12deg" }],
  },
  verticalPath: {
    position: "absolute",
    top: 24,
    bottom: 24,
    left: "49.5%",
    width: 3,
    borderRadius: 3,
    backgroundColor: colors.border,
    transform: [{ rotate: "18deg" }],
  },
  origin: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.background,
    transform: [{ translateX: -19 }, { translateY: -19 }],
  },
  originCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  marker: {
    position: "absolute",
    width: 92,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  markerSelected: {
    borderColor: colors.green,
    borderWidth: 2,
  },
  markerGlyph: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: "900",
  },
  markerLabel: {
    width: "100%",
    color: colors.text,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
  },
  privacyBadge: {
    position: "absolute",
    left: 12,
    bottom: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  privacyText: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
});
