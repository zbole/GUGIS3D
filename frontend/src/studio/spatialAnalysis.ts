import { Cartesian3, Matrix4, Transforms } from "@cesium/engine";
import type { CityDocument, Placement } from "./cityModel";
import type { BuildingDocument, Solid } from "./model";
import type { AnalysisPoint, PathAnalysis } from "./terrainAnalysis";
import { functionSolid, type FeatureAsset, type FeaturePlacement, type Terrain } from "./environment";
import { terrainIndex, type TerrainHit } from "./terrainMath";

export type ObjectLayer = "building" | "surface" | "underground";
export interface SpatialObject {
  id: string;
  name: string;
  asset: string;
  layer: ObjectLayer;
  kind: string;
  components: number;
  radius: number;
  /** Horizontal distance to the object origin or its centre line, in metres. */
  distance: number;
  /** Elevations in the terrain's source vertical datum; null when absent. */
  bottom: number | null;
  top: number | null;
  /** Nonnegative clearance from the model top to terrain at its placement origin.
   * Does not prove the complete footprint is buried on sloped or missing terrain. */
  burialDepth: number | null;
  /** A vertical model envelope, not a surveyed floor/roof measurement. */
  basis: "model-envelope";
}
export interface PointQuery {
  position: AnalysisPoint;
  terrain: TerrainHit | null;
  buildings: SpatialObject[];
  features: SpatialObject[];
  nearestRoad: { id: string; name: string; distance: number } | null;
  inspected: { layer: ObjectLayer; id: string; component?: string } | null;
  radius: number;
}
export interface SectionObject extends SpatialObject {
  station: number;
  offset: number;
}
export interface SectionResult {
  width: number;
  length: number;
  objects: SectionObject[];
  buildings: number;
  surface: number;
  underground: number;
  clearances: EnvelopeClearance[];
  verticalDatum: string | null;
  sourceName: string | null;
}
export interface EnvelopeClearance {
  undergroundId: string;
  otherId: string;
  otherName: string;
  otherLayer: ObjectLayer;
  horizontalDistance: number;
  verticalGap: number;
  verticalOverlap: number;
  basis: "model-envelope";
}

