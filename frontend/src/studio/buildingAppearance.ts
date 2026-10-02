import { componentColors, type Category, type Parameters } from "./model";

export type BuildingColorMode = "material" | "category";

// Display palettes only; the original colours and geometry stay in the GUGIS file.
export const materialColors: Record<string, string> = {
  wall: "#c5b49a",
  column: "#d4c9b3",
  ornament: "#e0d7c5",
  slab: "#aca79c",
  window: "#819fa7",
  door: "#375c53",
  balcony: "#8c9390",
  railing: "#4a5557",
  roof: "#565e63",
  stair: "#92918b",
};
const streetWalls = ["#b9826c", "#c8b99c", "#d8cfbb", "#aa7663", "#c2aa8c"];

export function buildingColor(
  category: Category,
  kind: Parameters["kind"],
  key: string,
  mode: BuildingColorMode,
  fallback = "#c5b49a",
): string {
  if (mode === "category") return componentColors[category] ?? fallback;
  if (category === "wall") {
    if (["warehouse", "victorian"].includes(kind)) return "#aa7663";
    if (kind === "tudor") return "#e0d7c5";
    if (kind === "urban" || kind === "footprint") {
      let hash = 0;
      for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      return streetWalls[hash % streetWalls.length];
    }
  }
  if (kind === "tudor" && (category === "column" || category === "railing")) return "#62574c";
  return materialColors[category] ?? fallback;
}

export const materialLegend = [
  ["砖砌立面", "#aa7663"],
  ["石材与灰泥", "#c5b49a"],
  ["浅色石雕", "#e0d7c5"],
  ["板岩屋面", "#565e63"],
  ["玻璃窗", "#819fa7"],
  ["深绿门扇", "#375c53"],
  ["金属栏杆", "#4a5557"],
  ["木构件", "#62574c"],
] as const;
