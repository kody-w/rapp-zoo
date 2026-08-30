import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { View } from "react-native";
import { scheduleGrowl } from "@/lib/growl";
import { parsePlayerMessage } from "@/lib/player-html";
import type { GrowlState } from "@/lib/types";
import type { HoloStageHandle, HoloStageProps } from "./holo-stage-types";

type AudioContextConstructor = new () => AudioContext;

const HoloStage = forwardRef<HoloStageHandle, HoloStageProps>(
  function HoloStage({ html, onStatus, onGrowlResult }, forwardedRef) {
    const iframe = useRef<HTMLIFrameElement | null>(null);
    useImperativeHandle(forwardedRef, () => ({
      playGrowl(growl) {
        try {
          playWebGrowl(growl);
          onGrowlResult(`Played ${growl.notes.length} completed NOTE events.`);
        } catch (error) {
          onGrowlResult(`Growl could not play: ${(error as Error).message}`);
        }
      },
    }));
    useEffect(() => {
      const listener = (event: MessageEvent) => {
        const envelope = event.data as { source?: string; payload?: unknown };
        const payload =
          envelope?.source === "rolling-cores-sandbox"
            ? envelope.payload
            : event.source === iframe.current?.contentWindow
              ? event.data
              : null;
        const status = parsePlayerMessage(payload);
        if (status) onStatus(status);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    }, [onStatus]);
    return (
      <View style={{ flex: 1, backgroundColor: "#03070c" }}>
        {createElement("iframe", {
          ref: iframe,
          srcDoc: html,
          title: "Live Holo stage",
          onLoad: () => {
            window.setTimeout(
              () =>
                iframe.current?.contentWindow?.postMessage(
                  { type: "rolling-cores-request-status" },
                  "*",
                ),
              250,
            );
          },
          sandbox: "allow-scripts",
          referrerPolicy: "no-referrer",
          style: {
            width: "100%",
            height: "100%",
            border: 0,
            background: "#03070c",
          },
        })}
      </View>
    );
  },
);

function playWebGrowl(
  growl: Extract<GrowlState, { kind: "playable" }>,
): void {
  const AudioContextImpl = (window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext) as AudioContextConstructor | undefined;
  if (!AudioContextImpl) throw new Error("WebAudio is unavailable.");
  const context = new AudioContextImpl();
  void context.resume();
  const master = context.createGain();
  master.gain.value = 0.12;
  master.connect(context.destination);
  const origin = context.currentTime + 0.02;
  const totalMs = scheduleGrowl(growl.notes, (note, onsetMs, durationMs) => {
    const start = origin + onsetMs / 1000;
    const stop = start + durationMs / 1000;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(note.velocity / 127, start + 0.01);
    envelope.gain.setValueAtTime(
      note.velocity / 127,
      Math.max(start + 0.01, stop - 0.03),
    );
    envelope.gain.linearRampToValueAtTime(0, stop);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(start);
    oscillator.stop(stop + 0.01);
  }, growl.ticksPerQuarter, growl.tempoMilliBpm);
  window.setTimeout(() => void context.close(), totalMs + 250);
}

export default HoloStage;
