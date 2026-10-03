import topology from "../../../shared/box-topology.json" with { type: "json" };
import type { CityDocument, Placement } from "./cityModel";
import type { BuildingDocument, Category, Parameters, Solid, Vec3 } from "./model";

export type GeographicBounds = [number, number, number, number];
type Bounds3 = [number, number, number, number, number, number];
export interface RenderView {
  bounds: GeographicBounds | null;
  center: { longitude: number; latitude: number };
}
export interface RenderTileDescriptor {
  id: string; grid: [number, number]; cell_bounds_enu: GeographicBounds;
  bounds_enu: Bounds3; bounds_wgs84: GeographicBounds;
  building_count: number; primitive_count: number; byte_length: number; sha256: string; url: string;
}
export interface RenderManifest {
  format: "gugis-render-package-v1"; city_id: string; name: string; revision: string;
  source_sha256: string; source_byte_length: number; package_sha256: string;
  bounds_enu: Bounds3 | null; bounds_wgs84: GeographicBounds | null;
  grid: { coordinate_system: "ECEF_ENU"; origin_wgs84: Vec3; tile_size_m: number };
  counts: { buildings: number; assets: number; primitives: number; tiles: number; source_roads: number };
  limits: { max_buildings: number; max_primitives: number; max_bytes: number; max_tiles: number };
  layers: Record<string, string>;
  quality_warnings_source_revision: string;
  quality_warnings: Array<{ code: string; message: string; osm_ids?: number[] }>;
  attribution: { source: string; license: string; license_url: string; metadata: Record<string, string> };
  tiles: RenderTileDescriptor[];
}
type Geometry = { kind: "box" } | { kind: "box-set"; bounds: Bounds3[] } |
  { kind: "mesh"; vertices: Vec3[]; triangles: Vec3[] };
export interface RenderPrimitive {
  id: string; node_id: string | null; template_id: string; category: Category;
  geometry: string; color: string; size?: Vec3; position: Vec3; rotation_z: number;
}
export interface RenderAsset {
  quality: "overview" | "full-fallback"; kind: Parameters["kind"]; primitives: RenderPrimitive[];
}
export interface RenderTile {
  format: "gugis-render-tile-v1"; city_id: string; revision: string; tile_id: string;
  geometry_library: Record<string, Geometry>; assets: Record<string, RenderAsset>; instances: Placement[];
}
export interface TileBudget {
  readonly activeTiles: number; readonly activeBytes: number;
  readonly cacheTiles: number; readonly cacheBytes: number; readonly concurrency: number;
}
export const tileBudget: TileBudget = Object.freeze({ activeTiles: 8, activeBytes: 8 * 1024 * 1024,
  cacheTiles: 16, cacheBytes: 16 * 1024 * 1024, concurrency: 3 });
