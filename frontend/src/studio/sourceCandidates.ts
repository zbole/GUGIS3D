import type { CityWorkspace } from "./cityWorkspaces";

export type CandidateCity = "london" | "birmingham";
type Bounds = [number, number, number, number];
type HeightPolicy = { "height-tag": number; "levels-derived": number; assumed: number };
interface Snapshot { revision: string; building_count: number; road_count: number; height_policy: HeightPolicy }
interface Omission { osm_way: number; reason: string }
export interface CandidateDownload { url: string; sha256: string; byte_length: number; filename: string; media_type: string }
export interface SourceCandidate {
  version: "v2"; status: "non-active"; baseline: Snapshot; candidate: Snapshot;
  source: { sha256: string; snapshot: string; licence: string; licence_url: string; attribution: string;
    attribution_url: string; coverage_label: string; query_bbox_wgs84: Bounds; actual_data_bbox_wgs84: Bounds; scope: "sample-area" };
  changes: { height_corrections: Array<{ osm_way: number; name: string; baseline_height_m: number; candidate_height_m: number }>;
    removed_buildings: Omission[]; preexisting_omissions: Omission[]; added_osm_ways: number[];
    unchanged: { placements: true; parameters: true; roads: true }; assumed_height_wording_changes: number };
  limitations: string[];
  downloads: Record<"provenance" | "archive" | "report", CandidateDownload>;
}
export interface SourceCandidates {
  format: "gugis-source-candidates"; schema_version: 1; city_id: string;
  comparison_basis: "original-seed-vs-non-active-candidate"; candidates: SourceCandidate[];
}
const hash = /^[a-f0-9]{64}$/;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown, max = 2000): v is string => typeof v === "string" && v.length <= max;
const way = (v: unknown): v is number => count(v) && v > 0;
const bounds = (v: unknown): v is Bounds => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite) &&
  v[0] >= -180 && v[2] <= 180 && v[1] >= -90 && v[3] <= 90 && v[0] <= v[2] && v[1] <= v[3];
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function snapshot(v: unknown): v is Snapshot {
  return object(v) && hash.test(v.revision) && count(v.building_count) && count(v.road_count) && object(v.height_policy) &&
    ["height-tag", "levels-derived", "assumed"].every(k => count(v.height_policy[k])) &&
    Object.values(v.height_policy).reduce<number>((sum, value) => sum + (value as number), 0) === v.building_count;
}
export function candidateSourceUrl(value: string): string | null {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function parseSourceCandidates(value: unknown, city: string): SourceCandidates {
  check(["bristol", "london", "birmingham"].includes(city) && object(value) && value.city_id === city &&
    value.format === "gugis-source-candidates" && value.schema_version === 1 &&
    value.comparison_basis === "original-seed-vs-non-active-candidate" && Array.isArray(value.candidates) &&
    value.candidates.length <= (city === "bristol" ? 0 : 1), "源修订候选目录格式或城市不匹配");
  for (const c of value.candidates) {
    check(object(c) && c.version === "v2" && c.status === "non-active" && snapshot(c.baseline) && snapshot(c.candidate), "候选版本或对象计数无效");
    const s = c.source;
    check(object(s) && hash.test(s.sha256) && text(s.snapshot, 50) && Number.isFinite(Date.parse(s.snapshot)) &&
      text(s.licence) && text(s.attribution) && text(s.coverage_label) && candidateSourceUrl(s.licence_url) &&
      candidateSourceUrl(s.attribution_url) && s.scope === "sample-area" && bounds(s.query_bbox_wgs84) && bounds(s.actual_data_bbox_wgs84), "候选来源、范围或许可无效");
    const changes = c.changes;
    check(object(changes) && Array.isArray(changes.height_corrections) && changes.height_corrections.length <= 100 &&
      Array.isArray(changes.added_osm_ways) && !changes.added_osm_ways.length && object(changes.unchanged) &&
      ["placements", "parameters", "roads"].every(k => changes.unchanged[k] === true) && count(changes.assumed_height_wording_changes) &&
      changes.assumed_height_wording_changes <= c.candidate.building_count, "候选差异说明不受支持");
    const omitted = new Set<number>();
    for (const entries of [changes.removed_buildings, changes.preexisting_omissions]) {
      check(Array.isArray(entries) && entries.length <= 1000, "候选遗漏清单过大或无效");
      for (const entry of entries) {
        check(object(entry) && way(entry.osm_way) && !omitted.has(entry.osm_way) && text(entry.reason) && entry.reason.trim(), "候选遗漏 ID 或原因无效");
        omitted.add(entry.osm_way);
      }
    }
    check(c.baseline.building_count - c.candidate.building_count === changes.removed_buildings.length &&
      c.baseline.road_count === c.candidate.road_count, "候选差异与对象计数不一致");
    const corrected = new Set<number>();
    for (const entry of changes.height_corrections) {
      check(object(entry) && way(entry.osm_way) && !omitted.has(entry.osm_way) && !corrected.has(entry.osm_way) && text(entry.name) &&
        [entry.baseline_height_m, entry.candidate_height_m].every(n => Number.isFinite(n) && n >= .1 && n <= 1000), "候选高度差异无效");
      corrected.add(entry.osm_way);
    }
    check(Array.isArray(c.limitations) && c.limitations.length <= 16 && c.limitations.every((v: unknown) => text(v)), "候选限制说明无效");
    check(object(c.downloads), "候选下载目录无效");
    for (const kind of ["provenance", "archive", "report"] as const) {
      const d = c.downloads[kind];
      check(object(d) && hash.test(d.sha256) && count(d.byte_length) && d.byte_length > 0 && d.byte_length <= 16 * 1024 * 1024 &&
        typeof d.filename === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(d.filename) &&
        d.media_type === (kind === "provenance" ? "application/zip" : "application/json") &&
        d.url === `/cities/${city}/source-candidates/v2/downloads/${d.sha256}/${kind}`, "候选下载地址或完整性信息无效");
    }
    check(c.downloads.archive.sha256 === c.candidate.revision, "候选下载与来源修订不一致");
  }
  return value as SourceCandidates;
}
export function catalogueCandidateRelation(workspace: CityWorkspace | undefined, candidate: SourceCandidate, city: CandidateCity) {
  if (!workspace || workspace.id !== city || workspace.status === "invalid" || !hash.test(workspace.data_revision ?? "")) return "unknown";
  if (workspace.data_revision === candidate.baseline.revision) return "baseline";
  if (workspace.data_revision === candidate.candidate.revision) return "candidate";
  return "different";
}
export function sourceCandidateDownloadUrl(download: CandidateDownload) {
  return `${(import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "")}${download.url}`;
}
export async function loadSourceCandidates(city: CandidateCity, signal: AbortSignal): Promise<SourceCandidates> {
  check(["london", "birmingham"].includes(city), "不支持的候选城市");
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const base = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
  const response = await fetch(`${base}/cities/${city}/source-candidates`, { signal: boundedSignal, cache: "no-store" });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`候选目录读取失败（${response.status}）`); }
  const reader = response.body?.getReader(); check(reader, "无法读取候选目录");
  const chunks: Uint8Array[] = []; let length = 0, cancellation: Promise<void> | undefined;
  const cancel = () => cancellation ??= reader.cancel().catch(() => {});
  boundedSignal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (boundedSignal.aborted) throw new DOMException("已取消", "AbortError");
      const item = await reader.read();
      if (boundedSignal.aborted) throw new DOMException("已取消", "AbortError");
      if (item.done) break;
      length += item.value.byteLength; check(length <= 256 * 1024, "候选目录超过 256 KiB 限制"); chunks.push(item.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
    check(response.headers.get("etag") === `"${digest}"`, "候选目录 SHA-256 / ETag 不匹配");
    if (boundedSignal.aborted) throw new DOMException("已取消", "AbortError");
    return parseSourceCandidates(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), city);
  } catch (error) { await cancel(); throw error; }
  finally { boundedSignal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