type XY = { x: number; y: number };
type Envelope = { radius: number; minZ: number; maxZ: number; components: number };
const buildingCache = new WeakMap<BuildingDocument, Envelope>();
const featureCache = new WeakMap<FeatureAsset, Envelope>();
const terrainCache = new WeakMap<Terrain, ReturnType<typeof terrainIndex>>();
function index(terrain: Terrain) {
  let value = terrainCache.get(terrain);
  if (!value) { value = terrainIndex(terrain); terrainCache.set(terrain, value); }
  return value;
}
function frameAt(longitude: number, latitude: number) {
  const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(longitude, latitude));
  return Matrix4.inverse(frame, new Matrix4());
}
function toXY(inverse: Matrix4, longitude: number, latitude: number): XY {
  const cartesian = Matrix4.multiplyByPoint(inverse, Cartesian3.fromDegrees(longitude, latitude), new Cartesian3());
  return { x: cartesian.x, y: cartesian.y };
}
function terrainAt(terrain: Terrain | null | undefined, longitude: number, latitude: number) {
  if (!terrain) return null;
  const p = toXY(frameAt(terrain.longitude, terrain.latitude), longitude, latitude);
  return index(terrain).query(p.x, p.y);
}
function vertexBounds(solid: Solid) {
  if (solid.kind === "box") {
    const [width, depth, height] = solid.size!;
    return { radius: Math.hypot(width, depth) / 2, minZ: -height / 2, maxZ: height / 2 };
  }
  const vertices = solid.vertices ?? [];
  if (!vertices.length) return { radius: 0, minZ: 0, maxZ: 0 };
  let radius = 0, minZ = Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    radius = Math.max(radius, Math.hypot(v[0], v[1]));
    minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
  }
  return { radius, minZ, maxZ };
}
function buildingEnvelope(document: BuildingDocument): Envelope {
  let value = buildingCache.get(document);
  if (value) return value;
  let radius = 0, minZ = Infinity, maxZ = -Infinity, components = 0;
  // Many nodes instance the same template. Derive each shape's bounds once
  // while building the cached model envelope.
  const templateBounds = new Map<string, ReturnType<typeof vertexBounds>>();
  for (const node of document.nodes) {
    if (!node.template || !node.position) continue;
    const solid = document.templates[node.template];
    if (!solid) continue;
    let bounds = templateBounds.get(node.template);
    if (!bounds) { bounds = vertexBounds(solid); templateBounds.set(node.template, bounds); }
    radius = Math.max(radius, Math.hypot(node.position[0], node.position[1]) + bounds.radius);
    minZ = Math.min(minZ, node.position[2] + bounds.minZ);
    maxZ = Math.max(maxZ, node.position[2] + bounds.maxZ);
    components++;
  }
  value = { radius: Math.max(radius, 1), minZ: Number.isFinite(minZ) ? minZ : 0,
    maxZ: Number.isFinite(maxZ) ? maxZ : 0, components };
  buildingCache.set(document, value);
  return value;
}
function primitiveBounds(component: FeatureAsset["components"][number]) {
  // Derive bounds from the same tessellation rendered by CityScene. This is
  // important for arch-prism, whose sweep axis rotates into the local YZ plane.
  return vertexBounds(functionSolid(component, 24));
}
function featureEnvelope(asset: FeatureAsset): Envelope {
  let value = featureCache.get(asset);
  if (value) return value;
  let radius = 0, minZ = Infinity, maxZ = -Infinity;
  for (const component of asset.components) {
    const bounds = primitiveBounds(component);
    radius = Math.max(radius, Math.hypot(component.position[0], component.position[1]) + bounds.radius);
    minZ = Math.min(minZ, component.position[2] + bounds.minZ);
    maxZ = Math.max(maxZ, component.position[2] + bounds.maxZ);
  }
  value = { radius: Math.max(radius, 0.5), minZ: Number.isFinite(minZ) ? minZ : 0,
    maxZ: Number.isFinite(maxZ) ? maxZ : 0, components: asset.components.length };
  featureCache.set(asset, value);
  return value;
}
function buildingObject(city: CityDocument, placement: Placement, distance: number): SpatialObject {
  const document = city.assets[placement.asset], bounds = buildingEnvelope(document);
  const terrain = city.environment?.terrain, ground = terrainAt(terrain, placement.longitude, placement.latitude);
  const datum = terrain && ground ? ground.height : null;
  const base = datum === null ? null : placement.altitude + bounds.minZ +
    (city.environment?.drape_buildings ? datum : terrain!.reference_height);
  const top = datum === null ? null : placement.altitude + bounds.maxZ +
    (city.environment?.drape_buildings ? datum : terrain!.reference_height);
  return { id: placement.id, name: placement.name, asset: placement.asset,
    layer: "building", kind: document.parameters.kind, components: bounds.components, radius: bounds.radius,
    distance, bottom: base, top, burialDepth: top === null ? null : Math.max(0, datum! - top), basis: "model-envelope" };
}
function featureObject(city: CityDocument, placement: FeaturePlacement, distance: number): SpatialObject {
  const asset = city.environment!.feature_assets[placement.asset], bounds = featureEnvelope(asset);
  const terrain = city.environment?.terrain, ground = terrainAt(terrain, placement.longitude, placement.latitude);
  const bottom = ground ? ground.height + placement.altitude + bounds.minZ * placement.scale : null;
  const top = ground ? ground.height + placement.altitude + bounds.maxZ * placement.scale : null;
  return { id: placement.id, name: placement.name, asset: placement.asset, layer: placement.layer,
    kind: asset.kind, components: bounds.components, radius: bounds.radius * placement.scale, distance, bottom, top,
    burialDepth: top === null ? null : Math.max(0, ground!.height - top), basis: "model-envelope" };
}
function nearestOnSegment(p: XY, a: XY, b: XY) {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return { distance: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), fraction: t,
    length: Math.sqrt(length2) };
}
function nearestQueryObjects(objects: SpatialObject[], inspected: PointQuery["inspected"]): SpatialObject[] {
  objects.sort((a, b) => a.distance - b.distance);
  const nearest = objects.slice(0, 12);
  const picked = inspected && objects.find(object => object.id === inspected.id && object.layer === inspected.layer);
  // Keep the picked model's semantics available even when its origin is farther
  // away than twelve neighbours (or lies outside the ordinary query radius).
  if (picked && !nearest.includes(picked)) nearest[nearest.length - 1] = picked;
  return nearest;
}
export function queryCityPoint(city: CityDocument, position: AnalysisPoint, radius = 100,
  inspected: PointQuery["inspected"] = null): PointQuery {
  if (!(Number.isFinite(radius) && radius > 0 && radius <= 2000)) throw new RangeError("查询半径须在 0–2000 米之间。");
  const inverse = frameAt(position.longitude, position.latitude);
  const at = (lon: number, lat: number) => toXY(inverse, lon, lat);
  const distance = (lon: number, lat: number) => { const p = at(lon, lat); return Math.hypot(p.x, p.y); };
  const terrain = city.environment?.terrain;
  const buildings = nearestQueryObjects(city.instances.flatMap(item => {
    const d = distance(item.longitude, item.latitude);
    return d <= radius ||
      (inspected?.layer === "building" && inspected.id === item.id) ? [buildingObject(city, item, d)] : [];
  }), inspected);
  const features = nearestQueryObjects((city.environment?.features ?? []).flatMap(item => {
    const d = distance(item.longitude, item.latitude);
    return d <= radius ||
      (inspected?.layer === item.layer && inspected.id === item.id) ? [featureObject(city, item, d)] : [];
  }), inspected);
  let nearestRoad: PointQuery["nearestRoad"] = null;
  for (const road of city.roads) for (let i = 1; i < road.coordinates.length; i++) {
    const a = at(...road.coordinates[i - 1]), b = at(...road.coordinates[i]);
    const hit = nearestOnSegment({ x: 0, y: 0 }, a, b);
    if ((!nearestRoad || hit.distance < nearestRoad.distance) && hit.distance <= radius + road.width / 2)
      nearestRoad = { id: road.id, name: road.name, distance: hit.distance };
  }
  return { position: { ...position }, terrain: terrainAt(terrain, position.longitude, position.latitude),
    buildings, features, nearestRoad, inspected, radius };
}

