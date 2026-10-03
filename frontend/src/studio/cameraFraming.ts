import { BoundingSphere, Cartesian3, HeadingPitchRange, Math as CM, Matrix4, type Camera } from "cesium";

export interface CameraTarget { longitude: number; latitude: number; radius: number }

/** Frame the verified package footprint, not an arbitrary camera location above it. */
export function defaultCameraTarget(bounds: readonly number[] | null, fallback: { longitude: number; latitude: number }): CameraTarget {
  if (!bounds || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[0] > bounds[2] || bounds[1] > bounds[3])
    return { ...fallback, radius: 300 };
  const longitude = (bounds[0] + bounds[2]) / 2, latitude = (bounds[1] + bounds[3]) / 2;
  const center = Cartesian3.fromDegrees(longitude, latitude);
  let radius = 300;
  for (const lon of [bounds[0], bounds[2]]) for (const lat of [bounds[1], bounds[3]])
    radius = Math.max(radius, Cartesian3.distance(center, Cartesian3.fromDegrees(lon, lat)));
  return { longitude, latitude, radius };
}

/** Cesium computes the camera offset from its real frustum, including narrow screens. */
export function frameCameraTarget(camera: Pick<Camera, "viewBoundingSphere" | "lookAtTransform">, target: CameraTarget): void {
  const sphere = new BoundingSphere(Cartesian3.fromDegrees(target.longitude, target.latitude), target.radius * 1.15);
  camera.viewBoundingSphere(sphere, new HeadingPitchRange(CM.toRadians(18), CM.toRadians(-45), 0));
  // viewBoundingSphere uses a local target frame. Restore world coordinates so
  // later free navigation and exact bookmarked setView poses keep their meaning.
  camera.lookAtTransform(Matrix4.IDENTITY);
}
