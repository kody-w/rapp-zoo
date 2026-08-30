import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useBilling } from "@/billing/billing-context";
import {
  directPlan,
  rapterCreditsForProduct,
} from "@/billing/catalog";
import type { BillingOffering } from "@/billing/types";
import { Button, SectionTitle } from "@/components/ui";
import { brand } from "@/config/brand";
import { colors } from "@/theme/colors";

const directFeatures = [
  "One active local Rapter",
  "Your OpenAI-compatible endpoint, model, and API key",
  "Local playback, history, import, validation, and export",
  "No repeating fee and no gate on owned local data",
];

export default function UpgradeScreen() {
  const billing = useBilling();
  const purchaseReady =
    billing.billingEnvironment === "preview" ||
    billing.ledger.status === "live";
  const rapterOfferings = billing.offerings.filter(
    (offering) => offering.kind === "rapter_credit",
  );
  const computeOfferings = billing.offerings.filter(
    (offering) => offering.kind === "compute_credit",
  );
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View
        style={[
          styles.modeBanner,
          billing.billingEnvironment === "preview" && styles.previewBanner,
          (billing.billingEnvironment === "misconfigured" ||
            billing.ledger.status === "unavailable") &&
            styles.errorBanner,
        ]}
      >
        <Text style={styles.modeTitle}>
          {billing.billingEnvironment === "live"
            ? "LIVE ONE-TIME PURCHASES"
            : billing.billingEnvironment === "preview"
              ? "PREVIEW PURCHASES — NO REAL CHARGE"
              : "REVENUECAT CONFIGURATION REQUIRED"}
        </Text>
        <Text style={styles.modeCopy}>
          {billing.billingEnvironment === "preview"
            ? "Expo Go and web simulate consumable receipts and an in-memory ledger. Use an EAS development/store build for real purchases."
            : billing.error ??
              billing.ledger.error ??
              "RevenueCat and the backend-owned Wild ledger are connected."}
        </Text>
      </View>

      <View style={styles.hero}>
        <Text style={styles.eyebrow}>CURRENT ACCESS</Text>
        <Text style={styles.title}>
          {billing.features.accessMode === "wild"
            ? `Wild · ${billing.ledger.activeWildRapters} active Rapter${
                billing.ledger.activeWildRapters === 1 ? "" : "s"
              }`
            : directPlan.title}
        </Text>
        <Text style={styles.subtitle}>
          {billing.features.accessMode === "wild"
            ? "Owned Wild activations use the managed Brainstem. Compute packs cover ongoing managed Azure/model work."
            : directPlan.summary}
        </Text>
      </View>

      <View style={styles.ledger}>
        <SectionTitle>Wild ledger</SectionTitle>
        <LedgerRow
          label="Available Rapter credits"
          value={billing.ledger.availableRapterCredits}
        />
        <LedgerRow
          label="Active managed Rapter sessions"
          value={billing.ledger.activeWildRapters}
        />
        <LedgerRow
          label="Small compute packs"
          value={billing.ledger.smallComputePacks}
        />
        <LedgerRow
          label="Large compute packs"
          value={billing.ledger.largeComputePacks}
        />
        <Text style={styles.instructions}>
          Choose an organism in the gallery to redeem one Rapter credit for its
          signed capsule. The capsule service consumes the credit and records
          the ownership grant; the client never grants itself ownership.
        </Text>
      </View>

      <View style={[styles.plan, styles.currentPlan]}>
        <View style={styles.planHeading}>
          <Text style={styles.planTitle}>{directPlan.title}</Text>
          <Text style={styles.currentBadge}>ALWAYS INCLUDED</Text>
        </View>
        <Text style={styles.planSummary}>{directPlan.summary}</Text>
        {directFeatures.map((feature) => (
          <Text key={feature} style={styles.feature}>
            ✓ {feature}
          </Text>
        ))}
      </View>

      <SectionTitle>Hatch Wild Rapters</SectionTitle>
      <Text style={styles.sectionCopy}>
        Each Rapter is a living digital organism represented by its signed
        local capsule. One-time consumable credits let you choose one; flock
        packs grant 3 or 10 credits and may be discounted in the
        RevenueCat/store offering. Prices below are localized by the store. The
        backend chooses and signs the selected organism&apos;s tier, set, fixed
        sats, and conception quote; the client never supplies valuation fields
        or trusts purchase-success state.
      </Text>
      <Text style={styles.sectionCopy}>
        This is one-time local ownership, not a subscription. The signed
        Rolling Core Capsule remains usable offline and exportable. The
        original owner may request a return during the inclusive 30-day window,
        subject to server eligibility and a confirmed refund on the original
        payment rail. Returned files remain locally as clearly labeled unowned
        previews; Holo Zoo never silently deletes immutable bytes.
      </Text>
      {rapterOfferings.map((offering) => (
        <OfferingCard
          key={offering.packageId}
          offering={offering}
          detail={`${rapterCreditsForProduct(
            offering.productIdentifier,
          )} one-time Rapter credit${
            rapterCreditsForProduct(offering.productIdentifier) === 1
              ? ""
              : "s"
          }`}
          disabled={!purchaseReady || billing.busy}
          preview={billing.billingEnvironment === "preview"}
          onPurchase={() => void billing.purchase(offering)}
        />
      ))}

      <SectionTitle>Managed compute & Growl</SectionTitle>
      <Text style={styles.sectionCopy}>
        Optional consumable packs fund ongoing hosted Azure/model routing and
        managed Growl completion. The backend defines and meters the exact
        compute grant for each product.
      </Text>
      {computeOfferings.map((offering) => (
        <OfferingCard
          key={offering.packageId}
          offering={offering}
          detail="One-time managed-compute credit pack"
          disabled={!purchaseReady || billing.busy}
          preview={billing.billingEnvironment === "preview"}
          onPurchase={() => void billing.purchase(offering)}
        />
      ))}

      {billing.busy ? <ActivityIndicator color={colors.accent} /> : null}
      {billing.error && billing.billingEnvironment !== "preview" ? (
        <Text style={styles.error}>{billing.error}</Text>
      ) : null}
      {billing.ledger.error && billing.ledger.status === "unavailable" ? (
        <Text style={styles.error}>{billing.ledger.error}</Text>
      ) : null}

      <View style={styles.actions}>
        <SectionTitle>Purchase history</SectionTitle>
        <Button
          disabled={
            billing.busy || billing.billingEnvironment === "misconfigured"
          }
          onPress={() => void billing.syncPurchaseHistory()}
        >
          Sync Purchase History
        </Button>
        <Text style={styles.instructions}>
          RevenueCat supplies one-time transaction history. Every
          transaction is sent to the backend ledger with its store transaction
          ID as the idempotency key. Replaying a receipt cannot double-grant
          credits.
        </Text>
      </View>

      <View style={styles.privacy}>
        <SectionTitle>Privacy and ownership</SectionTitle>
        <Text style={styles.instructions}>
          RevenueCat and the platform store process one-time purchase receipts.
          Holo Zoo does not store payment credentials. Purchases never
          disable RAPP/1 validation, local playback, or access/export for data
          the user already owns.
        </Text>
        <View style={styles.linkRow}>
          <Button onPress={() => void Linking.openURL(brand.privacyUrl)}>
            Privacy
          </Button>
          <Button onPress={() => void Linking.openURL(brand.supportUrl)}>
            Support
          </Button>
          <Button onPress={() => void Linking.openURL(brand.marketingUrl)}>
            Holo Zoo
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

function OfferingCard({
  offering,
  detail,
  disabled,
  preview,
  onPurchase,
}: {
  offering: BillingOffering;
  detail: string;
  disabled: boolean;
  preview: boolean;
  onPurchase: () => void;
}) {
  return (
    <View style={styles.plan}>
      <Text style={styles.planTitle}>{offering.title}</Text>
      <Text style={styles.planSummary}>{offering.description}</Text>
      <Text style={styles.feature}>✓ {detail}</Text>
      <Text style={styles.productId}>{offering.productIdentifier}</Text>
      <Button
        tone="accent"
        disabled={disabled}
        onPress={onPurchase}
        accessibilityLabel={`Buy ${offering.title}, ${offering.price}`}
      >
        {preview ? "Preview" : "Buy once"} · {offering.price}
      </Button>
    </View>
  );
}

function LedgerRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.ledgerRow}>
      <Text style={styles.ledgerLabel}>{label}</Text>
      <Text style={styles.ledgerValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: 20,
    gap: 14,
  },
  modeBanner: {
    gap: 5,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: "#123426",
  },
  previewBanner: {
    borderColor: colors.amber,
    backgroundColor: "#443116",
  },
  errorBanner: {
    borderColor: colors.red,
    backgroundColor: "#512127",
  },
  modeTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  modeCopy: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  hero: {
    gap: 5,
    paddingVertical: 8,
  },
  eyebrow: {
    color: colors.accent,
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1.6,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
  },
  subtitle: {
    color: colors.muted,
    lineHeight: 20,
  },
  ledger: {
    gap: 9,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.violet,
    backgroundColor: "#211a3c",
  },
  ledgerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  ledgerLabel: {
    color: colors.muted,
  },
  ledgerValue: {
    color: colors.text,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  plan: {
    gap: 10,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  currentPlan: {
    borderColor: colors.accent,
  },
  planHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  planTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  currentBadge: {
    color: colors.green,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  planSummary: {
    color: colors.muted,
    lineHeight: 19,
  },
  feature: {
    color: colors.text,
    fontSize: 13,
  },
  productId: {
    color: colors.muted,
    fontFamily: "monospace",
    fontSize: 10,
  },
  sectionCopy: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: colors.red,
    textAlign: "center",
  },
  actions: {
    gap: 10,
    padding: 18,
    borderRadius: 18,
    backgroundColor: colors.panel,
  },
  privacy: {
    gap: 10,
    padding: 18,
    borderRadius: 18,
    borderColor: colors.border,
    borderWidth: 1,
  },
  instructions: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  linkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
