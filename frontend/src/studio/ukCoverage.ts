export type ReadinessCountry = "England" | "Scotland" | "Wales" | "Northern Ireland";
export interface ReadinessSample {
  workspace_id: string; display_name: string;
  status: "available" | "missing" | "invalid" | "unavailable";
  building_count: number | null; road_count: number | null; data_revision: string | null;
  related_city_id: string; boundary_membership_verified: false; association_note: string;
}
export interface ReadinessCity {
  id: string; source_name: string; display_name: string; country: ReadinessCountry;
  country_code: string; aliases: string[];
  sample: { state: ReadinessSample["status"] | "none"; workspace_ids: string[]; boundary_membership_verified: false };
  boundary: { state: "not-recorded" | "receipt-recorded" | "validation-failed"; receipt: Record<string, unknown> | null; reason_code?: string };
  import: { scope: "full-boundary"; state: "not-imported" };
  coverage: { state: "not-assessed" };
}
export interface UkReadiness {
  schema: "gugis-uk-readiness-v1";
  summary: { registered_cities: number; sample_workspaces: number; available_sample_workspaces: number; coverage_assessment: "not-assessed" };
  source: { title: string; url: string; published_at: string; verified_at: string; license: string;
    license_url: string; attribution: string; scope: string; conferral_caveat: string };
  country_counts: Record<ReadinessCountry, number>;
  samples: ReadinessSample[];
  cities: ReadinessCity[];
}
export type ReadinessSampleStatus = ReadinessCity["sample"]["state"];
export type ReadinessBoundaryStatus = ReadinessCity["boundary"]["state"] | "unsupported-platform";
export interface ReadinessStatusFilters {
  sample?: ReadinessSampleStatus | "";
  boundary?: ReadinessBoundaryStatus | "";
}
export const sampleStatusLabels: Record<ReadinessSampleStatus, string> = {
  available: "相关样本可用", missing: "尚无可用样本数据", invalid: "样本数据异常",
  unavailable: "样本状态不可用", none: "尚无关联样本",
};
export const boundaryStatusLabels: Record<ReadinessBoundaryStatus, string> = {
  "not-recorded": "未记录边界", "receipt-recorded": "已有结构检查回执",
  "validation-failed": "回执校验失败", "unsupported-platform": "当前平台未检查",
};
// Unsupported receipt I/O is encoded as a failed read by the API, but says
// nothing about the validity of the file or its geometry. Keep it separate in
// both the local filter and the label displayed for a city.
export function boundaryReadinessStatus(city: ReadinessCity): ReadinessBoundaryStatus {
  return city.boundary.reason_code === "unsupported-platform" ? "unsupported-platform" : city.boundary.state;
}
export const countryNames: Record<ReadinessCountry, string> = { England: "英格兰", Scotland: "苏格兰", Wales: "威尔士", "Northern Ireland": "北爱尔兰" };
const countries = Object.keys(countryNames) as ReadinessCountry[];
const countryCodes: Record<ReadinessCountry, string> = { England: "ENG", Scotland: "SCT", Wales: "WLS", "Northern Ireland": "NIR" };
const sampleStates = ["available", "missing", "invalid", "unavailable"];
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const short = (v: unknown): v is string => typeof v === "string" && v.length <= 4096;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function safeSourceUrl(value: string): string | null {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function parseUkReadiness(value: unknown): UkReadiness {
  check(record(value) && value.schema === "gugis-uk-readiness-v1" && Array.isArray(value.cities) && value.cities.length > 0 && value.cities.length <= 200, "英国城市接入目录格式不受支持");
  check(record(value.summary) && value.summary.registered_cities === value.cities.length &&
    count(value.summary.sample_workspaces) && count(value.summary.available_sample_workspaces) && value.summary.coverage_assessment === "not-assessed", "接入目录不能把登记数量当成覆盖率");
  check(record(value.source) && ["title", "url", "published_at", "verified_at", "license", "license_url", "attribution", "scope", "conferral_caveat"].every(k => short(value.source[k])) && safeSourceUrl(value.source.url), "城市名单来源信息无效");
  check(record(value.country_counts) && countries.every(c => count(value.country_counts[c])), "地区计数无效");
  const ids = new Set<string>(), totals = Object.fromEntries(countries.map(c => [c, 0]));
  for (const city of value.cities) {
    check(record(city) && typeof city.id === "string" && /^uk-(eng|sct|wls|nir)-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.id) && !ids.has(city.id) &&
      short(city.source_name) && city.source_name.trim().length > 0 && short(city.display_name) && countries.includes(city.country) &&
      city.country_code === countryCodes[city.country as ReadinessCountry] && city.id.startsWith(`uk-${city.country_code.toLowerCase()}-`) &&
      Array.isArray(city.aliases) && city.aliases.length <= 20 && city.aliases.every(short), "城市记录无效或标识重复");
    check(record(city.sample) && [...sampleStates, "none"].includes(city.sample.state) && Array.isArray(city.sample.workspace_ids) &&
      city.sample.workspace_ids.length <= 10 && city.sample.workspace_ids.every(short) && city.sample.boundary_membership_verified === false, "样本关联不能代替边界核验");
    check(record(city.boundary) && ["not-recorded", "receipt-recorded", "validation-failed"].includes(city.boundary.state) &&
      (city.boundary.receipt === null || record(city.boundary.receipt)), "边界回执状态无效");
    check(record(city.import) && city.import.scope === "full-boundary" && city.import.state === "not-imported" &&
      record(city.coverage) && city.coverage.state === "not-assessed", "当前目录不支持全城覆盖断言");
    ids.add(city.id); totals[city.country]++;
  }
  check(countries.every(c => totals[c] === value.country_counts[c]), "城市名单与地区计数不一致");
  check(Array.isArray(value.samples) && value.samples.length <= 10 && value.samples.length === value.summary.sample_workspaces, "样本工作区计数无效");
  const samples = new Set<string>();
  for (const sample of value.samples) {
    check(record(sample) && short(sample.workspace_id) && !samples.has(sample.workspace_id) && short(sample.display_name) &&
      sampleStates.includes(sample.status) && (count(sample.building_count) || (sample.status !== "available" && sample.building_count === null)) &&
      (count(sample.road_count) || (sample.status !== "available" && sample.road_count === null)) &&
      (sample.data_revision === null || /^[a-f0-9]{64}$/.test(sample.data_revision)) && ids.has(sample.related_city_id) &&
      sample.boundary_membership_verified === false && short(sample.association_note), "样本工作区信息无效");
    samples.add(sample.workspace_id);
  }
  check(value.samples.filter((s: ReadinessSample) => s.status === "available").length === value.summary.available_sample_workspaces &&
    value.cities.every((c: ReadinessCity) => c.sample.workspace_ids.every(id => value.samples.some((s: ReadinessSample) => s.workspace_id === id && s.related_city_id === c.id))) &&
    value.samples.every((s: ReadinessSample) => value.cities.some((c: ReadinessCity) => c.id === s.related_city_id && c.sample.workspace_ids.includes(s.workspace_id))), "样本关联与可用数不一致");
  return value as UkReadiness;
}
export function filterReadinessCities(cities: ReadinessCity[], country: string, query: string, statuses: ReadinessStatusFilters = {}): ReadinessCity[] {
  const needle = query.trim().toLocaleLowerCase();
  return cities.filter(city => (!country || city.country === country) &&
    (!statuses.sample || city.sample.state === statuses.sample) &&
    (!statuses.boundary || boundaryReadinessStatus(city) === statuses.boundary) && (!needle ||
    [city.source_name, city.display_name, ...city.aliases].some(value => value.toLocaleLowerCase().includes(needle))));
}
export async function loadUkReadiness(signal: AbortSignal): Promise<UkReadiness> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const response = await fetch(`${base}/coverage/uk-cities`, { signal: boundedSignal, cache: "no-store" });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`英国城市目录读取失败（${response.status}）`); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取接入目录");
  const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  boundedSignal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (boundedSignal.aborted) throw new DOMException("已取消", "AbortError");
      const result = await reader.read();
      if (boundedSignal.aborted) throw new DOMException("已取消", "AbortError");
      if (result.done) break;
      size += result.value.byteLength; check(size <= 1024 * 1024, "接入目录超过 1 MiB 限制"); chunks.push(result.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseUkReadiness(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { boundedSignal.removeEventListener("abort", abort); reader.releaseLock(); }
}
