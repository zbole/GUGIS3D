import {
  BoxGeometry,
  Cartesian3,
  PerInstanceColorAppearance,
  GeometryAttributes,
  GeometryAttribute,
  ComponentDatatype,
  GeometryPipeline,
  Geometry,
  PrimitiveType,
  BoundingSphere,
} from "cesium";
import type { Solid, Vec3 } from "./model";

export function solidGeometry(solid: Solid, offset?: Vec3, rotation = 0) {
  const c = Math.cos((rotation * Math.PI) / 180),
    s = Math.sin((rotation * Math.PI) / 180);
  if (solid.kind === "box") {
    const box = BoxGeometry.fromDimensions({
      dimensions: new Cartesian3(...solid.size!),
      vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
    });
    if (!offset && !rotation) return box;
    const geometry = BoxGeometry.createGeometry(box)!;
    const values = geometry.attributes.position!.values;
    for (let i = 0; i < values.length; i += 3) {
      const x = values[i],
        y = values[i + 1];
      values[i] = x * c - y * s + (offset?.[0] ?? 0);
      values[i + 1] = x * s + y * c + (offset?.[1] ?? 0);
      values[i + 2] += offset?.[2] ?? 0;
    }
    const normals = geometry.attributes.normal!.values;
    for (let i = 0; i < normals.length; i += 3) {
      const x = normals[i],
        y = normals[i + 1];
      normals[i] = x * c - y * s;
      normals[i + 1] = x * s + y * c;
    }
    geometry.boundingSphere = BoundingSphere.fromVertices(values);
    return geometry;
  }
  // Duplicate face vertices for crisp architectural edges, while the file retains shared vertices.
  const positions = new Float64Array(
    solid.triangles!.flatMap((t) =>
      t.flatMap((i) =>
        (() => {
          const [x, y, z] = solid.vertices![i];
          return [
            x * c - y * s + (offset?.[0] ?? 0),
            x * s + y * c + (offset?.[1] ?? 0),
            z + (offset?.[2] ?? 0),
          ];
        })(),
      ),
    ),
  );
  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions,
  });
  return GeometryPipeline.computeNormal(
    new Geometry({
      attributes,
      indices: new Uint16Array(
        Array.from({ length: positions.length / 3 }, (_, i) => i),
      ),
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(positions),
    }),
  );
}

export function solidCorners(solid: Solid, rotation = 0): Cartesian3[] {
  const corners =
    solid.kind === "box"
      ? [-1, 1].flatMap((x) =>
          [-1, 1].flatMap((y) =>
            [-1, 1].map(
              (z) =>
                new Cartesian3(
                  (x * solid.size![0]) / 2,
                  (y * solid.size![1]) / 2,
                  (z * solid.size![2]) / 2,
                ),
            ),
          ),
        )
      : solid.vertices!.map((p) => new Cartesian3(...p));
  const c = Math.cos((rotation * Math.PI) / 180),
    s = Math.sin((rotation * Math.PI) / 180);
  return corners.map(
    (p) => new Cartesian3(p.x * c - p.y * s, p.x * s + p.y * c, p.z),
  );
}
