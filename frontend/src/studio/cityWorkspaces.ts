import { normalizeTileLoadingProfile, type TileLoadingProfile } from "./renderTileClient";
import workspaceCatalog from "../../../shared/city-workspaces.json";

export interface CityWorkspace {
  id: string;
  name: string;
  city_name?: string;
  status: string;
  coverage_kind: string;
  coverage_label: string;
  query_bbox_wgs84?: [number, number, number, number];
  center_wgs84?: [number, number];
  actual_data_bbox_wgs84?: [number, number, number, number] | null;
  building_extent_wgs84?: [number, number, number, number] | null;
  source?: string;
  source_url?: string;
  license?: string;
  building_count?: number;
  road_count?: number;
  height_policy?: string;
  data_revision?: string | null;
  data_origin?: "saved-project" | "public-seed" | "missing";
  quality_warnings?: Array<{ code: string; message: string; osm_ids: number[] }>;
}

export const defaultCityWorkspace: CityWorkspace = {
  id: "bristol", name: "布里斯托", city_name: "Bristol", status: "ready",
  coverage_kind: "sample-area", coverage_label: "起始样本街区，非全城覆盖",
  center_wgs84: [-2.603, 51.454],
};

export type CityId = "bristol" | "london" | "birmingham" | "manchester" | "edinburgh" | "cardiff" | "york" | "bath" | "oxford";
export const knownCities = workspaceCatalog.map(record => record.id as CityId);

export function cityIdFromSearch(search: string): CityId {
  const id = new URLSearchParams(search).get("city");
  return knownCities.includes(id as CityId) ? id as CityId : "bristol";
}

export function cityWorkspaceUrl(href: string, id: CityId): string {
  const url = new URL(href);
  if (url.hash.startsWith("#gugis-view")) url.hash = "";
  if (id === "bristol") url.searchParams.delete("city");
  else url.searchParams.set("city", id);
  return url.href;
}

