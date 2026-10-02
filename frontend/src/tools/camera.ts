import { BoundingSphere, Cartesian3, HeadingPitchRange, Math as CesiumMath, Viewer } from "cesium";

export const BRISTOL_VIEW = {
  destination: Cartesian3.fromDegrees(-2.5879, 51.45165, 350),
  orientation: {
    heading: 0,
    pitch: CesiumMath.toRadians(-46),
    roll: 0
  }
};

const BRISTOL_CENTER = {
  lon: -2.5879,
  lat: 51.4545
};

export function resetCamera(viewer: Viewer): void {
  viewer.camera.flyToBoundingSphere(new BoundingSphere(Cartesian3.fromDegrees(-2.5879,51.4545,25),145), {
    offset: new HeadingPitchRange(CesiumMath.toRadians(20),CesiumMath.toRadians(-45),480), duration: .7
  });
}

export function topView(viewer: Viewer): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(BRISTOL_CENTER.lon, BRISTOL_CENTER.lat, 900),
    orientation: {
      heading: 0,
      pitch: CesiumMath.toRadians(-90),
      roll: 0
    },
    duration: 0.8
  });
}

export function obliqueView(viewer: Viewer): void {
  resetCamera(viewer);
}

export function streetLevelView(viewer: Viewer): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(-2.58935, 51.45388, 26),
    orientation: {
      heading: CesiumMath.toRadians(45),
      pitch: CesiumMath.toRadians(-8),
      roll: 0
    },
    duration: 0.9
  });
}

export function northUp(viewer: Viewer): void {
  viewer.camera.flyTo({
    destination: viewer.camera.positionWC.clone(),
    orientation: {
      heading: 0,
      pitch: viewer.camera.pitch,
      roll: 0
    },
    duration: 0.45
  });
}

export function rotateCamera(viewer: Viewer, deltaDegrees: number): void {
  viewer.camera.setView({
    orientation: {
      heading: viewer.camera.heading + CesiumMath.toRadians(deltaDegrees),
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll
    }
  });
}

export function tiltCamera(viewer: Viewer, deltaDegrees: number): void {
  const minPitch = CesiumMath.toRadians(-89);
  const maxPitch = CesiumMath.toRadians(-5);
  const nextPitch = CesiumMath.clamp(viewer.camera.pitch + CesiumMath.toRadians(deltaDegrees), minPitch, maxPitch);
  viewer.camera.setView({
    orientation: {
      heading: viewer.camera.heading,
      pitch: nextPitch,
      roll: viewer.camera.roll
    }
  });
}

export function flyToObject(viewer: Viewer, objectId: string): void {
  const entity = viewer.entities.getById(objectId);
  if (entity) {
    viewer.flyTo(entity, { duration: 0.8 });
  }
}
