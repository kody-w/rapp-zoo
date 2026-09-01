import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { formatBtc, formatSats } from "@/capsules/credit";
import { useLifecycle } from "@/capsules/lifecycle-context";
import { useHoloStore } from "@/state/holo-store";
import { HOLO_ZOO_RELEASE_POLICY } from "@/release-policy";
import { colors } from "@/theme/colors";
import { Button, MetadataRow, SectionTitle } from "./ui";

export function LifecyclePanel() {
  const store = useHoloStore();
  const lifecycle = useLifecycle();
  const [askSats, setAskSats] = useState("42000");
  if (!HOLO_ZOO_RELEASE_POLICY.realCommerceEnabled) return null;
  const snapshot = lifecycle.snapshot;
  const credit = store.selectedCapsule?.credit;
  if (!snapshot || !credit) return null;
  const ask = Number.parseInt(askSats, 10);
  return (
    <View style={styles.section}>
      <SectionTitle>Return & resale</SectionTitle>
      <Text style={styles.state}>{lifecycle.label}</Text>
      {lifecycle.preview ? (
        <Text style={styles.preview}>PREVIEW LIFECYCLE · NO REAL REFUND</Text>
      ) : null}
      <MetadataRow
        label="30-day window ends"
        value={snapshot.returnWindowEndsUtc ?? "not applicable"}
      />
      <MetadataRow
        label="Local capsule"
        value={
          snapshot.localCopyStatus === "official-owner-copy"
            ? "immutable owner copy"
            : "immutable unowned preview"
        }
      />
      <Text style={styles.valueLabel}>OFFICIAL RAPTERBOX BIRTH VALUE</Text>
      <MetadataRow
        label="Immutable birth"
        value={`${formatSats(credit.valuation.priceSats)} · ${formatBtc(
          credit.valuation.priceSats,
        )}`}
      />
      <Text style={styles.marketLabel}>CURRENT MARKET FACTS</Text>
      <MetadataRow
        label="Seller ask"
        value={
          snapshot.currentSellerAskSats === null
            ? "not listed"
            : formatSats(snapshot.currentSellerAskSats)
        }
      />
      <MetadataRow
        label="Last verified sale"
        value={
          snapshot.lastVerifiedSaleSats === null
            ? "none"
            : formatSats(snapshot.lastVerifiedSaleSats)
        }
      />
      <Text style={styles.copy}>
        Birth value never changes. Ask and sale prices are separate signed
        market facts—not an appraisal, return promise, or liquidity guarantee.
      </Text>
      <View style={styles.actions}>
        <Button disabled={lifecycle.busy} onPress={() => void lifecycle.refresh()}>
          Refresh Official Lifecycle
        </Button>
        <Button
          tone="accent"
          disabled={lifecycle.busy || snapshot.state !== "return-eligible"}
          onPress={() => void lifecycle.requestReturn()}
        >
          Request 30-Day Return
        </Button>
      </View>
      {snapshot.state === "owned" ? (
        <>
          <TextInput
            accessibilityLabel="Seller ask in satoshis"
            keyboardType="number-pad"
            value={askSats}
            onChangeText={setAskSats}
            placeholder="Seller ask sats"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Button
            disabled={
              lifecycle.busy ||
              !Number.isSafeInteger(ask) ||
              ask < 1
            }
            onPress={() => void lifecycle.listForSale(ask)}
          >
            List Through Signed Registry
          </Button>
        </>
      ) : null}
      {snapshot.state === "listed" ? (
        <View style={styles.actions}>
          <Button
            disabled={lifecycle.busy}
            onPress={() => void lifecycle.cancelSaleListing()}
          >
            Cancel Signed Listing
          </Button>
          <Button
            tone="accent"
            disabled={lifecycle.busy}
            onPress={() => void lifecycle.manageSaleTransfer()}
          >
            Verify Sale & Transfer
          </Button>
        </View>
      ) : null}
      <Text style={styles.copy}>
        Store purchases follow Apple or Google refund policy and APIs. BTC
        returns require backend-verified settlement. Listing, cancellation,
        sale, and transfer become official only through verified signed
        registry events. Files are never silently deleted.
      </Text>
      {lifecycle.message ? (
        <Text style={styles.message}>{lifecycle.message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  state: {
    color: colors.green,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  preview: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  valueLabel: {
    color: colors.green,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  marketLabel: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  copy: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
  message: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
  },
});
