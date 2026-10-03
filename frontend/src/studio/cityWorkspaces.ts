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
}

export const defaultCityWorkspace: CityWorkspace = {
  id: "bristol", name: "布里斯托", city_name: "Bristol", status: "ready",
  coverage_kind: "sample-area", coverage_label: "起始样本街区，非全城覆盖",
  center_wgs84: [-2.603, 51.454],
};

export const knownCities = ["bristol", "london", "birmingham"] as const;
export type CityId = typeof knownCities[number];

export function cityIdFromSearch(search: string): CityId {
  const id = new URLSearchParams(search).get("city");
  return knownCities.includes(id as CityId) ? id as CityId : "bristol";
}

export function cityWorkspaceUrl(href: string, id: CityId): string {
  const url = new URL(href);
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

export function citySourceLicense(workspace: CityWorkspace): { url: string; label: string } | null {
  if (/OpenStreetMap|ODbL/i.test(`${workspace.source ?? ""} ${workspace.license ?? ""}`))
    return { url: "https://www.openstreetmap.org/copyright", label: "© OpenStreetMap contributors · ODbL 1.0" };
  return workspace.source_url ? { url: workspace.source_url, label: "查看数据来源" } : null;
}

export function cityCenter(workspace: CityWorkspace): { longitude: number; latitude: number } {
  const bounds = workspace.query_bbox_wgs84;
  const center = workspace.center_wgs84 ?? (bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : undefined);
  const fallback = workspace.id === "london" ? [-0.1276, 51.5072]
    : workspace.id === "birmingham" ? [-1.9027, 52.4797] : [-2.603, 51.454];
  return { longitude: center?.[0] ?? fallback[0], latitude: center?.[1] ?? fallback[1] };
}

export async function loadCityWorkspaces(): Promise<CityWorkspace[]> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
  const response = await fetch(`${base}/cities`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`城市目录读取失败（${response.status}）`);
  const result = await response.json();
  if (!result || !Array.isArray(result.cities)) throw new Error("城市目录格式无效");
  return result.cities.filter((city: CityWorkspace) => knownCities.includes(city.id as CityId));
}
