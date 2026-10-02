import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Entity,
  ImageryLayer,
  HeadingPitchRoll,
  HorizontalOrigin,
  LabelStyle,
  Math as CesiumMath,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  TileMapServiceImageryProvider,
  buildModuleUrl,
  VerticalOrigin,
  Viewer
} from "cesium";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import type { GugisObject, LayerState, MeasurementMode } from "../types/gugis";
import {
  BRISTOL_VIEW,
  flyToObject,
  northUp,
  obliqueView,
  resetCamera,
  rotateCamera,
  streetLevelView,
  tiltCamera,
  topView
} from "../tools/camera";
import { passesSimpleClip } from "../tools/clipping";
import { distanceMeters3d, formatMeters, midpoint, screenToLonLatHeight, type LonLatHeight } from "../tools/measurement";
import { objectIdFromPickedEntity } from "../tools/picking";

export interface CesiumViewerHandle {
  resetCamera: () => void;
  topView: () => void;
  obliqueView: () => void;
  streetLevelView: () => void;
  northUp: () => void;
  rotateLeft: () => void;
  rotateRight: () => void;
  tiltUp: () => void;
  tiltDown: () => void;
  flyToObject: (objectId: string) => void;
  clearMeasurements: () => void;
}

interface CesiumViewerProps {
  objects: GugisObject[];
  layerState: Record<string, LayerState>;
  selectedId: string | null;
  hiddenObjectIds: Set<string>;
  measurementMode: MeasurementMode;
  clippingEnabled: boolean;
  onSelect: (objectId: string | null) => void;
  onStatus: (status: string) => void;
  onCameraStatus: (status: string) => void;
  onViewerReady: (ready: boolean) => void;
}

const layerColors: Record<string, Color> = {
  buildings: Color.fromCssColorString("#5d83a5"),
  roads: Color.fromCssColorString("#4a4f54"),
  parks: Color.fromCssColorString("#3f8f5f"),
  templates: Color.fromCssColorString("#d89b32")
};

function colorForObject(obj: GugisObject, selected: boolean, opacity: number): Color {
  if (selected) return Color.fromCssColorString("#f5c542").withAlpha(1);
  return (layerColors[obj.layer_id] ?? Color.fromCssColorString("#7f8b8f")).withAlpha(opacity);
}

function objectHeight(obj: GugisObject): number {
  const attrHeight = Number(obj.attributes.height_m);
  if (Number.isFinite(attrHeight)) return attrHeight;
  const geometryHeight = Number(obj.geometry.height);
  if (Number.isFinite(geometryHeight)) return geometryHeight;
  const size = obj.geometry.size_m;
  if (Array.isArray(size) && Number.isFinite(Number(size[2]))) return Number(size[2]);
  return obj.hybrid_box.radius_xyz[2] * 2;
}

function addBox(viewer: Viewer, obj: GugisObject, material: Color): Entity {
  const size = Array.isArray(obj.geometry.size_m) ? (obj.geometry.size_m as number[]) : [12, 12, objectHeight(obj)];
  const [lon, lat, altitude] = obj.base_point;
  const height = Number(size[2] ?? objectHeight(obj));
  const position = Cartesian3.fromDegrees(lon, lat, altitude + height / 2);
  return viewer.entities.add({
    id: obj.object_id,
    name: obj.name,
    position,
    orientation: Transforms.headingPitchRollQuaternion(
      position,
      new HeadingPitchRoll(CesiumMath.toRadians(obj.pose.strike ?? 0), CesiumMath.toRadians(obj.pose.dip ?? 0), CesiumMath.toRadians(obj.pose.roll ?? 0))
    ),
    properties: { objectId: obj.object_id },
    box: {
      dimensions: new Cartesian3(Number(size[0]), Number(size[1]), height),
      material,
      outline: true,
      outlineColor: Color.WHITE.withAlpha(0.45)
    }
  });
}

function addPolygon(viewer: Viewer, obj: GugisObject, material: Color): Entity {
  const coords = (obj.geometry.coordinates ?? obj.geometry.polygon) as [number, number, number?][] | undefined;
  const positions = (coords ?? []).map(([lon, lat, height = 0]) => Cartesian3.fromDegrees(lon, lat, height));
  const height = objectHeight(obj);
  return viewer.entities.add({
    id: obj.object_id,
    name: obj.name,
    properties: { objectId: obj.object_id },
    polygon: {
      hierarchy: new PolygonHierarchy(positions),
      height: 0,
      extrudedHeight: obj.shape_type === 30000 ? 0.4 : height,
      material,
      outline: true,
      outlineColor: Color.WHITE.withAlpha(0.35)
    }
  });
}