export function cityWorkspaceHref(id: string, path = "/"): string {
  const url = new URL(path, "http://local.invalid");
  if (id !== "bristol") url.searchParams.set("city", id);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function cityCoverageCoordinates(workspace: CityWorkspace): string | null {
  const actual = workspace.actual_data_bbox_wgs84;
  const extent = actual ?? workspace.building_extent_wgs84;
  if (!extent || extent.length !== 4 || !extent.every(Number.isFinite)) return null;
  return `${actual ? "已导入要素范围" : "建筑位置范围"}：经度 ${extent[0].toFixed(4)}°～${extent[2].toFixed(4)}°，纬度 ${extent[1].toFixed(4)}°～${extent[3].toFixed(4)}°`;
}

export function heightPolicyLabel(policy?: string): string {
  const fallback = "建筑高度采用源属性或明确的估算值，未整体测量核验";
  if (!policy?.trim()) return fallback;
  if (!policy.trim().startsWith("{")) return policy;
  try {
    const counts = JSON.parse(policy);
    const keys = ["height-tag", "levels-derived", "assumed"];
    if (!counts || typeof counts !== "object" || !keys.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) return fallback;
    const count = (key: string) => counts[key].toLocaleString("zh-CN");
    return `${count("height-tag")} 栋采用 OSM 高度标签 / ${count("levels-derived")} 栋按楼层数 × 3.2 m 估算 / ${count("assumed")} 栋假定 9.6 m；高度标签未独立核验`;
  } catch { return fallback; }
}

export function cityDataOriginLabel(workspace: CityWorkspace): string {
  if (workspace.data_origin === "saved-project") return "本机已保存项目";
  if (workspace.data_origin === "public-seed") return "公开种子样本（尚未保存为本机项目）";
  if (workspace.data_origin === "missing") return "待导入工作区";
  return "城市数据目录";
}

export function citySourceLicense(workspace: CityWorkspace): { url: string; label: string } | null {
  if (/OpenStreetMap|ODbL/i.test(`${workspace.source ?? ""} ${workspace.license ?? ""}`))
    return { url: "https://www.openstreetmap.org/copyright", label: "© OpenStreetMap contributors · ODbL 1.0" };
  if (!workspace.source_url) return null;
  try {
    const url = new URL(workspace.source_url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return { url: url.href, label: "查看数据来源" };
  } catch { return null; }
}

export function cityCenter(workspace: CityWorkspace): { longitude: number; latitude: number } {
  const bounds = workspace.query_bbox_wgs84;
  const center = workspace.center_wgs84 ?? (bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : undefined);
  const bundled = workspaceCatalog.find(record => record.id === workspace.id)?.query_bbox_wgs84;
  const fallback = bundled ? [(bundled[0] + bundled[2]) / 2, (bundled[1] + bundled[3]) / 2] : [-2.603, 51.454];
  return { longitude: center?.[0] ?? fallback[0], latitude: center?.[1] ?? fallback[1] };
}

export async function loadCityWorkspaces(): Promise<CityWorkspace[]> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
  // A cold catalogue validates every saved workspace once. Expanded cities
  // must not appear broken merely because their first validation exceeds 15s.
  // Subsequent requests reuse bounded backend summaries; no geometry is sent.
  const response = await fetch(`${base}/cities`, { cache: "no-store", signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`城市目录读取失败（${response.status}）`);
  const result = await response.json();
  if (!result || !Array.isArray(result.cities)) throw new Error("城市目录格式无效");
  return result.cities.filter((city: CityWorkspace) => knownCities.includes(city.id as CityId));
}

/** Explicit entry choices; the existing single-city URLs remain valid deep links. */
export function selectedCitiesFromSearch(search: string): CityId[] {
  const query = new URLSearchParams(search);
  const selected = [...new Set((query.get("cities") ?? "").split(","))]
    .filter((id): id is CityId => knownCities.includes(id as CityId));
  if (selected.length) return selected;
  if (knownCities.includes(query.get("city") as CityId) ||
      ["city", "author", "detail", "environment", "analysis"].includes(query.get("workspace") ?? ""))
    return [...knownCities]; // Preserve old direct-link switching behaviour.
  return [];
}

export function selectedCityFromSearch(search: string, selected: CityId[]): CityId {
  const requested = cityIdFromSearch(search);
  return selected.includes(requested) ? requested : selected[0] ?? "bristol";
}

export function tileProfileFromSearch(search: string): TileLoadingProfile {
  return normalizeTileLoadingProfile(new URLSearchParams(search).get("tile_profile"));
}

/** Normalize only the profile field, preserving camera identity fields for validation. */
export function tileProfileUrl(href: string, tiles: boolean, profile: TileLoadingProfile = "balanced"): string {
  const url = new URL(href), values = url.searchParams.getAll("tile_profile");
  const economy = tiles && normalizeTileLoadingProfile(profile) === "economy";
  if (economy ? values.length === 1 && values[0] === "economy" : values.length === 0) return href;
  if (economy) url.searchParams.set("tile_profile", "economy");
  else url.searchParams.delete("tile_profile");
  return url.href;
}

export function citySessionUrl(href: string, selected: CityId[], active: CityId | null, tiles?: boolean, preserveCamera = false,
  tileProfile: TileLoadingProfile = "balanced"): string {
  const url = new URL(href);
  // Transitions never carry a view owned by a previous city or editing mode.
  if (!preserveCamera && url.hash.startsWith("#gugis-view")) url.hash = "";
  if (active && selected.includes(active)) {
    // Retain Bristol explicitly so a fresh '/' always opens the selection step.
    url.searchParams.set("city", active);
    url.searchParams.set("cities", selected.join(","));
    if (tiles === true) url.searchParams.set("view_mode", "tiles");
    else if (tiles === false) url.searchParams.delete("view_mode");
    if (url.searchParams.get("view_mode") === "tiles" && normalizeTileLoadingProfile(tileProfile) === "economy")
      url.searchParams.set("tile_profile", "economy");
    else url.searchParams.delete("tile_profile");
  } else {
    for (const key of ["city", "cities", "workspace", "view", "view_mode", "tile_profile"]) url.searchParams.delete(key);
  }
  return url.href;
}
