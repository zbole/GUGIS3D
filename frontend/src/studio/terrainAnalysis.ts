// Import the ESM math implementation directly: the viewer's Vite plugin maps
// "cesium" to a window global, which does not exist inside analysis workers.
import { Cartesian3, Cartographic, Matrix4, Transforms, Math as CesiumMath } from "@cesium/engine";
import type { Terrain } from "./environment";
import { terrainIndex } from "./terrainMath";

export interface AnalysisPoint {
  longitude: number;
  latitude: number;
  /** Displayed scene elevation in metres, independent of the source datum. */
  altitude: number;
}
export interface ProfileSample {
  distance: number;
  /** Source elevation, without subtracting terrain.reference_height. */
  height: number | null;
  /** Analytic terrain slope in degrees, not the slope along the route. */
  slope: number | null;
  patch: string | null;
  kind: string | null;
  /** A native NoData interval occurs after the previous station. */
  gapBefore?: boolean;
}
export interface PathAnalysis {
  horizontalDistance: number;
  spatialDistance: number;
  elevationChange: number;
  surfaceDistance: number | null;
  ascent: number | null;
  descent: number | null;
  /** Fraction of horizontal route length covered by native terrain (0–1). */
  coverage: number;
  samples: ProfileSample[];
  /** Regular station spacing; route corners are inserted between stations. */
  sampleSpacing: number;
  terrainName: string | null;
  verticalDatum: string | null;
}
type XY = { x: number; y: number };
type Segment = { a: Cartesian3; b: Cartesian3; start: number; length: number; pointIndex: number };
const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x;
const difference = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const interpolate = (a: XY, b: XY, t: number): XY => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
function validatePoints(points: AnalysisPoint[]) {
  if (points.length > 64) throw new RangeError("分析路线最多允许 64 个节点。");
  for (const point of points)
    if (![point.longitude, point.latitude, point.altitude].every(Number.isFinite)
      || Math.abs(point.longitude) > 180 || Math.abs(point.latitude) > 90)
      throw new RangeError("分析点必须使用有效的 WGS84 经纬度和有限高程。");
}
function projectPath(points: AnalysisPoint[], terrain?: Terrain | null) {
  const anchor = terrain ?? points[0];
  const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(anchor.longitude, anchor.latitude));
  const inverse = Matrix4.inverse(frame, new Matrix4());
  // The same XY convention as terrainSampler.at: elevation is not allowed to
  // shift a sample horizontally, and Earth curvature is not treated as climb.
  const local = points.map(point => Matrix4.multiplyByPoint(inverse,
    Cartesian3.fromDegrees(point.longitude, point.latitude), new Cartesian3()));
  const segments: Segment[] = [];
  let horizontalDistance = 0, spatialDistance = 0;
  for (let i = 1; i < points.length; i++) {
    const a = local[i - 1], b = local[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    spatialDistance += Math.hypot(length, points[i].altitude - points[i - 1].altitude);
    if (length > 0) segments.push({ a, b, start: horizontalDistance, length, pointIndex: i });
    horizontalDistance += length;
  }
  return { frame, local, segments, horizontalDistance, spatialDistance };
}

/** Reuse the projected route for chart hover and scene profile vertices. */
export function createPathLocator(points: AnalysisPoint[], terrain?: Terrain | null) {
  validatePoints(points);
  if (!points.length) return (_distance: number): AnalysisPoint | null => null;
  const route = projectPath(points, terrain);
  return (distance: number): AnalysisPoint | null => {
    if (!Number.isFinite(distance)) return null;
    if (distance <= 0 || points.length === 1) return { ...points[0] };
    if (distance >= route.horizontalDistance) return { ...points[points.length - 1] };
    let lo = 0, hi = route.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1, segment = route.segments[mid];
      if (distance > segment.start + segment.length) lo = mid + 1;
      else hi = mid;
    }
    const segment = route.segments[lo], t = (distance - segment.start) / segment.length;
    const local = Cartesian3.lerp(segment.a, segment.b, t, new Cartesian3());
    const geo = Cartographic.fromCartesian(Matrix4.multiplyByPoint(route.frame, local, new Cartesian3()));
    const a = points[segment.pointIndex - 1], b = points[segment.pointIndex];
    return { longitude: CesiumMath.toDegrees(geo.longitude), latitude: CesiumMath.toDegrees(geo.latitude),
      altitude: a.altitude + (b.altitude - a.altitude) * t };
  };
}
/** Position on the same ENU polyline used by analyzePath, clamped to its ends. */
export function pathPointAtDistance(
  points: AnalysisPoint[], terrain: Terrain | null | undefined, distance: number,
): AnalysisPoint | null {
  return createPathLocator(points, terrain)(distance);
}

function buildNativeIndex(terrain: Terrain) {
  const index = terrainIndex(terrain);
  const polygons = index.cells.map(cell => {
    const order = cell.quad ? [0, 1, 3, 2] : [0, 1, 2];
    const polygon = order.map(i => ({ x: cell.points[i][0], y: cell.points[i][1] }));
    return { polygon, minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
      minY: Math.min(...polygon.map(p => p.y)), maxY: Math.max(...polygon.map(p => p.y)) };
  });
  return { index, polygons };
}
// Terrain snapshots are immutable. Repeated route edits reuse the native
// topology index; replacing a terrain snapshot naturally creates a new entry.
const nativeCache = new WeakMap<Terrain, ReturnType<typeof buildNativeIndex>>();
function nativeIndex(terrain: Terrain) {
  let cached = nativeCache.get(terrain);
  if (!cached) { cached = buildNativeIndex(terrain); nativeCache.set(terrain, cached); }
  return cached;
}

