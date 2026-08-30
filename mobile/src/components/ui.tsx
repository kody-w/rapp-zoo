import type { PropsWithChildren, ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { colors } from "@/theme/colors";

export function Button({
  children,
  onPress,
  disabled = false,
  tone = "default",
  accessibilityLabel,
  style,
}: PropsWithChildren<{
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "accent" | "danger";
  accessibilityLabel?: string;
  style?: ViewStyle;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "accent" && styles.buttonAccent,
        tone === "danger" && styles.buttonDanger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <Text style={styles.buttonText}>{children}</Text>
    </Pressable>
  );
}

export function SectionTitle({
  children,
  trailing,
}: PropsWithChildren<{ trailing?: ReactNode }>) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {trailing}
    </View>
  );
}

export function MetadataRow({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string | null | undefined;
  valueStyle?: TextStyle;
}) {
  return (
    <View style={styles.metadataRow} accessibilityLabel={`${label}: ${value ?? "none"}`}>
      <Text style={styles.metadataLabel}>{label}</Text>
      <Text selectable style={[styles.metadataValue, valueStyle]}>
        {value ?? "none"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 42,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  buttonAccent: {
    borderColor: colors.accent,
    backgroundColor: "#123c55",
  },
  buttonDanger: {
    borderColor: colors.red,
  },
  buttonText: {
    color: colors.text,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.72,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  metadataRow: {
    gap: 6,
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metadataLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  metadataValue: {
    color: colors.text,
    fontSize: 13,
    fontFamily: "monospace",
  },
});
