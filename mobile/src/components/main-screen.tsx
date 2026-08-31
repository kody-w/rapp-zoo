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
import { useHoloStore } from "@/state/holo-store";
import { colors } from "@/theme/colors";
import { FieldPanel } from "./field-panel";
import { InspectorPanel } from "./inspector-panel";
import { Onboarding, ONBOARDING_KEY } from "./onboarding";
import { Sidebar } from "./sidebar";
import { StagePanel } from "./stage-panel";

type PhonePane = "field" | "library" | "stage" | "inspect";
type WideMode = "field" | "companion" | "habitat";

export function MainScreen() {
  const store = useHoloStore();
  const { width } = useWindowDimensions();
  const wide = width >= 1180;
  const [phonePane, setPhonePane] = useState<PhonePane>("field");
  const [wideMode, setWideMode] = useState<WideMode>("field");
  const [stageCommerce, setStageCommerce] = useState(false);
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
  const selectWideMode = (mode: WideMode) => {
    setWideMode(mode);
    setStageCommerce(mode === "habitat");
  };
  const selectPhonePane = (pane: PhonePane) => {
    if (pane === "field") setStageCommerce(false);
    if (pane === "library") setStageCommerce(true);
    if (pane === "stage" && phonePane === "field") {
      setStageCommerce(false);
    }
    setPhonePane(pane);
  };
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
      {wide ? (
        <View style={styles.wideModes}>
          {(["field", "companion", "habitat"] as const).map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="tab"
              accessibilityState={{ selected: wideMode === mode }}
              onPress={() => selectWideMode(mode)}
              style={[
                styles.wideMode,
                wideMode === mode && styles.wideModeActive,
              ]}
            >
              <Text style={styles.tabText}>
                {mode === "field"
                  ? "HOLO FIELD"
                  : mode === "companion"
                    ? "COMPANION STAGE"
                    : "HABITAT"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!wide ? (
        <View style={styles.tabs}>
          {(["field", "library", "stage", "inspect"] as const).map((pane) => (
            <Pressable
              key={pane}
              accessibilityRole="tab"
              accessibilityState={{ selected: phonePane === pane }}
              onPress={() => selectPhonePane(pane)}
              style={[styles.tab, phonePane === pane && styles.activeTab]}
            >
              <Text style={styles.tabText}>{pane.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.workspace}>
        {wide ? (
          wideMode === "field" ? (
            <View style={styles.fullPane}>
              <FieldPanel
                onOpenStage={() => {
                  setStageCommerce(false);
                  selectWideMode("companion");
                }}
              />
            </View>
          ) : wideMode === "companion" ? (
            <View style={styles.fullPane}>
              <StagePanel commerce="hidden" reducedMotion={reducedMotion} />
            </View>
          ) : (
            <>
              <View style={styles.sidebarWide}>
                <Sidebar
                  onSelected={() => {
                    setStageCommerce(true);
                    selectWideMode("habitat");
                  }}
                  onShowOnboarding={() => setShowOnboarding(true)}
                />
              </View>
              <View style={styles.stageWide}>
                <StagePanel commerce="allowed" reducedMotion={reducedMotion} />
              </View>
              <View style={styles.inspectorWide}>
                <InspectorPanel />
              </View>
            </>
          )
        ) : (
          <>
            {phonePane === "field" ? (
              <View style={styles.fullPane}>
                <FieldPanel
                  onOpenStage={() => {
                    setStageCommerce(false);
                    selectPhonePane("stage");
                  }}
                />
              </View>
            ) : null}
            {phonePane === "library" ? (
              <View style={styles.fullPane}>
                <Sidebar
                  onSelected={() => {
                    setStageCommerce(true);
                    selectPhonePane("stage");
                  }}
                  onShowOnboarding={() => setShowOnboarding(true)}
                />
              </View>
            ) : null}
            {phonePane === "stage" ? (
              <View style={styles.fullPane}>
                <StagePanel
                  commerce={stageCommerce ? "allowed" : "hidden"}
                  reducedMotion={reducedMotion}
                />
              </View>
            ) : null}
            {phonePane === "inspect" ? (
              <View style={styles.fullPane}>
                <InspectorPanel />
              </View>
            ) : null}
          </>
        )}
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
  wideModes: {
    flexDirection: "row",
    gap: 6,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.panel,
  },
  wideMode: {
    minWidth: 150,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  wideModeActive: {
    backgroundColor: colors.panelRaised,
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