function addTemplate(viewer: Viewer, obj: GugisObject, material: Color): void {
  const [lon, lat] = obj.base_point;
  const height = objectHeight(obj);
  const isLamp = String(obj.geometry.template_id).includes("lamp");
  viewer.entities.add({
    id: obj.object_id,
    name: obj.name,
    position: Cartesian3.fromDegrees(lon, lat, height / 2),
    properties: { objectId: obj.object_id },
    cylinder: {
      length: height,
      topRadius: isLamp ? 0.1 : 0.18,
      bottomRadius: isLamp ? 0.16 : 0.28,
      material: isLamp
        ? Color.fromCssColorString("#b8c0c7").withAlpha(material.alpha)
        : Color.fromCssColorString("#8b5a2b").withAlpha(material.alpha)
    }
  });
  if (isLamp) {
    viewer.entities.add({
      id: `${obj.object_id}_crown`,
      name: `${obj.name} lamp head`,
      position: Cartesian3.fromDegrees(lon, lat, height + 0.35),
      properties: { objectId: obj.object_id },
      ellipsoid: {
        radii: new Cartesian3(0.6, 0.6, 0.25),
        material
      }
    });
  } else {
    viewer.entities.add({
      id: `${obj.object_id}_crown`,
      name: `${obj.name} canopy`,
      position: Cartesian3.fromDegrees(lon, lat, height),
      properties: { objectId: obj.object_id },
      ellipsoid: {
        radii: new Cartesian3(2.4, 2.4, 2.0),
        material: Color.fromCssColorString("#3f8f5f").withAlpha(material.alpha)
      }
    });
  }
}

function addClipPlaneMarker(viewer: Viewer): void {
  const lon = -2.58755;
  viewer.entities.add({
    id: "clip_plane_marker",
    name: "Slicing plane",
    polygon: {
      hierarchy: new PolygonHierarchy([
        Cartesian3.fromDegrees(lon, 51.4536, 0),
        Cartesian3.fromDegrees(lon, 51.4555, 0),
        Cartesian3.fromDegrees(lon, 51.4555, 90),
        Cartesian3.fromDegrees(lon, 51.4536, 90)
      ]),
      material: Color.CYAN.withAlpha(0.18),
      outline: true,
      outlineColor: Color.CYAN
    }
  });
}

function addSelectionMarker(viewer: Viewer, obj: GugisObject): void {
  const [lon, lat, height] = obj.hybrid_box.center;
  const [rx, ry, rz] = obj.hybrid_box.radius_xyz;
  viewer.entities.add({
    id: "selected_object_marker",
    name: `Selected: ${obj.name}`,
    position: Cartesian3.fromDegrees(lon, lat, height),
    properties: { objectId: obj.object_id },
    ellipsoid: {
      radii: new Cartesian3(Math.max(rx, 2), Math.max(ry, 2), Math.max(rz, 2)),
      material: Color.YELLOW.withAlpha(0.12),
      outline: true,
      outlineColor: Color.YELLOW
    },
    label: {
      text: obj.object_id,
      font: "13px sans-serif",
      fillColor: Color.BLACK,
      outlineColor: Color.YELLOW,
      outlineWidth: 4,
      style: LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -16)
    }
  });
}

function formatCameraStatus(viewer: Viewer): string {
  const cartographic = Cartographic.fromCartesian(viewer.camera.positionWC);
  const lon = CesiumMath.toDegrees(cartographic.longitude).toFixed(5);
  const lat = CesiumMath.toDegrees(cartographic.latitude).toFixed(5);
  const height = cartographic.height.toFixed(1);
  const heading = CesiumMath.toDegrees(viewer.camera.heading).toFixed(1);
  const pitch = CesiumMath.toDegrees(viewer.camera.pitch).toFixed(1);
  const roll = CesiumMath.toDegrees(viewer.camera.roll).toFixed(1);
  return `Camera lon ${lon}, lat ${lat}, h ${height} m, hdg ${heading}°, pitch ${pitch}°, roll ${roll}°`;
}

