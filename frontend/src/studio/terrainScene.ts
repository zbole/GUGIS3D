import {
  BoundingSphere,
  Cartesian3,
  Matrix4,
  Transforms,
  Geometry,
  GeometryAttributes,
  GeometryAttribute,
  ComponentDatatype,
  PrimitiveType,
  GeometryPipeline,
  type Ray,
} from "cesium";
import type { Terrain, TerrainPatch } from "./environment";
import { terrainIndex, terrainMesh } from "./terrainMath";
export function terrainSampler(terrain?: Terrain | null) {
  if (!terrain) return null;
  const frame = Transforms.eastNorthUpToFixedFrame(
    Cartesian3.fromDegrees(terrain.longitude, terrain.latitude),
  );
  const inverse = Matrix4.inverse(frame, new Matrix4());
  const index = terrainIndex(terrain);
  return {
    frame,
    index,
    ray: (ray: Ray) => {
      const origin = Matrix4.multiplyByPoint(inverse, ray.origin, new Cartesian3());
      const direction = Matrix4.multiplyByPointAsVector(inverse, ray.direction, new Cartesian3());
      const hit = index.raycast([origin.x, origin.y, origin.z + terrain.reference_height],
        [direction.x, direction.y, direction.z]);
      return hit ? { hit, position: Matrix4.multiplyByPoint(frame,
        new Cartesian3(hit.x, hit.y, hit.height - terrain.reference_height), new Cartesian3()) } : null;
    },
    world: (position: Cartesian3) => {
      const p = Matrix4.multiplyByPoint(inverse, position, new Cartesian3());
      return index.query(p.x, p.y);
    },
    at: (longitude: number, latitude: number) => {
      const p = Matrix4.multiplyByPoint(
        inverse,
        Cartesian3.fromDegrees(longitude, latitude),
        new Cartesian3(),
      );
      return index.query(p.x, p.y);
    },
    height: (longitude: number, latitude: number) => {
      const p = Matrix4.multiplyByPoint(
        inverse,
        Cartesian3.fromDegrees(longitude, latitude),
        new Cartesian3(),
      );
      const hit = index.query(p.x, p.y);
      return hit ? hit.height - terrain.reference_height : 0;
    },
  };
}
export function surfaceGeometry(terrain: Terrain, kind: TerrainPatch["kind"]) {
  const mesh = terrainMesh(terrain, kind);
  if (!mesh.triangles.length) return null;
  const values = new Float64Array(
    mesh.vertices.flatMap((p) => [p[0], p[1], p[2] - terrain.reference_height]),
  );
  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values,
  });
  return GeometryPipeline.computeNormal(
    new Geometry({
      attributes,
      indices: new Uint32Array(mesh.triangles.flat()),
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(values),
    }),
  );
}
