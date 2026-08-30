import {
  holoProtocol,
  hologramCss,
  hologramRuntime,
  threeR128,
  viewerHtml,
} from "@/generated/holo-assets";
import { canonicalize } from "./strict-json";
import type { JsonObject } from "./types";

const bridge = String.raw`
(() => {
  "use strict";
  const send = (payload) => {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
    if (window.parent !== window) {
      window.parent.postMessage({ source: "rolling-cores-sandbox", payload }, "*");
    }
  };
  let lastStatus = null;
  window.__holoZooPostMessage = (payload) => {
    if (payload && payload.schema === "rapp-holo-player-status/1") {
      lastStatus = payload;
    }
    send(payload);
  };
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "rolling-cores-request-status") {
      if (lastStatus) send(lastStatus);
      return;
    }
    if (message && message.type === "rolling-cores-play-growl") {
      window.HoloZooNative.playGrowl(message.growl)
        .then((result) => send({ schema: "rolling-cores-growl-result/1", ...result }))
        .catch((error) => send({
          schema: "rolling-cores-growl-result/1",
          error: String(error && error.message || error),
        }));
      return;
    }
    if (event.source !== window || !message || typeof message !== "object") return;
    if (
      message.schema === "rapp-holo-player-status/1"
      || message.schema === "rapp-holo-error/1"
      || message.schema === "rapp-holo-active/1"
    ) {
      send(message);
    }
  });
  if (window.parent !== window) {
    window.setInterval(() => {
      if (lastStatus) send(lastStatus);
    }, 500);
  }
  const integer = (value, minimum, maximum, label) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(label + " is outside the completed NOTE contract.");
    }
    return value;
  };
  async function playGrowl(growl) {
    if (!growl || typeof growl !== "object") {
      throw new Error("Growl requires the completed rapp-holo-growl/1 object.");
    }
    const notes = [...(growl.prompt || []), ...(growl.continuation || [])];
    if (notes.length < 9 || notes.length > 2080) {
      throw new Error("Growl requires 9-2080 completed NOTE events.");
    }
    const ticksPerQuarter = integer(
      growl.ticks_per_quarter, 24, 960, "ticks_per_quarter"
    );
    const tempoMilliBpm = integer(
      growl.tempo_milli_bpm, 30000, 300000, "tempo_milli_bpm"
    );
    const stepMs = 60000000 / (tempoMilliBpm * ticksPerQuarter);
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("WebAudio is unavailable.");
    const context = new AudioContext();
    await context.resume();
    const master = context.createGain();
    master.gain.value = 0.12;
    master.connect(context.destination);
    const origin = context.currentTime + 0.02;
    let onsetMs = 0;
    let end = origin;
    notes.forEach((raw, index) => {
      const pitch = integer(raw.pitch, 0, 127, "NOTE " + index + " pitch");
      onsetMs += integer(raw.delta_onset, 0, 65535, "NOTE " + index + " delta_onset") * stepMs;
      const duration = integer(raw.duration, 1, 65535, "NOTE " + index + " duration") * stepMs;
      const velocity = integer(raw.velocity, 1, 127, "NOTE " + index + " velocity");
      const start = origin + onsetMs / 1000;
      const stop = start + duration / 1000;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 440 * (2 ** ((pitch - 69) / 12));
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(velocity / 127, start + 0.01);
      envelope.gain.setValueAtTime(velocity / 127, Math.max(start + 0.01, stop - 0.03));
      envelope.gain.linearRampToValueAtTime(0, stop);
      oscillator.connect(envelope);
      envelope.connect(master);
      oscillator.start(start);
      oscillator.stop(stop + 0.01);
      end = Math.max(end, stop);
    });
    window.setTimeout(() => context.close(), Math.ceil((end - origin + 0.25) * 1000));
    return { played: notes.length, error: null };
  }
  window.RollingCoresNative = Object.freeze({ playGrowl });
})();
`;

export function buildPlayerHtml(update: JsonObject): string {
  const config = canonicalize({
    mode: "holo/1",
    id: "rolling-cores-expo",
    holo_update: update,
  }).replaceAll("<", "\\u003c");
  const inline = (script: string) => script.replaceAll("</script", "<\\/script");
  const bridgedRuntime = hologramRuntime.replaceAll(
    "parent.postMessage(",
    "window.__holoZooPostMessage(",
  );
  return viewerHtml
    .replace(
      '<link rel="stylesheet" href="/static/hologram.css" nonce="__HOLOGRAM_NONCE__">',
      `<style nonce="rolling-cores">${hologramCss}</style>`,
    )
    .replace("__HOLOGRAM_CONFIG__", config)
    .replaceAll("__HOLOGRAM_NONCE__", "rolling-cores")
    .replace(
      '<script src="/static/vendor/three-r128.min.js" nonce="rolling-cores"></script>',
      `<script nonce="rolling-cores">${inline(threeR128)}</script>`,
    )
    .replace(
      '<script src="/static/holo-protocol.js" nonce="rolling-cores"></script>',
      `<script nonce="rolling-cores">${inline(holoProtocol)}</script>`,
    )
    .replace(
      '<script src="/static/hologram-runtime.js" nonce="rolling-cores"></script>',
      `<script nonce="rolling-cores">${inline(bridge)}</script><script nonce="rolling-cores">${inline(bridgedRuntime)}</script>`,
    )
    .replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-rolling-cores'; style-src 'nonce-rolling-cores'; connect-src 'none'; img-src data:; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'">`,
    );
}

export function parsePlayerMessage(value: unknown): {
  authoritativeHoloId: string | null;
  playerActiveHoloId: string | null;
  logicalMs: number;
  error: string | null;
} | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  if (object.schema !== "rapp-holo-player-status/1") return null;
  return {
    authoritativeHoloId:
      typeof object.authoritative_holo_id === "string"
        ? object.authoritative_holo_id
        : null,
    playerActiveHoloId:
      typeof object.player_active_holo_id === "string"
        ? object.player_active_holo_id
        : null,
    logicalMs: typeof object.logical_ms === "number" ? object.logical_ms : 0,
    error: typeof object.error === "string" ? object.error : null,
  };
}
