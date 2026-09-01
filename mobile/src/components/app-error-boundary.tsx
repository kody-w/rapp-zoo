import {
  Component,
  type ErrorInfo,
  type PropsWithChildren,
} from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
} from "react-native";
import { domainHash } from "@/lib/strict-json";
import { colors } from "@/theme/colors";

type State = {
  error: Error | null;
  reference: string | null;
};

export class AppErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = {
    error: null,
    reference: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      reference: `HZ-${domainHash("holo-zoo/local-error/1", {
        message: error.message,
        name: error.name,
      }).slice(0, 12)}`,
    };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally no automatic telemetry or console logging.
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.eyebrow}>LOCAL ERROR · NO DATA UPLOADED</Text>
        <Text style={styles.title}>Holo Zoo paused safely.</Text>
        <Text style={styles.copy}>
          Your local capsules and history were not deleted. Retry the interface
          or include the reference below when contacting support.
        </Text>
        <Text selectable style={styles.reference}>
          {this.state.reference}
        </Text>
        <Text selectable style={styles.detail}>
          {this.state.error.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => this.setState({ error: null, reference: null })}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Retry Holo Zoo</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    justifyContent: "center",
    gap: 14,
    padding: 24,
    backgroundColor: colors.background,
  },
  eyebrow: {
    color: colors.red,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
  },
  copy: {
    color: colors.muted,
    lineHeight: 21,
  },
  reference: {
    color: colors.accent,
    fontFamily: "monospace",
    fontWeight: "800",
  },
  detail: {
    color: colors.text,
    fontFamily: "monospace",
    fontSize: 11,
  },
  button: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.panelRaised,
  },
  buttonText: {
    color: colors.text,
    fontWeight: "900",
  },
});
