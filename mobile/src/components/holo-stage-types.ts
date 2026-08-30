import type { GrowlState, PlayerStatus } from "@/lib/types";

export type HoloStageHandle = {
  playGrowl: (growl: Extract<GrowlState, { kind: "playable" }>) => void;
};

export type HoloStageProps = {
  html: string;
  onStatus: (status: PlayerStatus) => void;
  onGrowlResult: (message: string) => void;
};
