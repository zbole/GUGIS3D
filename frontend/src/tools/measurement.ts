import { Cartesian2, Cartesian3, Cartographic, Math as CesiumMath, Scene, Viewer } from "cesium";

export type LonLatHeight = [number, number, number];

export function screenToLonLatHeight(viewer: Viewer, position: { x: number; y: number }): LonLatHeight | null {
  const scene: Scene = viewer.scene;
  const windowPosition = new Cartesian2(position.x, position.y);
  const picked = scene.pickPositionSupported ? scene.pickPosition(windowPosition) : undefined;
  const cartesian = picked ?? viewer.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid);
  if (!cartesian) return null;
  const cartographic = Cartographic.fromCartesian(cartesian);
  return [
    CesiumMath.toDegrees(cartographic.longitude),
    CesiumMath.toDegrees(cartographic.latitude),
    cartographic.height
  ];
}

export function distanceMeters2d(a: LonLatHeight, b: LonLatHeight): number {
  const lon1 = CesiumMath.toRadians(a[0]);
  const lat1 = CesiumMath.toRadians(a[1]);
  const lon2 = CesiumMath.toRadians(b[0]);
  const lat2 = CesiumMath.toRadians(b[1]);
  const dlon = lon2 - lon1;
  const dlat = lat2 - lat1;
  const hav = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(hav));
}

export function distanceMeters3d(a: LonLatHeight, b: LonLatHeight): number {
  return Math.sqrt(distanceMeters2d(a, b) ** 2 + (a[2] - b[2]) ** 2);
}

export function midpoint(a: LonLatHeight, b: LonLatHeight): Cartesian3 {
  return Cartesian3.fromDegrees((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(a[2], b[2]) + 5);
}

export function formatMeters(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value.toFixed(1)} m`;
}
