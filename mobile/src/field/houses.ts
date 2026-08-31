import AsyncStorage from "@react-native-async-storage/async-storage";

export const HOUSE_STORAGE_KEY = "@holo-zoo/starting-house-v1";

export const STARTING_HOUSES = [
  {
    code: "overwatch",
    name: "Overwatch",
    founderProfile: "Molly",
    purpose: "See the whole field, coordinate the flock, and keep priorities aligned.",
  },
  {
    code: "scout",
    name: "Scout",
    founderProfile: "Sawyer",
    purpose: "Explore new paths, discover signal, and bring back verified intelligence.",
  },
  {
    code: "forge",
    name: "Forge",
    founderProfile: "Evelyn",
    purpose: "Build, create, combine, and improve useful things.",
  },
  {
    code: "sentinel",
    name: "Sentinel",
    founderProfile: "Kody",
    purpose: "Protect continuity, verify evidence, and hold the safety boundary.",
  },
] as const;

export type HouseCode = (typeof STARTING_HOUSES)[number]["code"];

export function isHouseCode(value: unknown): value is HouseCode {
  return (
    typeof value === "string" &&
    STARTING_HOUSES.some((house) => house.code === value)
  );
}

export function houseForCode(code: HouseCode) {
  const house = STARTING_HOUSES.find((candidate) => candidate.code === code);
  if (!house) throw new Error(`Unknown starting house: ${code}`);
  return house;
}

export async function loadHouseMembership(): Promise<HouseCode | null> {
  const value = await AsyncStorage.getItem(HOUSE_STORAGE_KEY);
  if (value === null) return null;
  if (!isHouseCode(value)) {
    await AsyncStorage.removeItem(HOUSE_STORAGE_KEY);
    return null;
  }
  return value;
}

export async function saveHouseMembership(code: HouseCode): Promise<void> {
  await AsyncStorage.setItem(HOUSE_STORAGE_KEY, code);
}

export async function clearHouseMembership(): Promise<void> {
  await AsyncStorage.removeItem(HOUSE_STORAGE_KEY);
}
