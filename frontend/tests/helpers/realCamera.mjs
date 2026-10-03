import { Camera, Ellipsoid, GeographicProjection, SceneMode } from "cesium";

// Real Cesium camera/frustum/ellipsoid maths with no canvas context, DOM or GPU.
export function realCamera(width = 1040, height = 500) {
  const scene = {
    canvas: { clientWidth: width, clientHeight: height },
    drawingBufferWidth: width, drawingBufferHeight: height,
    mapProjection: new GeographicProjection(Ellipsoid.WGS84),
    ellipsoid: Ellipsoid.WGS84, mode: SceneMode.SCENE3D,
    screenSpaceCameraController: { minimumZoomDistance: 2, maximumZoomDistance: Infinity },
  };
  const camera = new Camera(scene);
  scene.camera = camera;
  camera.update(SceneMode.SCENE3D);
  return camera;
}
