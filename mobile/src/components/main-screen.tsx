import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useBilling } from "@/billing/billing-context";
import { directPlan } from "@/billing/catalog";
import { useHoloStore } from "@/state/holo-store";
import { colors } from "@/theme/colors";
import { InspectorPanel } from "./inspector-panel";
import { Onboarding, ONBOARDING_KEY } from "./onboarding";
import { Sidebar } from "./sidebar";
import { StagePanel } from "./stage-panel";

type PhonePane = "library" | "stage" | "inspect";

export function MainScreen() {
  const store = useHoloStore();
  const billing = useBilling();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 1080;
  const [phonePane, setPhonePane] = useState<PhonePane>("library");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const motionListener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => motionListener.remove();
  }, []);
  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDING_KEY).then((value) => {
      if (value !== "complete") setShowOnboarding(true);
    });
  }, []);
  if (!store.ready) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadingText}>Opening the Holo Zoo library…</Text>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safe}>
      {store.error ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss error: ${store.error}`}
          onPress={store.clearError}
          style={styles.errorBanner}
        >
          <Text style={styles.bannerText}>{store.error}</Text>
          <Text style={styles.dismiss}>Dismiss</Text>
        </Pressable>
      ) : null}
      {store.info ? (
        <Pressable onPress={() => store.setInfo(null)} style={styles.infoBanner}>
          <Text style={styles.bannerText}>{store.info}</Text>
        </Pressable>
      ) : null}
      {billing.billingEnvironment !== "live" ? (
        <Pressable
          onPress={() => router.push("/upgrade")}
          style={[
            styles.billingBanner,
            billing.billingEnvironment === "misconfigured" &&
              styles.billingError,
          ]}
          accessibilityRole="link"
        >
          <Text style={styles.billingText}>
            {billing.billingEnvironment === "preview"
              ? `${
                  billing.ledger.activeWildRapters > 0
                    ? `Wild · ${billing.ledger.activeWildRapters} active Rapters`
                    : directPlan.title
                } · PREVIEW BILLING — mock offerings only; no store transaction`
              : "REVENUECAT KEY MISSING — purchases disabled in this EAS build"}
          </Text>
          <Text style={styles.billingLink}>Credits →</Text>
        </Pressable>
      ) : null}
      {!wide ? (
        <View style={styles.tabs}>
          {(["library", "stage", "inspect"] as const).map((pane) => (
            <Pressable
              key={pane}
              accessibilityRole="tab"
              accessibilityState={{ selected: phonePane === pane }}
              onPress={() => setPhonePane(pane)}
              style={[styles.tab, phonePane === pane && styles.activeTab]}
            >
              <Text style={styles.tabText}>{pane.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.workspace}>
        {wide || phonePane === "library" ? (
          <View style={wide ? styles.sidebarWide : styles.fullPane}>
            <Sidebar
              onSelected={() => setPhonePane("stage")}
              onShowOnboarding={() => setShowOnboarding(true)}
            />
          </View>
        ) : null}
        {wide || phonePane === "stage" ? (
          <View style={wide ? styles.stageWide : styles.fullPane}>
            <StagePanel reducedMotion={reducedMotion} />
          </View>
        ) : null}
        {wide || phonePane === "inspect" ? (
          <View style={wide ? styles.inspectorWide : styles.fullPane}>
            <InspectorPanel />
          </View>
        ) : null}
      </View>
      <Onboarding
        visible={showOnboarding}
        onDismiss={() => setShowOnboarding(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.background,
  },
  loadingText: {
    color: colors.muted,
  },
  workspace: {
    flex: 1,
    flexDirection: "row",
  },
  sidebarWide: {
    width: 310,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  stageWide: {
    flex: 1,
    minWidth: 420,
  },
  inspectorWide: {
    width: 370,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  fullPane: {
    flex: 1,
  },
  tabs: {
    flexDirection: "row",
    padding: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.panel,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
  },
  activeTab: {
    backgroundColor: colors.panelRaised,
  },
  tabText: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.6,
  },
  errorBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    backgroundColor: "#512127",
  },
  infoBanner: {
    padding: 10,
    backgroundColor: "#123c55",
  },
  billingBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#443116",
    borderBottomColor: colors.amber,
    borderBottomWidth: 1,
  },
  billingError: {
    backgroundColor: "#512127",
    borderBottomColor: colors.red,
  },
  billingText: {
    flex: 1,
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
  },
  billingLink: {
    color: colors.text,
    fontWeight: "900",
  },
  bannerText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
  },
  dismiss: {
    color: colors.text,
    fontWeight: "800",
  },
});
