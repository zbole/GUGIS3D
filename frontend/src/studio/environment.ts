import presets from "../../../shared/function-features.json" with { type: "json" };
import type { Vec3, Solid } from "./model";
export interface TerrainPatch {
  id: string;
  kind: "ruled-strip" | "triangle-strip" | "triangle-fan";
  left?: number[];
  right?: number[];
  indices?: number[];
  hub?: number;
  ring?: number[];
}
export interface Terrain {
  version: "1.0";
  name: string;
  longitude: number;
  latitude: number;
  vertical_datum: "ODN" | "ellipsoidal" | "local" | "unknown";
  reference_height: number;
  demonstration: boolean;
  source: Record<string, string>;
  points: Vec3[];
  patches: TerrainPatch[];
}
export interface FunctionPrimitive {
  id: string;
  category: string;
  function: "sphere" | "cylinder" | "annular-prism" | "arch-prism" | "box";
  parameters: Record<string, number>;
  position: Vec3;
  color: string;
}
export interface FeatureAsset {
  name: string;
  kind: "lamp" | "arched-door" | "curved-balcony" | "round-plaza";
  components: FunctionPrimitive[];
}
export interface FeaturePlacement {
  id: string;
  asset: string;
  name: string;
  longitude: number;
  latitude: number;
  altitude: number;
  heading: number;
  scale: number;
  layer: "surface" | "underground";
}
export interface Environment {
  version: "1.0";
  terrain?: Terrain | null;
  feature_assets: Record<string, FeatureAsset>;
  features: FeaturePlacement[];
  drape_buildings: boolean;
}
export const featurePresets = presets as unknown as Record<
  FeatureAsset["kind"],
  FeatureAsset
>;
export const emptyEnvironment = (): Environment => ({
  version: "1.0",
  feature_assets: {},
  features: [],
  drape_buildings: true,
});
export const terrainColors = {
  "ruled-strip": "#6e9e8b",
  "triangle-strip": "#b89a65",
  "triangle-fan": "#8f86b0",
};
export const terrainNames = {
  "ruled-strip": "直纹面带",
  "triangle-strip": "三角带",
  "triangle-fan": "三角扇",
};

// Tessellation is a display cache. The archive stores function names and parameters.
export function functionSolid(
  primitive: FunctionPrimitive,
  segments = 32,
): Solid {
  const p = primitive.parameters,
    vertices: Vec3[] = [],
    triangles: Vec3[] = [];
  const add = (x: number, y: number, z: number) => {
    vertices.push([x, y, z]);
    return vertices.length - 1;
  };
  const face = (a: number, b: number, c: number) => triangles.push([a, b, c]);
  if (primitive.function === "box")
    return {
      kind: "box",
      color: primitive.color,
      size: [p.width, p.depth, p.height],
    };
  if (primitive.function === "sphere") {
    const n = segments,
      m = Math.max(4, Math.floor(n / 2));
    const bottom = add(0, 0, -p.radius),
      rings: number[][] = [];
    for (let j = 1; j < m; j++) {
      const phi = -Math.PI / 2 + (Math.PI * j) / m,
        ring: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        ring.push(
          add(
            p.radius * Math.cos(phi) * Math.cos(a),
            p.radius * Math.cos(phi) * Math.sin(a),
            p.radius * Math.sin(phi),
          ),
        );
      }
      rings.push(ring);
    }
    const top = add(0, 0, p.radius);
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      face(bottom, rings[0][k], rings[0][i]);
      for (let j = 0; j < rings.length - 1; j++) {
        const a = rings[j],
          b = rings[j + 1];
        face(a[i], a[k], b[i]);
        face(a[k], b[k], b[i]);
      }
      face(rings[rings.length - 1][i], rings[rings.length - 1][k], top);
    }
  } else {
    const arch = primitive.function === "arch-prism",
      angle = arch ? 180 : (p.angle ?? 360),
      full = angle === 360;
    const outer = p.outer_radius ?? p.radius,
      inner = p.inner_radius ?? 0,
      height = arch ? p.depth : p.height;
    const steps = Math.max(4, Math.ceil((segments * angle) / 360)),
      count = full ? steps : steps + 1;
    const low: number[] = [],
      high: number[] = [],
      ilow: number[] = [],
      ihigh: number[] = [];
    for (let i = 0; i < count; i++) {
      const a =
        (arch ? 0 : (-angle * Math.PI) / 360) +
        ((i / steps) * angle * Math.PI) / 180;
      low.push(add(outer * Math.cos(a), outer * Math.sin(a), -height / 2));
      high.push(add(outer * Math.cos(a), outer * Math.sin(a), height / 2));
      if (inner > 0) {
        ilow.push(add(inner * Math.cos(a), inner * Math.sin(a), -height / 2));
        ihigh.push(add(inner * Math.cos(a), inner * Math.sin(a), height / 2));
      }
    }
    const cb = inner ? 0 : add(0, 0, -height / 2),
      ct = inner ? 0 : add(0, 0, height / 2);
    for (let i = 0; i < steps; i++) {
      const k = (i + 1) % count;
      face(low[i], low[k], high[i]);
      face(low[k], high[k], high[i]);
      if (inner) {
        face(ilow[k], ilow[i], ihigh[i]);
        face(ilow[k], ihigh[i], ihigh[k]);
        face(high[i], high[k], ihigh[i]);
        face(high[k], ihigh[k], ihigh[i]);
        face(low[k], low[i], ilow[i]);
        face(low[k], ilow[i], ilow[k]);
      } else {
        face(ct, high[i], high[k]);
        face(cb, low[k], low[i]);
      }
    }
    if (!full) {
      const k = count - 1;
      if (inner) {
        face(low[0], high[0], ilow[0]);
        face(high[0], ihigh[0], ilow[0]);
        face(low[k], ilow[k], high[k]);
        face(high[k], ilow[k], ihigh[k]);
      } else {
        face(low[0], high[0], cb);
        face(high[0], ct, cb);
        face(low[k], cb, high[k]);
        face(high[k], cb, ct);
      }
    }
    if (arch)
      for (const v of vertices) {
        const y = v[1],
          z = v[2];
        v[1] = -z;
        v[2] = y;
      }
  }
  return { kind: "mesh", color: primitive.color, vertices, triangles };
}
