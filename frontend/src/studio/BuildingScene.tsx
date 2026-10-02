import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Viewer,
  Color,
  Cartesian3,
  Matrix3,
  Matrix4,
  Transforms,
  Quaternion,
  Math as CM,
  BoundingSphere,
  HeadingPitchRange,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  GeometryInstance,
  Primitive,
  PerInstanceColorAppearance,
  ColorGeometryInstanceAttribute,
  ShowGeometryInstanceAttribute,
  DirectionalLight,
} from "cesium";
import type { Cartesian2 } from "cesium";
import {
  BuildingDocument,
  SceneNode,
  SceneView,
  descendants,
  presentation,
} from "./model";
import { buildingColor, type BuildingColorMode } from "./buildingAppearance";
import { solidGeometry, solidCorners } from "./geometry";

export interface SceneHandle {
  reset: () => void;
  top: () => void;
  focus: () => void;
}
interface Props {
  document: BuildingDocument;
  expanded?: boolean;
  colorMode?: BuildingColorMode;
  appearanceKey?: string;
  view: SceneView;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onReady: (ready: boolean) => void;
}
interface Part {
  id: string;
  node: SceneNode;
}
interface FloorBatch {
  primitive: Primitive;
  parts: Part[];
  translucent: boolean;
}

export default forwardRef<SceneHandle, Props>(function BuildingScene(
  { document, view, selected, onSelect, onReady, expanded = false, colorMode = "material", appearanceKey },
  ref,
) {
  const container = useRef<HTMLDivElement>(null),
    viewer = useRef<Viewer | null>(null),
    batches = useRef<FloorBatch[]>([]),
    frame = useRef(Matrix4.IDENTITY.clone()),
    lookup = useRef(new Map<string, string>());
  const docRef = useRef(document),
    viewRef = useRef(view),
    selectedRef = useRef(selected),
    selectRef = useRef(onSelect),
    readyRef = useRef(onReady);
  docRef.current = document;
  viewRef.current = view;
  selectedRef.current = selected;
  selectRef.current = onSelect;
  readyRef.current = onReady;
  const appearance = useRef({ colorMode, key: appearanceKey ?? document.parameters.name });
  appearance.current = { colorMode, key: appearanceKey ?? document.parameters.name };
  const [error, setError] = useState(""),
    [distance, setDistance] = useState(0),
    center = useRef<Cartesian3>();
  function fit(top = false, selection = false) {
    const v = viewer.current;
    if (!v) return;
    const doc = docRef.current,
      state = viewRef.current,
      ids = descendants(doc, selection ? selectedRef.current : null),
      points: Cartesian3[] = [];
    for (const n of doc.nodes) {
      if (
        !n.template ||
        !n.position ||
        !presentation(n, state).visible ||
        (selection && ids.size && !ids.has(n.id))
      )
        continue;
      const offset = presentation(n, state).offset;
      for (const p of solidCorners(doc.templates[n.template], n.rotation_z)) {
        p.x += n.position[0];
        p.y += n.position[1];
        p.z += n.position[2] + offset;
        points.push(
          Matrix4.multiplyByPoint(frame.current, p, new Cartesian3()),
        );
      }
    }
    if (!points.length) return;
    const sphere = BoundingSphere.fromPoints(points);
    center.current = sphere.center;
    // Recompute the frustum after a panel resize; range 0 fits both viewport axes.
    v.resize();
    const framedSphere = new BoundingSphere(sphere.center, Math.max(sphere.radius * 1.12, 6));
    v.camera.flyToBoundingSphere(framedSphere, {
      duration: 0.6,
      offset: new HeadingPitchRange(
        CM.toRadians(doc.parameters.heading + 24),
        CM.toRadians(top ? -89 : -28),
        0,
      ),
    });
    v.scene.requestRender();
  }
  useImperativeHandle(ref, () => ({
    reset: () => fit(),
    top: () => fit(true),
    focus: () => fit(false, true),
  }));
  function applyPresentation() {
    const v = viewer.current;
    if (!v) return;
    const doc = docRef.current,
      state = viewRef.current,
      ids = descendants(doc, selectedRef.current);
    for (const batch of batches.current) {
      const sample = presentation(batch.parts[0].node, state),
        translucent = sample.alpha < 1;
      // One movable batch per semantic floor keeps geometry immutable on disk.
      batch.primitive.modelMatrix = Matrix4.multiplyByTranslation(
        frame.current,
        new Cartesian3(0, 0, sample.offset),
        new Matrix4(),
      );
      if (translucent !== batch.translucent) {
        batch.primitive.appearance = new PerInstanceColorAppearance({
          translucent,
          closed: true,
        });
        batch.translucent = translucent;
      }
      if (!batch.primitive.ready) continue;
      for (const part of batch.parts) {
        const p = presentation(part.node, state),
          attrs = batch.primitive.getGeometryInstanceAttributes(part.id);
        attrs.show = ShowGeometryInstanceAttribute.toValue(p.visible);
        const color = Color.fromCssColorString(
          buildingColor(part.node.category, doc.parameters.kind, appearance.current.key,
            appearance.current.colorMode, doc.templates[part.node.template!].color),
        );
        if (ids.has(part.node.id)) Color.lerp(color, Color.WHITE, 0.28, color);
        color.alpha = p.alpha;
        attrs.color = ColorGeometryInstanceAttribute.toValue(color);
      }
    }
    v.scene.requestRender();
  }
  useEffect(() => {
    if (!container.current) return;
    let v: Viewer;
    try {
      v = new Viewer(container.current, {
        animation: false,
        timeline: false,
        baseLayer: false,
        globe: false,
        skyBox: false,
        skyAtmosphere: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        selectionIndicator: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        shadows: false,
        scene3DOnly: true,
        msaaSamples: 1,
        useBrowserRecommendedResolution: true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "WebGL 初始化失败");
      readyRef.current(false);
      return;
    }
    viewer.current = v;
    v.scene.backgroundColor = Color.fromCssColorString("#f1f2ed");
    const control = v.scene.screenSpaceCameraController;
    control.minimumZoomDistance = 1;
    control.zoomFactor = 0.65;
    control.inertiaZoom = 0.1;
    control.maximumMovementRatio = 0.025;
    v.camera.percentageChanged = 0.002;
    const offCamera = v.camera.changed.addEventListener(() => {
      if (center.current)
        setDistance(
          Math.round(Cartesian3.distance(v.camera.positionWC, center.current)),
        );
    });
    const handler = new ScreenSpaceEventHandler(v.scene.canvas);
    handler.setInputAction((event: { position: Cartesian2 }) => {
      const id = v.scene.pick(event.position)?.id;
      selectRef.current(lookup.current.get(id) ?? null);
    }, ScreenSpaceEventType.LEFT_CLICK);
    const offError = v.scene.renderError.addEventListener(
      (_s: unknown, e: Error) => {
        setError(e.message);
        readyRef.current(false);
      },
    );
    readyRef.current(true);
    return () => {
      handler.destroy();
      offError();
      offCamera();
      v.destroy();
      viewer.current = null;
      readyRef.current(false);
    };
  }, []);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    setError("");
    for (const b of batches.current) v.scene.primitives.remove(b.primitive);
    batches.current = [];
    lookup.current.clear();
    v.entities.removeAll();
    const p = document.parameters,
      enu = Transforms.eastNorthUpToFixedFrame(
        Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude),
      );
    frame.current = Matrix4.multiplyByMatrix3(
      enu,
      Matrix3.fromRotationZ(CM.toRadians(-p.heading)),
      new Matrix4(),
    );
    const direction = Matrix4.multiplyByPointAsVector(
      frame.current,
      new Cartesian3(-0.5, 0.7, -1),
      new Cartesian3(),
    );
    v.scene.light = new DirectionalLight({
      direction: Cartesian3.normalize(direction, direction),
      intensity: 1.2,
    });
    const floors = new Map<
        number,
        { instances: GeometryInstance[]; parts: Part[] }
      >(),
      bounds: Cartesian3[] = [];
    const prefix = crypto.randomUUID();
    for (const node of document.nodes) {
      if (!node.template || !node.position) continue;
      const solid = document.templates[node.template],
        id = `${prefix}_${node.id}`,
        f = node.floor ?? 1;
      if (!floors.has(f)) floors.set(f, { instances: [], parts: [] });
      const group = floors.get(f)!;
      lookup.current.set(id, node.id);
      group.instances.push(
        new GeometryInstance({
          id,
          geometry: solidGeometry(solid, node.position, node.rotation_z),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(
              Color.fromCssColorString(
                buildingColor(node.category, document.parameters.kind, appearance.current.key, appearance.current.colorMode, solid.color),
              ),
            ),
            show: new ShowGeometryInstanceAttribute(true),
          },
        }),
      );
      group.parts.push({ id, node });
      for (const q of solidCorners(solid, node.rotation_z)) {
        q.x += node.position[0];
        q.y += node.position[1];
        q.z += node.position[2];
        bounds.push(q);
      }
    }
    for (const group of floors.values()) {
      const primitive = v.scene.primitives.add(
        new Primitive({
          geometryInstances: group.instances,
          modelMatrix: frame.current.clone(),
          appearance: new PerInstanceColorAppearance({
            translucent: false,
            closed: true,
          }),
          asynchronous: false,
        }),
      );
      batches.current.push({
        primitive,
        parts: group.parts,
        translucent: false,
      });
    }
    const minX = bounds.reduce((value, q) => Math.min(value, q.x), Infinity) - 5,
      maxX = bounds.reduce((value, q) => Math.max(value, q.x), -Infinity) + 5,
      minY = bounds.reduce((value, q) => Math.min(value, q.y), Infinity) - 5,
      maxY = bounds.reduce((value, q) => Math.max(value, q.y), -Infinity) + 5;
    v.entities.add({
      position: Matrix4.multiplyByPoint(
        frame.current,
        new Cartesian3((minX + maxX) / 2, (minY + maxY) / 2, -0.6),
        new Cartesian3(),
      ),
      orientation: Quaternion.fromRotationMatrix(
        Matrix4.getMatrix3(frame.current, new Matrix3()),
      ),
      box: {
        dimensions: new Cartesian3(maxX - minX, maxY - minY, 1),
        material: Color.fromCssColorString("#dadcd3"),
      },
    });
    const off = v.scene.postRender.addEventListener(() => {
      if (batches.current.every((b) => b.primitive.ready)) {
        applyPresentation();
        off();
      }
    });
    applyPresentation();
    fit();
    return () => off();
  }, [document]);
  useEffect(() => applyPresentation(), [view, selected, colorMode, appearanceKey]);
  useEffect(
    () => fit(),
    [view.mode, view.from, view.to, view.split, view.lift, expanded],
  );
  return (
    <div className="building-scene" role="region" aria-label="三维建筑视图">
      <div className="scene-canvas" ref={container} />
      <div className="camera-distance">视距 {distance} m · 缓速缩放</div>
      {error && (
        <div className="scene-error" role="alert">
          <strong>三维视图暂不可用</strong>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
});
