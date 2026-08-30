import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BillingProvider } from "@/billing/billing-context";
import { LifecycleProvider } from "@/capsules/lifecycle-context";
import { DirectBreathingProvider } from "@/providers/breathing-context";
import { HoloStoreProvider } from "@/state/holo-store";
import { colors } from "@/theme/colors";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <BillingProvider>
        <HoloStoreProvider>
          <DirectBreathingProvider>
            <LifecycleProvider>
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
                    title: "Holo Zoo Wild Credits",
                    presentation: "modal",
                  }}
                />
              </Stack>
            </LifecycleProvider>
          </DirectBreathingProvider>
        </HoloStoreProvider>
      </BillingProvider>
    </SafeAreaProvider>
  );
}