/**
 * Analyse a local city polyline against the original GUGIS surfaces. Render
 * meshes and GPU depth buffers are deliberately not used. Surface length and
 * ascent/descent are sampled estimates; native cell boundaries and route
 * corners remain in the output so hill peaks at a turn cannot disappear.
 * Cell boundaries are checked internally so NoData is never joined over.
 */
export function analyzePath(
  points: AnalysisPoint[],
  terrain?: Terrain | null,
  spacing = 5,
): PathAnalysis {
  if (!Number.isFinite(spacing) || spacing <= 0)
    throw new RangeError("剖面采样间距必须是大于零的有限数值。");
  validatePoints(points);
  const result: PathAnalysis = {
    horizontalDistance: 0, spatialDistance: 0,
    elevationChange: points.length ? points[points.length - 1].altitude - points[0].altitude : 0,
    surfaceDistance: null, ascent: null, descent: null, coverage: 0,
    samples: [], sampleSpacing: 0,
    terrainName: terrain?.name ?? null, verticalDatum: terrain?.vertical_datum ?? null,
  };
  if (!points.length) return result;

  const { local, segments, horizontalDistance, spatialDistance } = projectPath(points, terrain);
  result.horizontalDistance = horizontalDistance;
  result.spatialDistance = spatialDistance;
  const native = terrain ? nativeIndex(terrain) : null;
  const index = native?.index;
  const corners = segments.slice(1).map(segment => segment.start);
  const intervals = result.horizontalDistance > 0
    ? Math.max(1, Math.min(500 - corners.length, Math.ceil(result.horizontalDistance / spacing))) : 0;
  result.sampleSpacing = intervals ? result.horizontalDistance / intervals : 0;
  const distances = Array.from({ length: intervals + 1 }, (_, i) =>
    i === intervals ? result.horizontalDistance : i * result.sampleSpacing);
  distances.push(...corners);
  distances.sort((a, b) => a - b);
  const outputDistances = distances.filter((d, i) => i === 0 || d - distances[i - 1] > 1e-9);
  let segmentIndex = 0;
  for (const distance of outputDistances) {
    while (segmentIndex + 1 < segments.length
      && distance > segments[segmentIndex].start + segments[segmentIndex].length)
      segmentIndex++;
    const segment = segments[segmentIndex];
    const position = segment
      ? interpolate(segment.a, segment.b, Math.min(1, (distance - segment.start) / segment.length))
      : local[0];
    const hit = index?.query(position.x, position.y);
    result.samples.push({ distance, height: hit?.height ?? null, slope: hit?.slope ?? null,
      patch: hit?.patch ?? null, kind: hit?.kind ?? null });
  }
  if (!index) return result;
  if (!segments.length) {
    result.coverage = result.samples[0].height === null ? 0 : 1;
    return result;
  }

  // Intersect the route with native cell boundaries. Checking samples alone
  // would miss holes narrower than sampleSpacing, producing a false bridge.
  const polygons = native!.polygons;
  let covered = 0, complete = result.samples.every(sample => sample.height !== null);
  let surfaceDistance = 0, ascent = 0, descent = 0;
  for (const segment of segments) {
    const { a, b, start, length } = segment;
    const direction = difference(b, a), cuts = [0, 1];
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    for (const cell of polygons) {
      if (cell.maxX < minX || cell.minX > maxX || cell.maxY < minY || cell.minY > maxY) continue;
      for (let i = 0; i < cell.polygon.length; i++) {
        const c = cell.polygon[i], d = cell.polygon[(i + 1) % cell.polygon.length];
        const edge = difference(d, c), offset = difference(c, a);
        const denominator = cross(direction, edge);
        if (Math.abs(denominator) < 1e-12) continue;
        const t = cross(offset, edge) / denominator, u = cross(offset, direction) / denominator;
        if (t > 0 && t < 1 && u >= -1e-10 && u <= 1 + 1e-10) cuts.push(t);
      }
    }
    for (const sample of result.samples)
      if (sample.distance > start && sample.distance < start + length)
        cuts.push((sample.distance - start) / length);
    cuts.sort((x, y) => x - y);
    const stations = cuts.filter((t, i) => i === 0 || t - cuts[i - 1] > 1e-12);
    let previousHeight = index.query(a.x, a.y)?.height ?? null;
    for (let i = 1; i < stations.length; i++) {
      const t0 = stations[i - 1], t1 = stations[i];
      const middle = interpolate(a, b, (t0 + t1) / 2), end = interpolate(a, b, t1);
      const hit = index.query(middle.x, middle.y);
      const height = index.query(end.x, end.y)?.height ?? null;
      const distance = (t1 - t0) * length;
      if (hit) covered += distance;
      else {
        complete = false;
        const gapStart = start + t0 * length, gapEnd = start + t1 * length;
        // Preserve the station budget while explicitly breaking the
        // chart and scene line when an entire hole falls between stations.
        let lo = 1, hi = result.samples.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (result.samples[mid].distance <= gapStart) lo = mid + 1;
          else hi = mid;
        }
        for (let j = lo; j < result.samples.length && result.samples[j - 1].distance < gapEnd; j++)
          result.samples[j].gapBefore = true;
      }
      if (previousHeight === null || height === null) complete = false;
      else if (hit) {
        const change = height - previousHeight;
        surfaceDistance += Math.hypot(distance, change);
        ascent += Math.max(0, change);
        descent += Math.max(0, -change);
      }
      previousHeight = height;
    }
  }
  result.coverage = complete ? 1 : Math.max(0, Math.min(1, covered / result.horizontalDistance));
  if (complete && result.samples.length >= 2) {
    result.surfaceDistance = surfaceDistance;
    result.ascent = ascent;
    result.descent = descent;
  }
  return result;
}
