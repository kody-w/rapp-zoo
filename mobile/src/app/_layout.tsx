import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BillingProvider } from "@/billing/billing-context";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { assertGameplayConstitution } from "@/constitution/gameplay";
import { DirectBreathingProvider } from "@/providers/breathing-context";
import { assertReleasePolicy } from "@/release-policy";
import { HoloStoreProvider } from "@/state/holo-store";
import { colors } from "@/theme/colors";

assertGameplayConstitution();
assertReleasePolicy();

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <BillingProvider>
          <HoloStoreProvider>
            <DirectBreathingProvider>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: colors.panel },
                  headerTintColor: colors.text,
                  contentStyle: { backgroundColor: colors.background },
                }}
              >
                <Stack.Screen
                  name="index"
                  options={{ headerShown: false, title: "Holo Zoo" }}
                />
                <Stack.Screen
                  name="fantasy"
                  options={{ title: "Fantasy Draft", presentation: "modal" }}
                />
                <Stack.Screen
                  name="upgrade"
                  options={{
                    title: "Holo Zoo Release Boundary",
                    presentation: "modal",
                  }}
                />
              </Stack>
            </DirectBreathingProvider>
          </HoloStoreProvider>
        </BillingProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
