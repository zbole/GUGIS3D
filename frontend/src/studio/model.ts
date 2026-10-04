import palette from "../../../shared/component-colors.json" with { type: "json" };
export const componentColors: Record<string, string> = palette;
export type Vec3 = [number, number, number];
export type Category =
  | "building"
  | "unit"
  | "floor"
  | "dwelling"
  | "room"
  | "column"
  | "ornament"
  | "slab"
  | "wall"
  | "window"
  | "door"
  | "balcony"
  | "railing"
  | "roof"
  | "stair";
export interface Parameters {
  name: string;
  kind:
    | "tower"
    | "villa"
    | "georgian"
    | "victorian"
    | "wills"
    | "cabot"
    | "cathedral"
    | "tudor"
    | "warehouse"
    | "chapel"
    | "civic"
    | "footprint"
    | "urban";
  scale?: number;
  floors: number;
  units: number;
  floor_height: number;
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
}
export interface Solid {
  kind: "box" | "mesh";
  color: string;
  size?: Vec3;
  vertices?: Vec3[];
  triangles?: Vec3[];
}
export interface SceneNode {
  id: string;
  parent?: string;
  name: string;
  category: Category;
  floor?: number;
  unit?: number;
  template?: string;
  position?: Vec3;
  rotation_z?: number;
  attributes?: Record<string, string>;
}
export interface BuildingDocument {
  format: "gugis-studio";
  version: "1.0" | "1.1" | "1.2";
  coordinate_system: "ENU_METERS_WGS84";
  parameters: Parameters;
  templates: Record<string, Solid>;
  nodes: SceneNode[];
  overview?: Record<string, Solid>;
}

/** Empty overview maps are valid archives, but provide no usable coarse model. */
export function hasBuildingOverview(document: BuildingDocument): document is BuildingDocument & { overview: Record<string, Solid> } {
  return !!document.overview && Object.keys(document.overview).length > 0;
}

export type FloorMode = "all" | "focus" | "isolate" | "lift" | "hide";
export interface SceneView {
  mode: FloorMode;
  from: number;
  to: number;
  split: number;
  lift: number;
  opacity: number;
  categories: Set<Category>;
}
export const categoryLabels: Record<Category, string> = {
  building: "楼栋",
  unit: "单元",
  floor: "楼层",
  dwelling: "住户",
  room: "空间",
  column: "柱与扶壁",
  ornament: "建筑细部",
  slab: "楼板",
  wall: "墙体",
  window: "窗户",
  door: "入户门",
  balcony: "阳台",
  railing: "栏板与窗框",
  roof: "屋顶",
  stair: "楼梯",
};
export const componentCategories: Category[] = [
  "column",
  "ornament",
  "slab",
  "wall",
  "window",
  "door",
  "balcony",
  "railing",
  "roof",
  "stair",
];
export function initialView(floors: number): SceneView {
  return {
    mode: "all",
    from: Math.min(8, floors),
    to: Math.min(11, floors),
    split: Math.min(11, floors),
    lift: 12,
    opacity: 1,
    categories: new Set(componentCategories),
  };
}
export function descendants(
  document: BuildingDocument,
  selected: string | null,
): Set<string> {
  const result = new Set<string>();
  if (!selected) return result;
  result.add(selected);
  for (const node of document.nodes)
    if (node.parent && result.has(node.parent)) result.add(node.id);
  return result;
}
export function presentation(node: SceneNode, view: SceneView) {
  const floor = node.floor ?? 1;
  const inRange = floor >= view.from && floor <= view.to;
  return {
    visible:
      view.categories.has(node.category) &&
      !(view.mode === "isolate" && !inRange) &&
      !(view.mode === "hide" && floor >= view.split),
    alpha: view.opacity * (view.mode === "focus" && !inRange ? 0.12 : 1),
    offset: view.mode === "lift" && floor >= view.split ? view.lift : 0,
  };
}
/** A declared floor count alone does not supply geometry that can be separated. */
export function hasFloorComponents(document: BuildingDocument): boolean {
  return document.parameters.kind !== "footprint" && document.nodes.some(node => !!node.template && !!document.templates[node.template]
    && Number.isInteger(node.floor) && node.floor! >= 1 && node.floor! <= document.parameters.floors);
}
export function componentFloors(document: BuildingDocument): number[] {
  if (document.parameters.kind === "footprint") return [];
  return [...new Set(document.nodes.filter(node => !!node.template && !!document.templates[node.template]
    && Number.isInteger(node.floor) && node.floor! >= 1 && node.floor! <= document.parameters.floors)
    .map(node => node.floor!))].sort((a, b) => a - b);
}
export function serialize(document: BuildingDocument): string {
  return JSON.stringify({
    ...document,
    nodes: document.nodes.map((n) => {
      const copy = { ...n };
      if (!copy.attributes || !Object.keys(copy.attributes).length)
        delete copy.attributes;
      return copy;
    }),
  });
}
export function statistics(document: BuildingDocument) {
  const encode = (value: string) => new TextEncoder().encode(value).length;
  const payload = JSON.parse(serialize(document)) as BuildingDocument;
  const { templates, ...rest } = payload;
  const expanded = {
    ...rest,
    nodes: payload.nodes.map((n) => {
      const { template, ...other } = n;
      return template ? { ...other, solid: templates[template] } : other;
    }),
  };
  const bytes = encode(serialize(document)),
    inlineBytes = encode(JSON.stringify(expanded));
  return {
    bytes,
    inlineBytes,
    components: document.nodes.filter((n) => n.template).length,
    templates: Object.keys(templates).length,
    dwellings: document.nodes.filter((n) => n.category === "dwelling").length,
    saving: 1 - bytes / inlineBytes,
  };
}
export function downloadDocument(document: BuildingDocument) {
  const url = URL.createObjectURL(
    new Blob([serialize(document)], { type: "application/json" }),
  );
  const a = window.document.createElement("a");
  a.href = url;
  a.download = `${document.parameters.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}.gugis.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
