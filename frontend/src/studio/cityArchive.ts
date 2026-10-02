import topology from "../../../shared/box-topology.json" with { type: "json" };
import type { CityDocument } from "./cityModel";
import type { BuildingDocument, Solid, Vec3 } from "./model";

type Bounds = [number, number, number, number, number, number];
type Geometry =
  | { kind: "box" }
  | { kind: "box-set"; bounds: Bounds[] }
  | { kind: "mesh"; vertices: Vec3[]; triangles: Vec3[] };
interface Binding {
  geometry: string;
  color: string;
  size?: Vec3;
}
interface PooledBuilding
  extends Omit<BuildingDocument, "templates" | "overview"> {
  templates: Record<string, Binding>;
  overview?: Record<string, Binding>;
}
export interface CityArchive extends Omit<CityDocument, "version" | "assets"> {
  version: "1.1" | "1.2";
  assets: Record<string, PooledBuilding>;
  geometry_library: Record<string, Geometry>;
}
export interface StorageStatistics {
  building_models: number;
  building_instances: number;
  component_instances: number;
  local_bindings: number;
  shared_geometries: number;
  library_records: number;
  reused_geometries: number;
  box_instances: number;
  box_set_records: number;
  mesh_records: number;
  archive_bytes: number;
  legacy_bytes: number;
  saved_bytes: number;
}

function boxSetMesh(bounds: Bounds[]): { vertices: Vec3[]; triangles: Vec3[] } {
  return {
    vertices: bounds.flatMap((bound) =>
      topology.corners.map((corner) => corner.map((i) => bound[i]) as Vec3),
    ),
    triangles: bounds.flatMap((_, part) =>
      topology.triangles.map((face) => face.map((i) => i + part * 8) as Vec3),
    ),
  };
}

function identifyBoxes(solid: Solid): Bounds[] | null {
  const vertices = solid.vertices!,
    triangles = solid.triangles!;
  if (vertices.length % 8) return null;
  const bounds: Bounds[] = [];
  for (let start = 0; start < vertices.length; start += 8) {
    const block = vertices.slice(start, start + 8);
    const bound = [0, 1, 2]
      .map((k) => Math.min(...block.map((v) => v[k])))
      .concat(
        [0, 1, 2].map((k) => Math.max(...block.map((v) => v[k]))),
      ) as Bounds;
    if (
      !topology.corners.every((corner, i) =>
        corner.every((index, axis) => bound[index] === block[i][axis]),
      )
    )
      return null;
    bounds.push(bound);
  }
  if (triangles.length !== bounds.length * topology.triangles.length)
    return null;
  const match = triangles.every((face, i) =>
    face.every(
      (index, k) =>
        index ===
        topology.triangles[i % topology.triangles.length][k] +
          Math.floor(i / topology.triangles.length) * 8,
    ),
  );
  return match ? bounds : null;
}

export function encodeCity(city: CityDocument): CityArchive {
  const geometry_library: Record<string, Geometry> = {},
    signatures = new Map<string, string>();
  function bind(solid: Solid): Binding {
    const bounds = solid.kind === "mesh" ? identifyBoxes(solid) : null;
    const geometry: Geometry =
      solid.kind === "box"
        ? { kind: "box" }
        : bounds
          ? { kind: "box-set", bounds }
          : {
              kind: "mesh",
              vertices: solid.vertices!,
              triangles: solid.triangles!,
            };
    const signature = JSON.stringify(geometry);
    let id = signatures.get(signature);
    if (!id) {
      id = `g${signatures.size}`;
      signatures.set(signature, id);
      geometry_library[id] = geometry;
    }
    return {
      geometry: id,
      color: solid.color,
      ...(solid.kind === "box" ? { size: solid.size } : {}),
    };
  }
  const assets = Object.fromEntries(
    Object.entries(city.assets).map(([id, doc]) => [
      id,
      {
        ...doc,
        templates: Object.fromEntries(
          Object.entries(doc.templates).map(([key, solid]) => [
            key,
            bind(solid),
          ]),
        ),
        ...(doc.overview
          ? {
              overview: Object.fromEntries(
                Object.entries(doc.overview).map(([key, solid]) => [
                  key,
                  bind(solid),
                ]),
              ),
            }
          : {}),
      },
    ]),
  ) as Record<string, PooledBuilding>;
  return {
    ...city,
    version: city.environment ? "1.2" : "1.1",
    geometry_library,
    assets,
  };
}

export function decodeCity(value: CityArchive | CityDocument): CityDocument {
  if (value.version === "1.0") return value;
  if (!["1.1", "1.2"].includes(value.version) || !value.geometry_library)
    throw new Error("无法读取此城市格式版本");
  const archive = value;
  const geometryCache = new Map<string, Omit<Solid, "color">>();
  function resolve(binding: Binding): Solid {
    if (
      !Object.prototype.hasOwnProperty.call(
        archive.geometry_library,
        binding.geometry,
      )
    )
      throw new Error(`缺少共享几何：${binding.geometry}`);
    const source = archive.geometry_library[binding.geometry];
    let geometry = geometryCache.get(binding.geometry);
    if (!geometry) {
      geometry =
        source.kind === "box-set"
          ? { kind: "mesh", ...boxSetMesh(source.bounds) }
          : source.kind === "mesh"
            ? source
            : { kind: "box" };
      geometryCache.set(binding.geometry, geometry);
    }
    if ((source.kind === "box") !== (binding.size !== undefined))
      throw new Error("共享几何尺寸参数不匹配");
    return {
      ...geometry,
      color: binding.color,
      ...(binding.size ? { size: binding.size } : {}),
    };
  }
  const { geometry_library: _, ...rest } = value;
  const assets = Object.fromEntries(
    Object.entries(value.assets).map(([id, doc]) => [
      id,
      {
        ...doc,
        templates: Object.fromEntries(
          Object.entries(doc.templates).map(([key, binding]) => [
            key,
            resolve(binding),
          ]),
        ),
        ...(doc.overview
          ? {
              overview: Object.fromEntries(
                Object.entries(doc.overview).map(([key, binding]) => [
                  key,
                  resolve(binding),
                ]),
              ),
            }
          : {}),
      },
    ]),
  ) as Record<string, BuildingDocument>;
  return { ...rest, version: "1.0", assets };
}