/** A vertical corridor: report model envelopes crossing the route within half-width. */
export function analyzeCitySection(city: CityDocument, points: AnalysisPoint[], profile: PathAnalysis,
  width = 30): SectionResult {
  if (!(Number.isFinite(width) && width >= 2 && width <= 200)) throw new RangeError("剖面带宽须在 2–200 米之间。");
  if (points.length < 2 || points.length > 64) throw new RangeError("剖面路线须包含 2–64 个选点。");
  const terrain = city.environment?.terrain;
  const anchor = terrain ?? points[0], inverse = frameAt(anchor.longitude, anchor.latitude);
  const xy = points.map(p => toXY(inverse, p.longitude, p.latitude));
  const lengths = xy.slice(1).map((p, i) => Math.hypot(p.x - xy[i].x, p.y - xy[i].y));
  const starts = [0]; lengths.forEach(value => starts.push(starts[starts.length - 1] + value));
  const nearest = (longitude: number, latitude: number) => {
    const p = toXY(inverse, longitude, latitude);
    let best = { station: 0, offset: Infinity };
    for (let i = 1; i < xy.length; i++) {
      const hit = nearestOnSegment(p, xy[i - 1], xy[i]);
      if (hit.distance < best.offset) best = { station: starts[i - 1] + hit.fraction * lengths[i - 1], offset: hit.distance };
    }
    return best;
  };
  const objects: SectionObject[] = [];
  for (const item of city.instances) {
    const spot = nearest(item.longitude, item.latitude);
    // Display overviews are not guaranteed to enclose all stored components.
    // Only the cached component envelope can safely reject section candidates.
    if (spot.offset > width / 2 + buildingEnvelope(city.assets[item.asset]).radius) continue;
    objects.push({ ...buildingObject(city, item, spot.offset), ...spot });
  }
  for (const item of city.environment?.features ?? []) {
    const spot = nearest(item.longitude, item.latitude);
    if (spot.offset > width / 2 + featureEnvelope(city.environment!.feature_assets[item.asset]).radius * item.scale) continue;
    objects.push({ ...featureObject(city, item, spot.offset), ...spot });
  }
  objects.sort((a, b) => a.station - b.station || a.offset - b.offset || a.id.localeCompare(b.id));
  const coordinates = new Map<string, XY>();
  for (const placement of city.instances)
    coordinates.set(`building:${placement.id}`, toXY(inverse, placement.longitude, placement.latitude));
  for (const placement of city.environment?.features ?? [])
    coordinates.set(`${placement.layer}:${placement.id}`, toXY(inverse, placement.longitude, placement.latitude));
  const clearances: EnvelopeClearance[] = [];
  for (const underground of objects.filter(o => o.layer === "underground" && o.bottom !== null && o.top !== null)) {
    const a = coordinates.get(`underground:${underground.id}`)!;
    for (const other of objects) {
      if ((other.id === underground.id && other.layer === "underground") || other.bottom === null || other.top === null) continue;
      if (other.layer === "underground" && other.id < underground.id) continue;
      const b = coordinates.get(`${other.layer}:${other.id}`)!;
      const horizontalDistance = Math.hypot(a.x - b.x, a.y - b.y);
      if (horizontalDistance > underground.radius + other.radius) continue;
      clearances.push({ undergroundId: underground.id, otherId: other.id,
        otherName: other.name, otherLayer: other.layer, horizontalDistance,
        verticalGap: Math.max(0, other.bottom - underground.top!, underground.bottom! - other.top),
        verticalOverlap: Math.max(0, Math.min(underground.top!, other.top) - Math.max(underground.bottom!, other.bottom)),
        basis: "model-envelope" });
    }
  }
  clearances.sort((a, b) => a.verticalGap - b.verticalGap || a.horizontalDistance - b.horizontalDistance);
  return { width, length: profile.horizontalDistance, objects,
    buildings: objects.filter(o => o.layer === "building").length,
    surface: objects.filter(o => o.layer === "surface").length,
    underground: objects.filter(o => o.layer === "underground").length, clearances,
    verticalDatum: terrain?.vertical_datum ?? null, sourceName: terrain?.name ?? null };
}
