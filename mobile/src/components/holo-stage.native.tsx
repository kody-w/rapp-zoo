import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { parsePlayerMessage } from "@/lib/player-html";
import type { HoloStageHandle, HoloStageProps } from "./holo-stage-types";

const HoloStage = forwardRef<HoloStageHandle, HoloStageProps>(
  function HoloStage({ html, onStatus, onGrowlResult }, forwardedRef) {
    const webView = useRef<WebView>(null);
    const source = useMemo(() => ({ html, baseUrl: "about:blank" }), [html]);
    useImperativeHandle(forwardedRef, () => ({
      playGrowl(growl) {
        const serialized = JSON.stringify(growl.value).replaceAll(
          "<",
          "\\u003c",
        );
        webView.current?.injectJavaScript(
          `window.RollingCoresNative.playGrowl(${serialized})` +
            `.then(r=>window.ReactNativeWebView.postMessage(JSON.stringify({schema:"rolling-cores-growl-result/1",...r})))` +
            `.catch(e=>window.ReactNativeWebView.postMessage(JSON.stringify({schema:"rolling-cores-growl-result/1",error:String(e&&e.message||e)})));true;`,
        );
      },
    }));
    const onMessage = (event: WebViewMessageEvent) => {
      try {
        const message: unknown = JSON.parse(event.nativeEvent.data);
        const status = parsePlayerMessage(message);
        if (status) onStatus(status);
        const result = message as { schema?: string; played?: number; error?: string | null };
        if (result.schema === "rolling-cores-growl-result/1") {
          onGrowlResult(
            result.error
              ? `Growl could not play: ${result.error}`
              : `Played ${result.played ?? 0} completed NOTE events.`,
          );
        }
      } catch {
        onGrowlResult("The sandbox returned an unreadable status message.");
      }
    };
    return (
      <WebView
        ref={webView}
        source={source}
        style={styles.webView}
        originWhitelist={["about:*", "data:*"]}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith("about:blank") ||
          request.url.startsWith("data:text/html")
        }
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled={false}
        incognito
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        accessibilityLabel="Live Holo stage"
      />
    );
  },
);

const styles = StyleSheet.create({
  webView: {
    flex: 1,
    backgroundColor: "#03070c",
  },
});

export default HoloStage;