const CesiumViewer = forwardRef<CesiumViewerHandle, CesiumViewerProps>(function CesiumViewer(
  {
    objects,
    layerState,
    selectedId,
    hiddenObjectIds,
    measurementMode,
    clippingEnabled,
    onSelect,
    onStatus,
    onCameraStatus,
    onViewerReady
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const modeRef = useRef<MeasurementMode>(measurementMode);
  const objectsRef = useRef<GugisObject[]>(objects);
  const measurementPointsRef = useRef<LonLatHeight[]>([]);
  const measurementEntityIdsRef = useRef<string[]>([]);

  useImperativeHandle(ref, () => ({
    resetCamera: () => viewerRef.current && resetCamera(viewerRef.current),
    topView: () => viewerRef.current && topView(viewerRef.current),
    obliqueView: () => viewerRef.current && obliqueView(viewerRef.current),
    streetLevelView: () => viewerRef.current && streetLevelView(viewerRef.current),
    northUp: () => viewerRef.current && northUp(viewerRef.current),
    rotateLeft: () => viewerRef.current && rotateCamera(viewerRef.current, -15),
    rotateRight: () => viewerRef.current && rotateCamera(viewerRef.current, 15),
    tiltUp: () => viewerRef.current && tiltCamera(viewerRef.current, 8),
    tiltDown: () => viewerRef.current && tiltCamera(viewerRef.current, -8),
    flyToObject: (objectId: string) => viewerRef.current && flyToObject(viewerRef.current, objectId),
    clearMeasurements: () => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      measurementEntityIdsRef.current.forEach((id) => viewer.entities.removeById(id));
      measurementEntityIdsRef.current = [];
      measurementPointsRef.current = [];
      onStatus("Measurements cleared");
    }
  }));

  useEffect(() => {
    modeRef.current = measurementMode;
  }, [measurementMode]);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Viewer(containerRef.current, {
      baseLayer: ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"))),
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      shouldAnimate: true
    });
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.camera.setView(BRISTOL_VIEW);
    viewerRef.current = viewer;
    onViewerReady(true);
    onCameraStatus(formatCameraStatus(viewer));
    const removeMoveEndListener = viewer.camera.moveEnd.addEventListener(() => {
      onCameraStatus(formatCameraStatus(viewer));
    });

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      if (modeRef.current === "distance") {
        const point = screenToLonLatHeight(viewer, movement.position);
        if (!point) return;
        measurementPointsRef.current.push(point);
        onStatus(`Measurement point ${measurementPointsRef.current.length} set`);
        if (measurementPointsRef.current.length === 2) {
          const [a, b] = measurementPointsRef.current;
          const id = `measurement_${Date.now()}`;
          const distance = distanceMeters3d(a, b);
          viewer.entities.add({
            id,
            position: midpoint(a, b),
            polyline: {
              positions: [Cartesian3.fromDegrees(...a), Cartesian3.fromDegrees(...b)],
              width: 3,
              material: Color.YELLOW
            },
            label: {
              text: formatMeters(distance),
              font: "14px sans-serif",
              fillColor: Color.BLACK,
              outlineColor: Color.WHITE,
              outlineWidth: 3,
              style: LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: VerticalOrigin.BOTTOM,
              pixelOffset: new Cartesian2(0, -10)
            }
          });
          measurementEntityIdsRef.current.push(id);
          measurementPointsRef.current = [];
          onStatus(`Distance ${formatMeters(distance)}`);
        }
        return;
      }

      const picked = viewer.scene.pick(movement.position);
      const objectId = objectIdFromPickedEntity(picked?.id);
      onSelect(objectId);
      if (objectId && modeRef.current === "height") {
        const obj = objectsRef.current.find((item) => item.object_id === objectId);
        if (obj) onStatus(`Height ${formatMeters(objectHeight(obj))}`);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      handler.destroy();
      removeMoveEndListener();
      viewer.destroy();
      viewerRef.current = null;
      onViewerReady(false);
    };
  }, [onCameraStatus, onSelect, onStatus, onViewerReady]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const preservedMeasurements = new Set(measurementEntityIdsRef.current);
    [...viewer.entities.values]
      .filter((entity) => !preservedMeasurements.has(String(entity.id)))
      .forEach((entity) => viewer.entities.remove(entity));

    objects.forEach((obj) => {
      const layer = layerState[obj.layer_id] ?? { visible: obj.visible, opacity: obj.opacity };
      const visible = obj.visible && layer.visible && !hiddenObjectIds.has(obj.object_id) && passesSimpleClip(obj, clippingEnabled, -2.58755);
      if (!visible) return;

      const opacity = Math.min(obj.opacity, layer.opacity);
      const material = colorForObject(obj, obj.object_id === selectedId, opacity);
      if (obj.structure_type === "TemplateStructure") {
        addTemplate(viewer, obj, material);
      } else if (obj.geometry.function_type === "extruded_box") {
        addBox(viewer, obj, material);
      } else {
        addPolygon(viewer, obj, material);
      }
    });

    if (clippingEnabled) addClipPlaneMarker(viewer);
    const selectedObject = objects.find((obj) => obj.object_id === selectedId);
    if (selectedObject) addSelectionMarker(viewer, selectedObject);
  }, [clippingEnabled, hiddenObjectIds, layerState, objects, selectedId]);

  return <div className="cesium-container" ref={containerRef} />;
});

export default CesiumViewer;
