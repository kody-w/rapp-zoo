import type { GalleryOrganism } from "@/capsules/types";
import { domainHash } from "@/lib/strict-json";

export type FieldSignalBand = "near" | "mid" | "far";

export type FieldEncounter = {
  id: string;
  organism: GalleryOrganism;
  xPercent: number;
  yPercent: number;
  signal: number;
  band: FieldSignalBand;
  habitat: string;
};

const HABITATS = [
  "Signal Garden",
  "Glass Meadow",
  "Orbit Commons",
  "Memory Grove",
] as const;

export function buildFieldEncounters(
  gallery: GalleryOrganism[],
): FieldEncounter[] {
  return [...gallery]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((organism) => {
      const hash = domainHash("holo-zoo/field-encounter/1", {
        organism_id: organism.id,
      });
      const xPercent = 14 + (Number.parseInt(hash.slice(0, 2), 16) % 72);
      const yPercent = 16 + (Number.parseInt(hash.slice(2, 4), 16) % 68);
      const signal = 62 + (Number.parseInt(hash.slice(4, 6), 16) % 37);
      const band: FieldSignalBand =
        signal >= 88 ? "near" : signal >= 74 ? "mid" : "far";
      const habitat =
        HABITATS[Number.parseInt(hash.slice(6, 8), 16) % HABITATS.length]!;
      return {
        id: `encounter:${organism.id}`,
        organism,
        xPercent,
        yPercent,
        signal,
        band,
        habitat,
      };
    });
}

export function nextFieldEncounter(
  encounters: FieldEncounter[],
  currentId: string | null,
): FieldEncounter | null {
  if (encounters.length === 0) return null;
  const currentIndex = encounters.findIndex(
    (encounter) => encounter.id === currentId,
  );
  return encounters[(currentIndex + 1) % encounters.length]!;
}