/** Only these named profiles are exposed by navigation and the entry UI. */
export const tileLoadingProfiles = Object.freeze({
  balanced: tileBudget,
  economy: Object.freeze({ activeTiles: 2, activeBytes: 2 * 1024 * 1024,
    cacheTiles: 4, cacheBytes: 4 * 1024 * 1024, concurrency: 1 }),
});
export type TileLoadingProfile = keyof typeof tileLoadingProfiles;
export function normalizeTileLoadingProfile(value: unknown): TileLoadingProfile {
  return value === "economy" ? "economy" : "balanced";
}
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024, MAX_TILE_BYTES = 16 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;
const cities = new Set(["bristol", "london", "birmingham"]);
const kinds = new Set(["tower", "villa", "georgian", "victorian", "wills", "cabot", "cathedral", "tudor", "warehouse", "chapel", "civic", "footprint", "urban"]);
const categories = new Set(["building", "unit", "floor", "dwelling", "room", "column", "ornament", "slab", "wall", "window", "door", "balcony", "railing", "roof", "stair"]);
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function tuple(value: unknown, size: number): value is number[] {
  return Array.isArray(value) && value.length === size && value.every(Number.isFinite);
}
function natural(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);
}
function geographic(value: unknown): value is GeographicBounds {
  return tuple(value, 4) && value[0] >= -180 && value[2] <= 180 && value[0] <= value[2] &&
    value[1] >= -90 && value[3] <= 90 && value[1] <= value[3];
}
function bounds3(value: unknown): value is Bounds3 {
  return tuple(value, 6) && value.slice(0, 3).every((v, i) => v <= value[i + 3]);
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
}
function aborted(signal: AbortSignal) { if (signal.aborted) throw new DOMException("已取消读取", "AbortError"); }
/** Read incrementally, never arrayBuffer() an unbounded HTTP response. */
export async function readBoundedBytes(response: Response, maxBytes: number, signal: AbortSignal, expectedBytes?: number): Promise<Uint8Array> {
  aborted(signal);
  const length = response.headers.get("content-length");
  const encoding = response.headers.get("content-encoding");
  // Compressed HTTP Content-Length is not the decoded stream length.
  if ((!encoding || encoding === "identity") && length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await response.body?.cancel(); throw new Error("响应字节长度不符合渲染包限制");
  }
  requireValue(response.body, "浏览器不支持有界流式读取");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  // Repeated cancel() calls can resolve before the original underlying cancel
  // finishes. Retain that first promise so the queue keeps its physical slot.
  let cancellation: Promise<void> | undefined;
  const cancel = () => cancellation ??= reader.cancel().catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      aborted(signal);
      const { value, done } = await reader.read();
      aborted(signal);
      if (done) break;
      total += value.byteLength;
      requireValue(total <= maxBytes && (expectedBytes === undefined || total <= expectedBytes), "响应超过渲染包字节限制");
      chunks.push(value);
    }
    requireValue(expectedBytes === undefined || total === expectedBytes, "渲染瓦片字节长度不匹配");
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  } catch (error) { await cancel(); throw error; }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
function decode(bytes: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
export async function validateManifest(value: unknown, cityId: string): Promise<RenderManifest> {
  requireValue(record(value) && value.format === "gugis-render-package-v1" && value.city_id === cityId && cities.has(cityId), "渲染包城市身份不匹配");
  requireValue(hashPattern.test(value.revision) && value.source_sha256 === value.revision && hashPattern.test(value.package_sha256), "渲染包修订无效");
  // package_sha256 is verified by the server. Do not reserialize Python JSON
  // floats with JavaScript: 250.0 and 1e-06 have different canonical byte forms.
  // The HTTP loader separately verifies the exact manifest bytes against ETag.
  requireValue(typeof value.name === "string" && natural(value.source_byte_length, 128 * 1024 * 1024) &&
    (value.bounds_wgs84 === null || geographic(value.bounds_wgs84)) && (value.bounds_enu === null || bounds3(value.bounds_enu)), "渲染包范围无效");
  requireValue(record(value.grid) && value.grid.coordinate_system === "ECEF_ENU" && tuple(value.grid.origin_wgs84, 3) &&
    Number.isFinite(value.grid.tile_size_m) && value.grid.tile_size_m >= 10 && value.grid.tile_size_m <= 10000, "渲染网格无效");
  requireValue(record(value.limits) && natural(value.limits.max_bytes, MAX_TILE_BYTES) && value.limits.max_bytes > 0 &&
    natural(value.limits.max_tiles, 20000) && natural(value.limits.max_buildings) && natural(value.limits.max_primitives), "渲染包上限无效");
  requireValue(record(value.counts) && ["buildings", "assets", "primitives", "tiles", "source_roads"].every(k => natural(value.counts[k])) &&
    Array.isArray(value.tiles) && value.tiles.length <= value.limits.max_tiles && value.counts.tiles === value.tiles.length, "渲染包计数无效");
  requireValue(record(value.layers) && value.layers.buildings === "included" && ["roads", "terrain", "features", "semantics"].every(k => value.layers[k] === "not-included"), "不支持此渲染包图层");
  requireValue(value.quality_warnings_source_revision === value.revision && Array.isArray(value.quality_warnings) && value.quality_warnings.every((w: unknown) =>
    record(w) && typeof w.code === "string" && typeof w.message === "string"), "质量警告未绑定到此来源修订");
  requireValue(record(value.attribution) && ["source", "license", "license_url"].every(k => typeof value.attribution[k] === "string") &&
    record(value.attribution.metadata) && Object.values(value.attribution.metadata).every(v => typeof v === "string"), "渲染包来源信息无效");
  const ids = new Set<string>();
  for (const t of value.tiles) {
    requireValue(record(t) && /^x-?\d+_y-?\d+$/.test(t.id) && !ids.has(t.id) && tuple(t.grid, 2) &&
      t.grid.every(Number.isSafeInteger) && t.id === `x${t.grid[0]}_y${t.grid[1]}` && tuple(t.cell_bounds_enu, 4) && bounds3(t.bounds_enu) && geographic(t.bounds_wgs84) &&
      natural(t.building_count, value.limits.max_buildings) && natural(t.primitive_count, value.limits.max_primitives) &&
      natural(t.byte_length, value.limits.max_bytes) && t.byte_length > 0 && hashPattern.test(t.sha256) &&
      t.url === `/cities/${cityId}/render/${value.revision}/tiles/${t.id}`, "渲染瓦片描述或 URL 无效");
    ids.add(t.id);
  }
  return value as RenderManifest;
}
export function validateTile(value: unknown, manifest: RenderManifest, descriptor: RenderTileDescriptor): RenderTile {
  requireValue(record(value) && value.format === "gugis-render-tile-v1" && value.city_id === manifest.city_id &&
    value.revision === manifest.revision && value.tile_id === descriptor.id, "渲染瓦片身份不匹配");
  requireValue(record(value.geometry_library) && record(value.assets) && Array.isArray(value.instances) && value.instances.length === descriptor.building_count, "渲染瓦片结构无效");
  for (const [id, g] of Object.entries(value.geometry_library)) {
    requireValue(identifier(id) && record(g), "共享几何无效");
    requireValue(g.kind === "box" || (g.kind === "box-set" && Array.isArray(g.bounds) && g.bounds.length > 0 && g.bounds.every(bounds3)) ||
      (g.kind === "mesh" && Array.isArray(g.vertices) && g.vertices.length > 0 && g.vertices.every((v: unknown) => tuple(v, 3)) &&
      Array.isArray(g.triangles) && g.triangles.length > 0 && g.triangles.every((v: unknown) => tuple(v, 3) && v.every(i => natural(i, g.vertices.length - 1)))), "共享几何坐标或拓扑无效");
  }
  const usedGeometry = new Set<string>();
  for (const [id, asset] of Object.entries(value.assets)) {
    requireValue(identifier(id) && record(asset) && ["overview", "full-fallback"].includes(asset.quality) && kinds.has(asset.kind) && Array.isArray(asset.primitives) && asset.primitives.length > 0, "渲染资产无效");
    const ids = new Set<string>(), bindings = new Map<string, string>();
    for (const p of asset.primitives) {
      requireValue(record(p) && identifier(p.id) && !ids.has(p.id) && identifier(p.template_id) && (p.node_id === null || identifier(p.node_id)) && categories.has(p.category) &&
        tuple(p.position, 3) && Number.isFinite(p.rotation_z) && /^#[\da-fA-F]{6}$/.test(p.color) && identifier(p.geometry) && Object.prototype.hasOwnProperty.call(value.geometry_library, p.geometry), "渲染构件无效");
      const geometry = value.geometry_library[p.geometry];
      requireValue(geometry.kind === "box" ? tuple(p.size, 3) && p.size.every((n: number) => n > 0) : p.size === undefined, "共享几何尺寸不匹配");
      const binding = canonicalJson({ geometry: p.geometry, color: p.color, ...(p.size ? { size: p.size } : {}) });
      requireValue(!bindings.has(p.template_id) || bindings.get(p.template_id) === binding, "同一模板绑定发生冲突");
      ids.add(p.id); bindings.set(p.template_id, binding); usedGeometry.add(p.geometry);
    }
  }
  const ids = new Set<string>(), usedAssets = new Set<string>();
  let count = 0;
  for (const p of value.instances) {
    requireValue(record(p) && identifier(p.id) && !ids.has(p.id) && identifier(p.asset) && Object.prototype.hasOwnProperty.call(value.assets, p.asset) &&
      typeof p.name === "string" && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180 && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 &&
      Number.isFinite(p.altitude) && Number.isFinite(p.heading), "建筑放置或身份无效");
    ids.add(p.id); usedAssets.add(p.asset); count += value.assets[p.asset].primitives.length;
  }
  requireValue(count === descriptor.primitive_count && usedAssets.size === Object.keys(value.assets).length && usedGeometry.size === Object.keys(value.geometry_library).length, "瓦片构件计数或引用不匹配");
  return value as RenderTile;
}
export class RenderPackageUnavailable extends Error {}
export async function loadRenderManifest(cityId: string, signal: AbortSignal, base = "/api", fetcher: typeof fetch = fetch) {
  requireValue(cities.has(cityId), "未知城市，不能读取其他城市作为替代");
  const response = await fetcher(`${base.replace(/\/$/, "")}/cities/${cityId}/render/manifest`, { signal, cache: "no-store" });
  if (response.status === 404) { await response.body?.cancel(); throw new RenderPackageUnavailable("此城市尚无可用的离线渲染包"); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`渲染清单读取失败（${response.status}）`); }
  const bytes = await readBoundedBytes(response, MAX_MANIFEST_BYTES, signal);
  const etag = response.headers.get("etag");
  requireValue(etag && /^"[a-f0-9]{64}"$/.test(etag) && await sha256(bytes) === etag.slice(1, -1), "渲染清单字节 SHA-256 / ETag 不匹配");
  const manifest = await validateManifest(decode(bytes), cityId);
  aborted(signal);
  return { manifest, freshness: response.headers.get("X-Render-Freshness") === "current" ? "current" as const : "unknown" as const };
}
/** Inclusive intersection, including dateline-crossing camera rectangles. */
export function intersectsBounds(tile: GeographicBounds, view: GeographicBounds | null): boolean {
  if (!view) return true;
  if (!tuple(view, 4)) return true; // Unavailable camera footprint conservatively includes all candidates.
  const longitude = view[0] <= view[2] ? tile[0] <= view[2] && tile[2] >= view[0] : tile[2] >= view[0] || tile[0] <= view[2];
  return longitude && tile[1] <= view[3] && tile[3] >= view[1];
}
export function chooseViewportTiles(manifest: RenderManifest, view: RenderView, budget: TileBudget = tileBudget, pinnedTile?: string) {
  const candidates = manifest.tiles.filter(t => t.id === pinnedTile || intersectsBounds(t.bounds_wgs84, view.bounds));
  const distance = (t: RenderTileDescriptor) => {
    const lon = (t.bounds_wgs84[0] + t.bounds_wgs84[2]) / 2, lat = (t.bounds_wgs84[1] + t.bounds_wgs84[3]) / 2;
    const dx = Math.min(Math.abs(lon - view.center.longitude), 360 - Math.abs(lon - view.center.longitude)) * Math.cos(view.center.latitude * Math.PI / 180);
    return dx * dx + (lat - view.center.latitude) ** 2;
  };
  candidates.sort((a, b) => Number(b.id === pinnedTile) - Number(a.id === pinnedTile) || distance(a) - distance(b) || a.id.localeCompare(b.id));
  const chosen: RenderTileDescriptor[] = []; let bytes = 0;
  for (const tile of candidates) if (chosen.length < budget.activeTiles && bytes + tile.byte_length <= budget.activeBytes) {
    chosen.push(tile); bytes += tile.byte_length;
  }
  return { chosen, candidates: candidates.length, omitted: candidates.length - chosen.length, bytes };
}
function mergeTiles(manifest: RenderManifest, tiles: readonly RenderTile[]) {
  const assets = new Map<string, RenderAsset>(), geometry = new Map<string, Geometry>(), instances = new Map<string, Placement>();
  const signatures = new Map<string, string>();
  function add<T>(target: Map<string, T>, prefix: string, id: string, value: T) {
    const key = `${prefix}:${id}`, signature = canonicalJson(value);
    requireValue(!signatures.has(key) || signatures.get(key) === signature, `跨瓦片 ${prefix} 身份冲突：${id}`);
    signatures.set(key, signature); target.set(id, value);
  }
  for (const tile of tiles) {
    requireValue(tile.city_id === manifest.city_id && tile.revision === manifest.revision, "跨城市或修订瓦片不能合并");
    for (const [id, value] of Object.entries(tile.geometry_library)) add(geometry, "geometry", id, value);
    for (const [id, value] of Object.entries(tile.assets)) add(assets, "asset", id, value);
    for (const value of tile.instances) add(instances, "instance", value.id, value);
  }
  return { assets, geometry, instances };
}
/** Private in-memory scene projection only. This is never an editable/importable archive. */
export interface RenderSceneProjection extends Pick<CityDocument, "name" | "assets" | "instances" | "roads"> {
  format: "gugis-render-scene"; source_revision: string;
}
export function renderTilesToCity(manifest: RenderManifest, tiles: readonly RenderTile[]): RenderSceneProjection {
  const merged = mergeTiles(manifest, tiles), solids = new Map<string, Omit<Solid, "color">>();
  const resolve = (p: RenderPrimitive): Solid => {
    const source = merged.geometry.get(p.geometry);
    requireValue(source, `缺少共享几何：${p.geometry}`);
    let solid = solids.get(p.geometry);
    if (!solid) {
      solid = source.kind === "box-set" ? { kind: "mesh",
        vertices: source.bounds.flatMap(b => topology.corners.map(c => c.map(i => b[i]) as Vec3)),
        triangles: source.bounds.flatMap((_, part) => topology.triangles.map(t => t.map(i => i + part * 8) as Vec3)) } : source;
      solids.set(p.geometry, solid);
    }
    return { ...solid, color: p.color, ...(p.size ? { size: p.size } : {}) };
  };
  const assets = Object.fromEntries([...merged.assets].map(([id, asset]) => [id, {
    format: "gugis-studio", version: "1.0", coordinate_system: "ENU_METERS_WGS84",
    parameters: { name: id, kind: asset.kind, floors: 0, units: 0, floor_height: 0, longitude: 0, latitude: 0, altitude: 0, heading: 0 },
    templates: Object.fromEntries(asset.primitives.map(p => [p.template_id, resolve(p)])),
    nodes: asset.primitives.map(p => ({ id: p.id, name: p.id, template: p.template_id, category: p.category,
      position: p.position, rotation_z: p.rotation_z })),
  } satisfies BuildingDocument]));
  return { format: "gugis-render-scene", name: manifest.name,
    assets, instances: [...merged.instances.values()], roads: [], source_revision: manifest.revision };
}
export interface TileStreamState {
  tiles: readonly RenderTile[]; wanted: number; candidates: number; omitted: number;
  loading: number; activeBytes: number; cacheTiles: number; cacheBytes: number;
  failures: ReadonlyArray<{ id: string; message: string }>;
  paused?: boolean;
}
interface CachedTile { tile: RenderTile; bytes: number; touched: number }
/** Bounded read-only queue. An epoch invalidates all obsolete responses, even transports ignoring abort. */
export class RenderTileStream {
  private manifest: RenderManifest;
  private notify: (state: TileStreamState) => void;
  private fetcher: typeof fetch;
  private base: string;
  private budget: TileBudget;
  private cache = new Map<string, CachedTile>();
  private pending = new Map<string, { controller: AbortController; epoch: number }>();
  private failures = new Map<string, string>();
  private wanted: RenderTileDescriptor[] = [];
  private candidates = 0;
  private epoch = 0;
  private clock = 0;
  private disposed = false;
  private paused = false;
  private latestView: RenderView | null = null;
  private latestSelected: string | null = null;
  private retryOnResume = false;
  private lastTiles: readonly RenderTile[] = [];
  constructor(manifest: RenderManifest, notify: (state: TileStreamState) => void, options: { fetcher?: typeof fetch; base?: string; budget?: TileBudget } = {}) {
    this.manifest = manifest; this.notify = notify; this.fetcher = options.fetcher ?? fetch;
    this.base = (options.base ?? "/api").replace(/\/$/, ""); this.budget = options.budget ?? tileBudget;
    const b = this.budget;
    requireValue(Object.values(b).every(v => Number.isSafeInteger(v) && v > 0) && b.activeTiles <= b.cacheTiles &&
      b.activeBytes <= b.cacheBytes && b.concurrency <= 3 && b.activeTiles <= tileBudget.activeTiles &&
      b.activeBytes <= tileBudget.activeBytes && b.cacheTiles <= tileBudget.cacheTiles && b.cacheBytes <= tileBudget.cacheBytes, "无效或超出硬上限的瓦片预算");
  }
  setView(view: RenderView, selected: string | null = null) {
    if (this.disposed) return;
    // Keep camera updates while paused, but leave the displayed plan and its
    // verified residency untouched until resume. Snapshot caller-owned input.
    this.latestView = { bounds: view.bounds ? [...view.bounds] : null, center: { ...view.center } };
    this.latestSelected = selected;
    if (this.paused) return;
    this.applyView(this.latestView, this.latestSelected);
  }
  /** Freeze verified tiles and stop reads without releasing unsettled transports' slots. */
  setPaused(paused: boolean) {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.epoch++;
      for (const p of this.pending.values()) p.controller.abort();
      this.emit();
    } else if (this.latestView) {
      this.applyView(this.latestView, this.latestSelected);
    } else {
      this.retryOnResume = false;
      this.emit();
    }
  }
  private applyView(view: RenderView, selected: string | null) {
    const pinned = selected ? this.wanted.find(d => this.cache.get(d.id)?.tile.instances.some(i => i.id === selected))?.id : undefined;
    const plan = chooseViewportTiles(this.manifest, view, this.budget, pinned);
    this.candidates = plan.candidates;
    if (plan.chosen.map(t => t.id).join("|") !== this.wanted.map(t => t.id).join("|")) {
      this.epoch++;
      for (const p of this.pending.values()) p.controller.abort();
      this.wanted = plan.chosen;
    }
    if (this.retryOnResume) {
      for (const t of this.wanted) this.failures.delete(t.id);
      this.retryOnResume = false;
    }
    for (const t of this.wanted) { const cached = this.cache.get(t.id); if (cached) cached.touched = ++this.clock; }
    this.pump(); this.emit();
  }
  retry() {
    if (this.disposed) return;
    for (const t of this.wanted) this.failures.delete(t.id);
    // An explicit retry while frozen also applies to the latest desired plan
    // when resumed, including camera changes made after clicking retry.
    if (this.paused) this.retryOnResume = true;
    this.pump(); this.emit();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.epoch++;
    for (const p of this.pending.values()) p.controller.abort();
    this.cache.clear(); this.failures.clear(); this.wanted = []; this.lastTiles = [];
    this.latestView = null; this.latestSelected = null; this.retryOnResume = false;
  }
  private emit() {
    if (this.disposed) return;
    const tiles = this.wanted.flatMap(t => this.cache.has(t.id) ? [this.cache.get(t.id)!.tile] : []);
    if (tiles.length !== this.lastTiles.length || tiles.some((t, i) => t !== this.lastTiles[i])) this.lastTiles = tiles;
    this.notify({ tiles: this.lastTiles, paused: this.paused, wanted: this.wanted.length, candidates: this.candidates,
      omitted: this.candidates - this.wanted.length,
      loading: this.paused ? 0 : this.wanted.filter(t => !this.cache.has(t.id) && !this.failures.has(t.id)).length,
      activeBytes: this.wanted.reduce((sum, t) => sum + (this.cache.has(t.id) ? t.byte_length : 0), 0),
      cacheTiles: this.cache.size, cacheBytes: [...this.cache.values()].reduce((sum, t) => sum + t.bytes, 0),
      failures: this.wanted.filter(t => this.failures.has(t.id)).map(t => ({ id: t.id, message: this.failures.get(t.id)! })) });
  }
  private pump() {
    if (this.disposed || this.paused) return;
    for (const descriptor of this.wanted) {
      if (this.pending.size >= this.budget.concurrency) break;
      if (this.cache.has(descriptor.id) || this.pending.has(descriptor.id) || this.failures.has(descriptor.id)) continue;
      const controller = new AbortController(), epoch = this.epoch;
      this.pending.set(descriptor.id, { controller, epoch });
      void this.load(descriptor, controller, epoch);
    }
  }
  private async load(descriptor: RenderTileDescriptor, controller: AbortController, epoch: number) {
    const signal = controller.signal;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    const clearDeadline = () => clearTimeout(timeout);
    signal.addEventListener("abort", clearDeadline, { once: true });
    try {
      const response = await this.fetcher(`${this.base}${descriptor.url}`, { signal, cache: "force-cache" });
      // Some transports ignore AbortSignal. Cancel their late response bodies
      // before releasing the physical request slot, without reading or caching.
      if (signal.aborted || this.disposed || epoch !== this.epoch) {
        await response.body?.cancel();
        if (timedOut) throw new Error("瓦片读取超时，点击重试");
        return;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`瓦片读取失败（${response.status}）`); }
      const bytes = await readBoundedBytes(response, Math.min(MAX_TILE_BYTES, this.budget.activeBytes), signal, descriptor.byte_length);
      requireValue(await sha256(bytes) === descriptor.sha256, "渲染瓦片 SHA-256 不匹配");
      aborted(signal);
      const tile = validateTile(decode(bytes), this.manifest, descriptor);
      if (this.disposed || this.paused || epoch !== this.epoch) return;
      mergeTiles(this.manifest, [...this.cache.values()].map(c => c.tile).concat(tile));
      const desired = new Set(this.wanted.map(t => t.id));
      let total = [...this.cache.values()].reduce((sum, t) => sum + t.bytes, 0);
      for (const [id, entry] of [...this.cache].filter(([id]) => !desired.has(id)).sort((a, b) => a[1].touched - b[1].touched)) {
        if (this.cache.size < this.budget.cacheTiles && total + descriptor.byte_length <= this.budget.cacheBytes) break;
        this.cache.delete(id); total -= entry.bytes;
      }
      requireValue(this.cache.size < this.budget.cacheTiles && total + descriptor.byte_length <= this.budget.cacheBytes, "瓦片缓存硬上限已达到");
      this.cache.set(descriptor.id, { tile, bytes: descriptor.byte_length, touched: ++this.clock });
    } catch (error) {
      if (!this.disposed && !this.paused && epoch === this.epoch && (timedOut || !signal.aborted)) this.failures.set(descriptor.id,
        timedOut ? "瓦片读取超时，点击重试" : error instanceof Error ? error.message : "瓦片读取失败");
    } finally {
      clearTimeout(timeout); signal.removeEventListener("abort", clearDeadline);
      if (this.pending.get(descriptor.id)?.controller === controller) this.pending.delete(descriptor.id);
      this.pump();
      if (!this.paused) this.emit();
    }
  }
}
