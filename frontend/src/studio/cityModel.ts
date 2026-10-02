import type { BuildingDocument, Parameters } from "./model";
import type { Environment } from "./environment";

export interface Placement {
  id: string;
  asset: string;
  name: string;
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
}
export interface CityDocument {
  format: "gugis-city";
  version: "1.0";
  coordinate_system: "ENU_METERS_WGS84";
  name: string;
  assets: Record<string, BuildingDocument>;
  instances: Placement[];
  roads: {
    id: string;
    name: string;
    width: number;
    coordinates: [number, number][];
  }[];
  metadata: Record<string, string>;
  environment?: Environment;
}
export function placedDocument(
  city: CityDocument,
  id: string,
): BuildingDocument | null {
  const i = city.instances.find((i) => i.id === id);
  if (!i) return null;
  const doc = city.assets[i.asset];
  return {
    ...doc,
    parameters: {
      ...doc.parameters,
      name: i.name,
      longitude: i.longitude,
      latitude: i.latitude,
      altitude: i.altitude,
      heading: i.heading,
    },
    nodes: doc.nodes.map((n) => (n.parent ? n : { ...n, name: i.name })),
  };
}
export function collectAssets(city: CityDocument): CityDocument {
  const used = new Set(city.instances.map((i) => i.asset));
  return {
    ...city,
    assets: Object.fromEntries(
      Object.entries(city.assets).filter(([id]) => used.has(id)),
    ),
  };
}
export function putBuilding(
  city: CityDocument,
  document: BuildingDocument,
  id: string,
  replace = false,
): CityDocument {
  if (replace && !city.instances.some((i) => i.id === id))
    throw new Error("需要选择待更新建筑");
  if (!replace && city.instances.some((i) => i.id === id))
    throw new Error("建筑编号已存在");
  const { name, longitude, latitude, altitude, heading } = document.parameters;
  // Copy-on-write: changing one placed building never changes shared neighbours.
  const asset = `a_${crypto.randomUUID().replace(/-/g, "")}`;
  const entry = { id, asset, name, longitude, latitude, altitude, heading };
  return collectAssets({
    ...city,
    assets: { ...city.assets, [asset]: document },
    instances: replace
      ? city.instances.map((i) => (i.id === id ? entry : i))
      : [...city.instances, entry],
  });
}
export function removeBuilding(city: CityDocument, id: string): CityDocument {
  return collectAssets({
    ...city,
    instances: city.instances.filter((i) => i.id !== id),
  });
}
export const kinds: Record<Parameters["kind"], string> = {
  tower: "多层住宅",
  villa: "坡顶住宅",
  georgian: "乔治式联排住宅",
  victorian: "维多利亚式凸窗住宅",
  wills: "Wills Memorial Building",
  cabot: "Cabot Tower",
  cathedral: "Bristol Cathedral",
  tudor: "都铎式木构街屋（设计）",
  warehouse: "港区砖砌仓库（设计）",
  chapel: "英式礼拜堂（设计）",
  civic: "钟楼市政厅（设计）",
  footprint: "轮廓体量（LoD1）",
  urban: "轮廓适配精细建筑",
};
export const presets: Partial<Record<Parameters["kind"], Partial<Parameters>>> =
  {
    georgian: { floors: 3, units: 1, floor_height: 3.4 },
    victorian: { floors: 3, units: 1, floor_height: 3.2 },
    wills: {
      floors: 8,
      units: 1,
      longitude: -2.6044,
      latitude: 51.4563,
      heading: -14,
    },
    cabot: { floors: 5, units: 1, longitude: -2.6069, latitude: 51.454 },
    cathedral: {
      floors: 6,
      units: 1,
      longitude: -2.6007,
      latitude: 51.4517,
      heading: -90,
    },
    tower: { floors: 12, units: 2 },
    villa: { floors: 3, units: 1 },
    tudor: { floors: 3, units: 1, floor_height: 3 },
    warehouse: { floors: 4, units: 1, floor_height: 3.6 },
    chapel: { floors: 4, units: 1, floor_height: 3.2 },
    civic: { floors: 5, units: 1, floor_height: 3.2 },
  };
