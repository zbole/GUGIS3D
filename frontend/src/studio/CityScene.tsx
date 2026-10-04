import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  Viewer,
  Color,
  Cartesian3,
  Matrix3,
  Matrix4,
  Transforms,
  Math as CM,
  BoundingSphere,
  HeadingPitchRange,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Primitive,
  HeadingPitchRoll,
  GeometryInstance,
  PerInstanceColorAppearance,
  ColorGeometryInstanceAttribute,
  ShowGeometryInstanceAttribute,
  DirectionalLight,
  LabelStyle,
  Cartesian2,
  Cartographic,
  Ellipsoid,
  VerticalOrigin,
  Entity,
  Intersect,
  ArcType,
  PolylineGeometry,
  PolylineColorAppearance,
} from "cesium";
import type { CityDocument } from "./cityModel";
import { frameCameraTarget, type CameraTarget } from "./cameraFraming";
import { validateCameraPose, type CameraPose } from "./cameraBookmark";
import type { RenderView } from "./renderTileClient";
import type { SceneHandle } from "./BuildingScene";
import { solidGeometry, solidCorners } from "./geometry";
import { hasBuildingOverview, type BuildingDocument, type SceneNode, type Solid } from "./model";
import { buildingColor, type BuildingColorMode } from "./buildingAppearance";
import { functionSolid, terrainColors, type TerrainPatch } from "./environment";
import {
  terrainSampler,
  surfaceGeometry,
  type SurfaceMesh,
} from "./terrainScene";
import { terrainLineColors, terrainTopologyPreview } from "./terrainTopology";
import type { TerrainHit } from "./terrainMath";
import { acceleratedTerrainSampler } from "./terrainRayIndex";
import { chooseRenderBuildings, chooseRenderDetails, renderBudget } from "./renderBudget";
import { createPathLocator, type AnalysisPoint, type PathAnalysis } from "./terrainAnalysis";

const noAnalysisPoints: AnalysisPoint[] = [];

export interface GeographicPosition {
  longitude: number;
  latitude: number;
}
export interface CitySceneHandle extends SceneHandle {
  centerPosition: () => GeographicPosition | null;
  getCameraPose: () => CameraPose | null;
  setCameraPose: (pose: CameraPose) => boolean;
  focusFeature: (id: string) => void;
  focusBuilding: (id: string) => void;
}
export type CameraViewRequest = { sequence: string } & ({ pose: CameraPose } | { target: CameraTarget });
interface Props {
  city: Pick<CityDocument, "assets" | "instances" | "roads" | "environment">;
  center?: GeographicPosition;
  selected: string | null;
  onSelect: (id: string | null) => void;
  context: boolean;
  placement?: GeographicPosition & { altitude: number };
  placementKind?: "building" | "feature";
  placing?: boolean;
  onPlace?: (position: GeographicPosition | null) => void;
  terrainOpacity?: number;
  terrainWire?: boolean;
  terrainMeshes?: Partial<Record<TerrainPatch['kind'],SurfaceMesh>>;
  scenePurpose?: 'city' | 'research';
  queryTerrain?: boolean;
  terrainRayIndexed?: boolean;
  onTerrainQuery?: (hit: TerrainHit | null) => void;
  onFeatureSelect?: (id: string) => void;
  selectedFeature?: string | null;
  featureLayer?: "all" | "surface" | "underground";
  isolateFeature?: boolean;
  showFeatureMarkers?: boolean;
  colorMode?: BuildingColorMode;
  fullDetails?: boolean;
  onRetry?: () => void;
  analysisDrawing?: boolean;
  analysisPoints?: AnalysisPoint[];
  analysisProfile?: PathAnalysis | null;
  analysisHover?: AnalysisPoint | null;
  onAnalysisPoint?: (point: AnalysisPoint | null) => void;
  spatialPicking?: boolean;
  spatialPoint?: AnalysisPoint | null;
  /** Read-only viewport loading; never modifies editor city state. */
  onViewBounds?: (view: RenderView, cameraSequence?: string) => void;
  cameraRequest?: CameraViewRequest;
  showGround?: boolean;
  renderOnly?: boolean;
  onSpatialPoint?: (point: AnalysisPoint | null, picked: string | null) => void;
}
interface DetailedBuilding {
  batch: Primitive;
  document: BuildingDocument;
  nodes: SceneNode[];
  asset: string;
  context: boolean;
  ready: boolean;
  needsStyle: boolean;
}
export default forwardRef<CitySceneHandle, Props>(function CityScene(
  {
    city,
    center = { longitude: -2.603, latitude: 51.454 },
    selected,
    onSelect,
    context,
    placement,
    placementKind = "building",
    placing = false,
    onPlace,
    terrainOpacity = 1,
    terrainWire = false,
    terrainMeshes,
    scenePurpose = 'city',
    queryTerrain = false,
    terrainRayIndexed = false,
    onTerrainQuery,
    onFeatureSelect,
    selectedFeature,
    featureLayer = "all",
    isolateFeature = false,
    showFeatureMarkers = true,
    colorMode = "material",
    fullDetails = true,
    onRetry,
    analysisDrawing = false,
    analysisPoints = noAnalysisPoints,
    analysisProfile = null,
    analysisHover = null,
    onAnalysisPoint,
    spatialPicking = false,
    spatialPoint = null,
    onSpatialPoint,
    onViewBounds,
    cameraRequest,
    showGround = true,
    renderOnly = false,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null),
    viewer = useRef<Viewer | null>(null),
    batches = useRef<Primitive[]>([]),
    detailedBuildings = useRef(new Map<string, DetailedBuilding>()),
    spheres = useRef(new Map<string, BoundingSphere>()),
    bounds = useRef<BoundingSphere>(),
    selection = useRef(selected),
    contextRef = useRef(context),
    pick = useRef(onSelect),
    placementClick = useRef({ placing, onPlace }),
    environmentClick = useRef({
      queryTerrain,
      onTerrainQuery,
      onFeatureSelect,
    }),
    terrainBatches = useRef<Primitive[]>([]),
    featureSpheres = useRef(new Map<string, BoundingSphere>()),
    featureBatch = useRef<Primitive | null>(null),
    initialized = useRef(false),
    renderFailed = useRef(false),
    parts = useRef<
      { batch: Primitive; id: string; cityId: string; category: SceneNode["category"]; kind: BuildingDocument["parameters"]["kind"]; asset: string; fallback: string; overview: boolean }[]
    >([]);
  const viewportTimer = useRef<ReturnType<typeof setTimeout>>();
  const reportViewport = useRef<(() => void) | null>(null);
  const cameraSequence = useRef<string>();
  const viewBoundsRef = useRef(onViewBounds);
  viewBoundsRef.current = onViewBounds;
  const coarseResidents = useRef(new Set<string>());
  const refreshCoarse = useRef<(() => void) | null>(null);
  const refreshDetails = useRef<(() => void) | null>(null);
  const [renderProgress, setRenderProgress] = useState({ buildings: 0, components: 0 });
  const colorModeRef = useRef(colorMode);
  const analysisClick = useRef({ analysisDrawing, onAnalysisPoint });
  analysisClick.current = { analysisDrawing, onAnalysisPoint };
  const spatialClick = useRef({ spatialPicking, onSpatialPoint });
  spatialClick.current = { spatialPicking, onSpatialPoint };
  const lastStyle = useRef({ selected: null as string | null, colorMode });
  const [detailProgress, setDetailProgress] = useState({ ready: 0, total: 0, components: 0, footprints: 0 });
  colorModeRef.current = colorMode;
  const [error, setError] = useState(""),
    [distance, setDistance] = useState(0);
  const [topologyNotice, setTopologyNotice] = useState("");
  const terrain = city.environment?.terrain;
  const surfaceColors = scenePurpose==='research'
    ? {'ruled-strip':'#63b7a7','triangle-strip':'#aabac6','triangle-fan':'#8f86b0'}
    : terrainColors;
  const drapeBuildings = city.environment?.drape_buildings;
  const features = city.environment?.features;
  const featureAssets = city.environment?.feature_assets;
  const sampler = useMemo(() => terrainSampler(terrain), [terrain]);
  const raySampler = useMemo(() => terrainRayIndexed ? acceleratedTerrainSampler(terrain,'hierarchy') : sampler,
    [sampler,terrain,terrainRayIndexed]);
  const raySampleRef = useRef(raySampler);
  raySampleRef.current = raySampler;
  const sampleRef = useRef(sampler);
  sampleRef.current = sampler;
  selection.current = selected;
  contextRef.current = context;
  pick.current = onSelect;
  placementClick.current = { placing, onPlace };
  environmentClick.current = { queryTerrain, onTerrainQuery, onFeatureSelect };
  function groundPosition(point: Cartesian2): GeographicPosition | null {
    const position = analysisPosition(point);
    // Placement altitude is user-defined and may already be draped; do not
    // accidentally add the terrain elevation a second time when choosing XY.
    return position ? { longitude: position.longitude, latitude: position.latitude } : null;
  }
  function analysisPosition(point: Cartesian2): AnalysisPoint | null {
    const v = viewer.current;
    const ray = v?.camera.getPickRay(point);
    const position = (ray && raySampleRef.current?.ray(ray)?.position) ??
      v?.camera.pickEllipsoid(point, Ellipsoid.WGS84);
    if (!position) return null;
    const geographic = Cartographic.fromCartesian(position);
    const latitude = CM.toDegrees(geographic.latitude);
    if (Math.abs(latitude) > 85) return null;
    return {
      longitude: Number(CM.toDegrees(geographic.longitude).toFixed(7)),
      latitude: Number(latitude.toFixed(7)),
      altitude: geographic.height,
    };
  }
  function finiteFootprint() {
    const rectangle = viewer.current?.camera.computeViewRectangle(Ellipsoid.WGS84);
    if (!rectangle) return null;
    const values = [rectangle.west, rectangle.south, rectangle.east, rectangle.north].map(CM.toDegrees);
    return values.every(Number.isFinite) && Math.abs(values[0]) <= 180 && Math.abs(values[2]) <= 180 &&
      values[1] >= -90 && values[3] <= 90 && values[1] <= values[3] ? values as [number, number, number, number] : null;
  }
  function setCameraPose(pose: CameraPose): boolean {
    const v = viewer.current, checked = validateCameraPose(pose);
    if (!v || v.isDestroyed() || !checked) return false;
    if (viewportTimer.current !== undefined) clearTimeout(viewportTimer.current);
    v.camera.cancelFlight();
    v.camera.setView({ destination: Cartesian3.fromDegrees(checked[0], checked[1], checked[2]),
      orientation: { heading: CM.toRadians(checked[3]), pitch: CM.toRadians(checked[4]), roll: CM.toRadians(checked[5]) } });
    finishCameraChange(v);
    return true;
  }
  function finishCameraChange(v: Viewer) {
    initialized.current = true; // Initial framing and later tile arrivals cannot override restoration.
    v.scene.requestRender();
    // setView may synchronously raise changed, scheduling another report.
    if (viewportTimer.current !== undefined) clearTimeout(viewportTimer.current);
    viewportTimer.current = setTimeout(() => reportViewport.current?.(), 180);
  }
  function setCameraTarget(target: CameraTarget) {
    const v = viewer.current;
    if (!v || v.isDestroyed()) return;
    if (viewportTimer.current !== undefined) clearTimeout(viewportTimer.current);
    v.camera.cancelFlight();
    frameCameraTarget(v.camera, target);
    finishCameraChange(v);
  }
  function fit(top = false, focus = false) {
    const v = viewer.current,
      s =
        (focus && selection.current
          ? spheres.current.get(selection.current)
          : bounds.current) ?? bounds.current;
    if (v && s)
      v.camera.flyToBoundingSphere(scenePurpose==='research'?new BoundingSphere(s.center,s.radius*1.15):s, {
        duration: 0.6,
        offset: new HeadingPitchRange(
          CM.toRadians(18),
          CM.toRadians(top ? -89 : -45),
          scenePurpose==='research'?0:Math.max(s.radius * (focus ? 3.3 : 2.7), 40),
        ),
      });
  }
  useImperativeHandle(ref, () => ({
    getCameraPose: () => {
      const v = viewer.current;
      if (!v || v.isDestroyed() || !finiteFootprint()) return null;
      const p = v.camera.positionCartographic;
      return validateCameraPose([CM.toDegrees(p.longitude), CM.toDegrees(p.latitude), p.height,
        CM.toDegrees(v.camera.heading), CM.toDegrees(v.camera.pitch), CM.toDegrees(v.camera.roll)]);
    },
    setCameraPose,
    reset: () => fit(),
    focus: () => fit(false, true),
    top: () => fit(true),
    focusFeature: (id: string) => {
      const v = viewer.current,
        s = featureSpheres.current.get(id);
      if (v && s)
        v.camera.flyToBoundingSphere(s, {
          duration: 0.6,
          offset: new HeadingPitchRange(
            CM.toRadians(18),
            CM.toRadians(-40),
            Math.max(25, s.radius * 3.5),
          ),
        });
    },
    focusBuilding: (id: string) => {
      const v = viewer.current, s = spheres.current.get(id);
      if (v && s) v.camera.flyToBoundingSphere(s, {
        duration: .6, offset: new HeadingPitchRange(CM.toRadians(18), CM.toRadians(-42), Math.max(32, s.radius * 3.4)),
      });
    },
    centerPosition: () => {
      const canvas = viewer.current?.scene.canvas;
      return canvas
        ? groundPosition(
            new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
          )
        : null;
    },
  }));
  function highlight() {
    for (const p of parts.current) {
      if (!p.batch.ready) continue;
      const attrs = p.batch.getGeometryInstanceAttributes(p.id);
      if (attrs) {
        const color = Color.fromCssColorString(buildingColor(p.category, p.kind, p.asset, colorModeRef.current, p.fallback));
        if (p.cityId === selection.current)
          Color.lerp(color, Color.WHITE, 0.16, color);
        attrs.color = ColorGeometryInstanceAttribute.toValue(color);
        attrs.show = ShowGeometryInstanceAttribute.toValue(
          (contextRef.current || !["urban", "footprint"].includes(p.kind) || p.cityId === selection.current) &&
          !(p.overview && detailedBuildings.current.get(p.cityId)?.ready),
        );
      }
    }
    for (const [id, detail] of detailedBuildings.current) {
      if (!detail.batch.ready) continue;
      detail.batch.show = !detail.context || contextRef.current || id === selection.current;
      if (!detail.needsStyle && lastStyle.current.colorMode === colorModeRef.current &&
        id !== selection.current && id !== lastStyle.current.selected) continue;
      for (const node of detail.nodes) {
        const attrs = detail.batch.getGeometryInstanceAttributes(`${id}/${node.id}`);
        if (!attrs) continue;
        const color = Color.fromCssColorString(buildingColor(node.category, detail.document.parameters.kind,
          detail.asset, colorModeRef.current, detail.document.templates[node.template!].color));
        if (id === selection.current) Color.lerp(color, Color.WHITE, 0.12, color);
        attrs.color = ColorGeometryInstanceAttribute.toValue(color);
      }
      detail.needsStyle = false;
    }
    lastStyle.current = { selected: selection.current, colorMode: colorModeRef.current };
    viewer.current?.scene.requestRender();
  }
  useEffect(() => {
    if (!host.current) return;
    let v: Viewer;
    try { v = new Viewer(host.current, {
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
      scene3DOnly: true,
      msaaSamples: 1,
      targetFrameRate: 30,
      useBrowserRecommendedResolution: true,
      showRenderLoopErrors: false,
    }); } catch (e) {
      renderFailed.current = true;
      setError(e instanceof Error ? e.message : "无法启动三维视图");
      return;
    }
    viewer.current = v;
    // Avoid the extra depth-only render during camera/pick interaction. Native
    // terrain ray queries below also work when terrain is transparent or hidden.
    v.scene.pickTranslucentDepth = false;
    renderFailed.current = false;
    initialized.current = false;
    v.scene.backgroundColor = Color.fromCssColorString("#f1f2ed");
    const controller = v.scene.screenSpaceCameraController;
    controller.zoomFactor = 0.65;
    controller.inertiaZoom = 0.1;
    controller.maximumMovementRatio = 0.025;
    controller.minimumZoomDistance = 2;
    const click = new ScreenSpaceEventHandler(v.scene.canvas);
    click.setInputAction((e: { position: Cartesian2 }) => {
      if (spatialClick.current.spatialPicking) {
        const picked = v.scene.pick(e.position)?.id;
        const id = typeof picked === "string" ? picked : picked?.id;
        spatialClick.current.onSpatialPoint?.(analysisPosition(e.position), typeof id === "string" ? id : null);
        return;
      }
      if (analysisClick.current.analysisDrawing) {
        analysisClick.current.onAnalysisPoint?.(analysisPosition(e.position));
        return;
      }
      if (placementClick.current.placing) {
        placementClick.current.onPlace?.(groundPosition(e.position));
        return;
      }
      if (environmentClick.current.queryTerrain) {
        const ray = v.camera.getPickRay(e.position);
        environmentClick.current.onTerrainQuery?.(ray ? raySampleRef.current?.ray(ray)?.hit ?? null : null);
        return;
      }
      const picked = v.scene.pick(e.position)?.id;
      const id = typeof picked === "string" ? picked : picked?.id;
      if (typeof id === "string" && id.startsWith("feature:")) {
        environmentClick.current.onFeatureSelect?.(id.slice(8).split("/")[0]);
        return;
      }
      const buildingId = typeof id === "string" ? id.split("/")[0] : "";
      pick.current(spheres.current.has(buildingId) ? buildingId : null);
    }, ScreenSpaceEventType.LEFT_CLICK);
    // Avoid React state updates on every frame of a drag or wheel gesture.
    v.camera.percentageChanged = 0.01;
    const offError = v.scene.renderError.addEventListener(
      (_s: unknown, e: Error) => { renderFailed.current = true; setError(e.message); },
    );
    return () => {
      if (viewportTimer.current !== undefined) clearTimeout(viewportTimer.current);
      v.camera.cancelFlight();
      click.destroy();
      offError();
      v.destroy();
      viewer.current = null;
    };
  }, []);
  useEffect(() => {
    cameraSequence.current = cameraRequest?.sequence;
    if (cameraRequest) {
      if ("pose" in cameraRequest) setCameraPose(cameraRequest.pose);
      else setCameraTarget(cameraRequest.target);
    }
  }, [cameraRequest?.sequence]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !onViewBounds) return;
    const report = () => {
      if (v.isDestroyed()) return;
      const footprint = finiteFootprint();
      const position = groundPosition(new Cartesian2(v.scene.canvas.clientWidth / 2, v.scene.canvas.clientHeight / 2));
      // A missing ellipsoid footprint (e.g. horizon view) includes all candidates
      // conservatively; the loader still enforces tile and byte residency caps.
      viewBoundsRef.current?.({ bounds: footprint, center: position ?? center }, cameraSequence.current);
    };
    reportViewport.current = report;
    const schedule = () => { if (viewportTimer.current !== undefined) clearTimeout(viewportTimer.current); viewportTimer.current = setTimeout(report, 180); };
    const offChange = v.camera.changed.addEventListener(schedule);
    const offEnd = v.camera.moveEnd.addEventListener(schedule);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(v.scene.canvas);
    schedule();
    return () => { if (viewportTimer.current !== undefined) clearTimeout(viewportTimer.current); reportViewport.current = null; offChange(); offEnd(); resize?.disconnect(); };
  }, [!!onViewBounds, center.longitude, center.latitude]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || renderFailed.current) return;
    const entities: Entity[] = [];
    const add = (options: Entity.ConstructorOptions) => entities.push(v.entities.add(options));
    const position = (p: AnalysisPoint) => Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude + 0.25);
    analysisPoints.forEach((point, i) => add({
      id: `analysis:vertex:${i}`, position: position(point),
      point: { pixelSize: 9, color: Color.fromCssColorString("#1d7166"), outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Infinity },
      label: { text: String(i + 1), font: "12px sans-serif", fillColor: Color.fromCssColorString("#154d45"), showBackground: true, backgroundColor: Color.WHITE.withAlpha(.9), pixelOffset: new Cartesian2(0, -20), disableDepthTestDistance: Infinity },
    }));
    if (analysisPoints.length > 1) add({
      id: "analysis:control-path", polyline: { positions: analysisPoints.map(position), width: 2, material: Color.fromCssColorString("#be9656"), arcType: ArcType.NONE },
    });
    let segment: Cartesian3[] = [], count = 0;
    const flush = () => {
      if (segment.length > 1) add({ id: `analysis:surface:${count++}`, polyline: { positions: segment, width: 4, material: Color.fromCssColorString("#167d72"), arcType: ArcType.NONE } });
      segment = [];
    };
    const locate = createPathLocator(analysisPoints, terrain);
    for (const sample of analysisProfile?.samples ?? []) {
      if (sample.gapBefore || sample.height === null) flush();
      if (sample.height === null) continue;
      const point = locate(sample.distance);
      if (point) segment.push(position({ ...point, altitude: sample.height - (terrain?.reference_height ?? 0) }));
    }
    flush();
    v.scene.requestRender();
    return () => { if (!v.isDestroyed()) { for (const e of entities) v.entities.remove(e); v.scene.requestRender(); } };
  }, [analysisPoints, analysisProfile, terrain]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || renderFailed.current || !analysisHover) return;
    const marker = v.entities.add({
      id: "analysis:hover", position: Cartesian3.fromDegrees(analysisHover.longitude, analysisHover.latitude, analysisHover.altitude + .4),
      point: { pixelSize: 14, color: Color.fromCssColorString("#efbd5d"), outlineColor: Color.WHITE, outlineWidth: 3, disableDepthTestDistance: Infinity },
    });
    v.scene.requestRender();
    return () => { if (!v.isDestroyed()) { v.entities.remove(marker); v.scene.requestRender(); } };
  }, [analysisHover]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || renderFailed.current || !spatialPoint) return;
    const marker = v.entities.add({ id: "spatial:query-point",
      position: Cartesian3.fromDegrees(spatialPoint.longitude, spatialPoint.latitude, spatialPoint.altitude + .5),
      point: { pixelSize: 12, color: Color.fromCssColorString("#b35d38"), outlineColor: Color.WHITE,
        outlineWidth: 2, disableDepthTestDistance: Infinity },
      label: { text: "联合查询", font: "11px sans-serif", fillColor: Color.fromCssColorString("#7d3b24"),
        showBackground: true, backgroundColor: Color.WHITE.withAlpha(.92), pixelOffset: new Cartesian2(0, -21), disableDepthTestDistance: Infinity },
    });
    v.scene.requestRender();
    return () => { if (!v.isDestroyed()) { v.entities.remove(marker); v.scene.requestRender(); } };
  }, [spatialPoint]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (!renderFailed.current) setError("");
    // Each effect owns its entities; a building edit must preserve terrain wires
    // and feature markers managed by independent effects.
    const ownedEntities: Entity[] = [];
    const addEntity = (options: Entity.ConstructorOptions) => {
      const entity = v.entities.add(options);
      ownedEntities.push(entity);
      return entity;
    };
    spheres.current.clear();
    parts.current = [];
    batches.current = [];
    const allPoints: Cartesian3[] = [];
    const lightFrame = Transforms.eastNorthUpToFixedFrame(
      Cartesian3.fromDegrees(center.longitude, center.latitude),
    );
    const direction = Matrix4.multiplyByPointAsVector(
      lightFrame, new Cartesian3(-0.5, 0.7, -1), new Cartesian3(),
    );
    v.scene.light = new DirectionalLight({ direction: Cartesian3.normalize(direction, direction), intensity: 1.1 });
    // Compute a lightweight local envelope once per asset. Geometry creation is
    // deferred until the placement passes the viewport and residency budgets.
    const assetBounds = new Map<BuildingDocument, BoundingSphere>();
    const assetNodes = new Map<BuildingDocument, SceneNode[]>();
    const frames = new Map<string, Matrix4>();
    const byId = new Map(city.instances.map(item => [item.id, item]));
    for (const item of city.instances) {
      const doc = city.assets[item.asset];
      const overview = hasBuildingOverview(doc) ? doc.overview : undefined;
      let renderNodes = assetNodes.get(doc);
      if (!renderNodes) {
        renderNodes = overview ? Object.keys(overview).map(key => ({
          id: `overview_${key}`, name: key, category: key === "roof" ? "roof" : "wall",
          template: key, position: [0, 0, 0],
        })) : doc.nodes.filter(node => node.template && node.position);
        assetNodes.set(doc, renderNodes);
        const points: Cartesian3[] = [];
        // Use the authored overview, or every real component for an empty
        // overview. A bounding box never replaces a building's actual footprint.
        for (const node of renderNodes) {
          const solid = (overview ?? doc.templates)[node.template!];
          for (const p of solidCorners(solid, node.rotation_z ?? 0))
            points.push(Cartesian3.add(p, new Cartesian3(...node.position!), p));
        }
        assetBounds.set(doc, BoundingSphere.fromPoints(points));
      }
      const frame = Matrix4.multiplyByMatrix3(
        Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(item.longitude, item.latitude,
          item.altitude + (drapeBuildings ? (sampler?.height(item.longitude, item.latitude) ?? 0) : 0))),
        Matrix3.fromRotationZ(CM.toRadians(-item.heading)), new Matrix4());
      frames.set(item.id, frame);
      const sphere = BoundingSphere.transform(assetBounds.get(doc)!, frame, new BoundingSphere());
      spheres.current.set(item.id, sphere);
      allPoints.push(
        Cartesian3.add(sphere.center, new Cartesian3(sphere.radius, sphere.radius, sphere.radius), new Cartesian3()),
        Cartesian3.subtract(sphere.center, new Cartesian3(sphere.radius, sphere.radius, sphere.radius), new Cartesian3()),
      );
      if (["wills", "cabot", "cathedral"].includes(doc.parameters.kind)) addEntity({
        id: `landmark/${item.id}`,
        position: Cartesian3.fromDegrees(item.longitude, item.latitude,
          item.altitude + 70 * (doc.parameters.scale ?? 1) + (drapeBuildings ? (sampler?.height(item.longitude, item.latitude) ?? 0) : 0)),
        label: {
          text: item.name, font: "13px sans-serif", fillColor: Color.fromCssColorString("#354c40"),
          outlineColor: Color.WHITE, outlineWidth: 1, style: LabelStyle.FILL_AND_OUTLINE,
          showBackground: true, backgroundColor: Color.WHITE.withAlpha(0.9), pixelOffset: new Cartesian2(0, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    type Chunk = { batch: Primitive; ids: string[]; parts: typeof parts.current };
    const chunks = new Map<number, Chunk>();
    const slots = new Map<string, number>();
    const sharedGeometry = new Map<Solid, ReturnType<typeof solidGeometry>>();
    let active = true, pendingStyle = false;
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    function refresh() {
      if (!active || v!.isDestroyed() || renderFailed.current) return;
      const camera = v!.camera;
      const culling = camera.frustum.computeCullingVolume(camera.positionWC, camera.directionWC, camera.upWC);
      const desired = chooseRenderBuildings(city.instances.map(item => {
        const doc = city.assets[item.asset], sphere = spheres.current.get(item.id)!;
        return { id: item.id, components: assetNodes.get(doc)!.length,
          distance: Math.max(0, Cartesian3.distance(camera.positionWC, sphere.center) - sphere.radius),
          visible: (contextRef.current || !["urban", "footprint"].includes(doc.parameters.kind)) &&
            culling.computeVisibility(sphere) !== Intersect.OUTSIDE };
      }), coarseResidents.current, selection.current);
      // Stable slots bound coarse draw batches as well as instances, regardless
      // of archive ordering. A small pan only rebuilds the changed batches.
      for (const id of slots.keys()) if (!desired.has(id)) slots.delete(id);
      const occupied = new Set(slots.values());
      let slot = 0;
      for (const id of desired) {
        if (slots.has(id)) continue;
        while (occupied.has(slot)) slot++;
        slots.set(id, slot); occupied.add(slot);
      }
      const groups = new Map<number, string[]>();
      for (const [id, index] of [...slots].sort((a, b) => a[1] - b[1])) {
        const key = Math.floor(index / renderBudget.batchBuildings);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(id);
      }
      for (const [key, chunk] of chunks) {
        const ids = groups.get(key);
        if (ids && ids.length === chunk.ids.length && ids.every((id, i) => chunk.ids[i] === id)) continue;
        v!.scene.primitives.remove(chunk.batch);
        chunks.delete(key);
      }
      for (const [key, ids] of groups) {
        if (chunks.has(key)) continue;
        const instances: GeometryInstance[] = [];
        const metadata: Omit<(typeof parts.current)[number], "batch">[] = [];
        for (const id of ids) {
          const item = byId.get(id)!, doc = city.assets[item.asset];
          const overview = hasBuildingOverview(doc) ? doc.overview : undefined;
          for (const node of assetNodes.get(doc)!) {
            const solid = (overview ?? doc.templates)[node.template!];
            let geometry = sharedGeometry.get(solid);
            if (!geometry) { geometry = solidGeometry(solid); sharedGeometry.set(solid, geometry); }
            const transform = Matrix4.multiplyByMatrix3(
              Matrix4.multiplyByTranslation(frames.get(id)!, new Cartesian3(...node.position!), new Matrix4()),
              Matrix3.fromRotationZ(CM.toRadians(node.rotation_z ?? 0)), new Matrix4());
            const partId = `${id}/${node.id}`;
            instances.push(new GeometryInstance({ id: partId, geometry, modelMatrix: transform, attributes: {
              color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(
                buildingColor(node.category, doc.parameters.kind, item.asset, colorModeRef.current, solid.color))),
              show: new ShowGeometryInstanceAttribute(true),
            } }));
            metadata.push({ id: partId, cityId: id, category: node.category, kind: doc.parameters.kind,
              asset: item.asset, fallback: solid.color, overview: !!overview });
          }
        }
        const batch = v!.scene.primitives.add(new Primitive({ geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({ translucent: false, closed: true }),
          asynchronous: false, releaseGeometryInstances: true }));
        chunks.set(key, { batch, ids, parts: metadata.map(p => ({ ...p, batch })) });
        pendingStyle = true;
      }
      // A tour must not accumulate cached CPU mesh buffers for evicted buildings.
      const used = new Set<Solid>();
      for (const id of desired) {
        const doc = city.assets[byId.get(id)!.asset];
        const solids = hasBuildingOverview(doc) ? doc.overview : doc.templates;
        for (const node of assetNodes.get(doc)!) used.add(solids[node.template!]);
      }
      for (const solid of sharedGeometry.keys()) if (!used.has(solid)) sharedGeometry.delete(solid);
      coarseResidents.current = desired;
      batches.current = [...chunks.values()].map(chunk => chunk.batch);
      parts.current = [...chunks.values()].flatMap(chunk => chunk.parts);
      const count = parts.current.length;
      setRenderProgress(previous => previous.buildings === desired.size && previous.components === count
        ? previous : { buildings: desired.size, components: count });
      if (bounds.current) setDistance(Math.round(Cartesian3.distance(camera.positionWC, bounds.current.center)));
      highlight();
      refreshDetails.current?.();
      v!.scene.requestRender();
    }
    const schedule = () => {
      if (cameraTimer !== undefined) clearTimeout(cameraTimer);
      cameraTimer = setTimeout(refresh, 180);
    };
    const offCamera = v.camera.changed.addEventListener(schedule);
    const offMove = v.camera.moveEnd.addEventListener(schedule);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(v.scene.canvas);
    const off = v.scene.postRender.addEventListener(() => {
      if (pendingStyle && batches.current.every(batch => batch.ready)) { pendingStyle = false; highlight(); }
    });
    refreshCoarse.current = refresh;
    refresh();
    if (terrain && sampler) {
      const min = terrain.points.reduce(
        (a, p) => [
          Math.min(a[0], p[0]),
          Math.min(a[1], p[1]),
          Math.min(a[2], p[2]),
        ],
        [Infinity, Infinity, Infinity],
      );
      const max = terrain.points.reduce(
        (a, p) => [
          Math.max(a[0], p[0]),
          Math.max(a[1], p[1]),
          Math.max(a[2], p[2]),
        ],
        [-Infinity, -Infinity, -Infinity],
      );
      for (const x of [min[0], max[0]])
        for (const y of [min[1], max[1]])
          for (const z of scenePurpose==='research'?[min[2],max[2]]:[max[2]])
          allPoints.push(
            Matrix4.multiplyByPoint(
              sampler.frame,
              new Cartesian3(x, y, z - terrain.reference_height),
              new Cartesian3(),
            ),
          );
    }
    bounds.current = allPoints.length
      ? BoundingSphere.fromPoints(allPoints)
      : new BoundingSphere(Cartesian3.fromDegrees(center.longitude, center.latitude), 300);
    // A flat local ground plane keeps context offline and avoids inventing terrain elevations.
    const inverse = Matrix4.inverse(lightFrame, new Matrix4());
    let minX = -300, maxX = 300, minY = -300, maxY = 300;
    const localPoint = new Cartesian3();
    for (const point of allPoints) {
      Matrix4.multiplyByPoint(inverse, point, localPoint);
      minX = Math.min(minX, localPoint.x); maxX = Math.max(maxX, localPoint.x);
      minY = Math.min(minY, localPoint.y); maxY = Math.max(maxY, localPoint.y);
    }
    minX -= 30; maxX += 30; minY -= 30; maxY += 30;
    const groundHeight = terrain
      ? terrain.points.reduce(
          (min, p) => Math.min(min, p[2] - terrain.reference_height),
          Infinity,
        ) - 3
      : -1.5;
    addEntity({
      id: "city-ground-plane",
      show: showGround && (!terrain || terrainOpacity >= 0.99),
      position: Matrix4.multiplyByPoint(
        lightFrame,
        new Cartesian3((minX + maxX) / 2, (minY + maxY) / 2, groundHeight),
        new Cartesian3(),
      ),
      box: {
        dimensions: new Cartesian3(maxX - minX, maxY - minY, 2),
        material: Color.fromCssColorString("#c8cebd"),
      },
      orientation: Transforms.headingPitchRollQuaternion(
        Cartesian3.fromDegrees(center.longitude, center.latitude),
        new HeadingPitchRoll(0, 0, 0),
      ),
    });
    let extraRoadPoints = 0;
    for (const road of city.roads) {
      // Keep only consecutive in-bounds segments; long OSM ways may leave the study area.
      let segment: Cartesian3[] = [];
      let index = 0;
      const flush = () => {
        if (segment.length > 1)
          addEntity({
            id: `road_${crypto.randomUUID()}_${road.id}_${index++}`,
            polyline: {
              positions: segment,
              width: road.width,
              material: Color.fromCssColorString("#edf0eb"),
            },
          });
        segment = [];
      };
      const coordinates = road.coordinates.flatMap((p, i) => {
        if (!i || !sampler) return [p];
        const a = road.coordinates[i - 1];
        if (
          extraRoadPoints >= 200000 ||
          (!sampler.at(...p) && !sampler.at(...a))
        )
          return [p];
        const n = Math.min(
          512,
          Math.max(
            1,
            Math.ceil(
              Math.hypot((p[0] - a[0]) * 70000, (p[1] - a[1]) * 111000) / 12,
            ),
          ),
        );
        extraRoadPoints += n - 1;
        return Array.from(
          { length: n },
          (_, j) =>
            [
              a[0] + ((p[0] - a[0]) * (j + 1)) / n,
              a[1] + ((p[1] - a[1]) * (j + 1)) / n,
            ] as [number, number],
        );
      });
      for (const [lon, lat] of coordinates) {
        const p = Cartesian3.fromDegrees(
            lon,
            lat,
            (sampler?.height(lon, lat) ?? 0) + 0.22,
          ),
          q = Matrix4.multiplyByPoint(inverse, p, new Cartesian3());
        if (q.x >= minX && q.x <= maxX && q.y >= minY && q.y <= maxY)
          segment.push(p);
        else flush();
      }
      flush();
    }
    // Editing city data must not move the camera. Frame only a new viewer.
    if (!initialized.current) {
      fit();
      initialized.current = true;
    }
    setDistance(
      Math.round(
        Cartesian3.distance(v.camera.positionWC, bounds.current.center),
      ),
    );
    v.scene.requestRender();
    return () => {
      active = false;
      if (cameraTimer !== undefined) clearTimeout(cameraTimer);
      off(); offCamera(); offMove(); resize?.disconnect();
      if (refreshCoarse.current === refresh) refreshCoarse.current = null;
      coarseResidents.current = new Set();
      if (!v.isDestroyed()) {
        for (const entity of ownedEntities) v.entities.remove(entity);
        for (const chunk of chunks.values()) v.scene.primitives.remove(chunk.batch);
      }
    };
  }, [
    city.instances,
    center.longitude,
    center.latitude,
    scenePurpose,
    city.assets,
    city.roads,
    showGround,
    terrain,
    sampler,
    drapeBuildings,
  ]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (!renderFailed.current) setError("");
    const owned = new Map<string, DetailedBuilding>();
    detailedBuildings.current = owned;
    const candidates = city.instances.filter(item => hasBuildingOverview(city.assets[item.asset]));
    const permanent = new Set(city.instances.filter(item => !hasBuildingOverview(city.assets[item.asset])).map(item => item.id));
    const assetCounts = new Map(Object.values(city.assets).map(doc => [doc,
      doc.nodes.filter(node => node.template && node.position).length]));
    const componentCounts = new Map(city.instances.map(item => [item.id, assetCounts.get(city.assets[item.asset])!]));
    const footprints = new Set(city.instances.filter(item => city.assets[item.asset].parameters.kind === "footprint").map(item => item.id));
    const byId = new Map(candidates.map(item => [item.id, item]));
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    let queue: typeof candidates = [], desired = new Set<string>(), reported = "";
    const reportReady = () => {
      if (!active || renderFailed.current) return;
      // Per-frame accounting is bounded by resident buildings, not city size.
      const retained = [...coarseResidents.current].filter(id => permanent.has(id) && !footprints.has(id));
      const footprintCount = [...coarseResidents.current].filter(id => footprints.has(id)).length;
      let changed = false, ready = retained.length;
      let components = retained.reduce((sum, id) => sum + componentCounts.get(id)!, 0);
      for (const [id, detail] of owned) {
        if (!detail.ready && detail.batch.ready) { detail.ready = true; changed = true; }
        if (detail.ready && !footprints.has(id)) { ready++; components += detail.nodes.length; }
      }
      if (changed) highlight();
      const total = retained.length + [...desired].filter(id => !footprints.has(id)).length;
      const signature = `${ready}/${total}/${components}/${footprintCount}`;
      if (reported !== signature) {
        reported = signature;
        setDetailProgress({ ready, total, components, footprints: footprintCount });
      }
    };
    const off = v.scene.postRender.addEventListener(reportReady);
    function pump() {
      if (!active || !fullDetails || renderFailed.current || v!.isDestroyed()) return;
      try {
        // Upload at most one building between frames; camera motion reprioritizes
        // this queue, so off-screen requests never complete in the background.
        const item = queue.shift();
        if (item) {
          const doc = city.assets[item.asset];
          const geometries = new WeakMap<Solid, ReturnType<typeof solidGeometry>>();
          const frame = Matrix4.multiplyByMatrix3(
            Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(item.longitude, item.latitude,
              item.altitude + (drapeBuildings ? (sampler?.height(item.longitude, item.latitude) ?? 0) : 0))),
            Matrix3.fromRotationZ(CM.toRadians(-item.heading)), new Matrix4());
          const nodes = doc.nodes.filter(node => node.template && node.position);
          const instances = nodes.map(node => {
            const solid = doc.templates[node.template!];
            let geometry = geometries.get(solid);
            if (!geometry) { geometry = solidGeometry(solid); geometries.set(solid, geometry); }
            const local = Matrix4.multiplyByMatrix3(
              Matrix4.fromTranslation(new Cartesian3(...node.position!)),
              Matrix3.fromRotationZ(CM.toRadians(node.rotation_z ?? 0)), new Matrix4());
            return new GeometryInstance({
              id: `${item.id}/${node.id}`, geometry, modelMatrix: local,
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(
                buildingColor(node.category, doc.parameters.kind, item.asset, colorModeRef.current, solid.color))),
                show: new ShowGeometryInstanceAttribute(true) },
            });
          });
          const batch = v!.scene.primitives.add(new Primitive({
            geometryInstances: instances, modelMatrix: frame,
            appearance: new PerInstanceColorAppearance({ translucent: false, closed: true }),
            asynchronous: false, releaseGeometryInstances: true,
          }));
          owned.set(item.id, { batch, document: doc, nodes, asset: item.asset,
            context: ["urban", "footprint"].includes(doc.parameters.kind), ready: false, needsStyle: true });
        }
        reportReady();
        v!.scene.requestRender();
        if (queue.length) timer = setTimeout(pump, 40);
      } catch (e) {
        queue = [];
        setError(`精细结构加载失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    function refresh() {
      if (!active || renderFailed.current || v!.isDestroyed()) return;
      if (timer !== undefined) clearTimeout(timer);
      const camera = v!.camera, canvas = v!.scene.canvas;
      const culling = camera.frustum.computeCullingVolume(camera.positionWC, camera.directionWC, camera.upWC);
      desired = fullDetails ? chooseRenderDetails(candidates.filter(item => coarseResidents.current.has(item.id)).map(item => {
        const sphere = spheres.current.get(item.id)!;
        const pixelSize = camera.getPixelSize(sphere, Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
        return { id: item.id, components: componentCounts.get(item.id)!,
          pixels: sphere.radius * 2 / Math.max(0.001, pixelSize),
          visible: (contextRef.current || !["urban", "footprint"].includes(city.assets[item.asset].parameters.kind)) &&
            culling.computeVisibility(sphere) !== Intersect.OUTSIDE };
      }), new Set(owned.keys()), selection.current) : new Set();
      // Removing primitives releases their vertex buffers and batch textures.
      for (const [id, detail] of owned) if (!desired.has(id)) {
        v!.scene.primitives.remove(detail.batch);
        owned.delete(id);
      }
      queue = [...desired].filter(id => !owned.has(id)).map(id => byId.get(id)!);
      highlight();
      reportReady();
      if (queue.length) timer = setTimeout(pump, 0);
    }
    const onCameraChange = () => {
      if (timer !== undefined) clearTimeout(timer);
      queue = [];
      if (cameraTimer !== undefined) clearTimeout(cameraTimer);
      // Coarse residency owns the debounced camera/resize refresh. Cancel fine
      // uploads immediately during motion; that settled refresh reprioritizes us.
    };
    const offCamera = v.camera.changed.addEventListener(onCameraChange);
    refreshDetails.current = refresh;
    highlight();
    reportReady();
    // Let the first camera flight settle before evaluating screen size.
    cameraTimer = setTimeout(refresh, 180);
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      if (cameraTimer !== undefined) clearTimeout(cameraTimer);
      off();
      offCamera();
      if (refreshDetails.current === refresh) refreshDetails.current = null;
      if (detailedBuildings.current === owned) detailedBuildings.current = new Map();
      if (!v.isDestroyed()) for (const detail of owned.values()) v.scene.primitives.remove(detail.batch);
    };
  }, [city.instances, city.assets, fullDetails, sampler, drapeBuildings, context]);
  useEffect(() => {
    refreshCoarse.current?.();
    highlight();
  }, [selected, context]);
  useEffect(() => highlight(), [colorMode]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const objects: Primitive[] = [];
    if (terrain && sampler) {
      for (const kind of Object.keys(terrainColors) as TerrainPatch["kind"][]) {
        const geometry = surfaceGeometry(terrain, kind, terrainMeshes?.[kind]);
        if (!geometry) continue;
        objects.push(
          v.scene.primitives.add(
            new Primitive({
              geometryInstances: new GeometryInstance({
                id: `terrain/${kind}`,
                geometry,
                modelMatrix: sampler.frame,
                attributes: {
                  color: ColorGeometryInstanceAttribute.fromColor(
                    Color.fromCssColorString(surfaceColors[kind]),
                  ),
                },
              }),
              appearance: new PerInstanceColorAppearance({
                closed: false,
                translucent: terrainOpacity < 1,
              }),
              asynchronous: false,
            }),
          ),
        );
      }
    }
    terrainBatches.current = objects;
    v.scene.requestRender();
    return () => {
      for (const p of objects)
        if (!v.isDestroyed()) v.scene.primitives.remove(p);
      terrainBatches.current = [];
    };
  }, [terrain, sampler, terrainMeshes, scenePurpose]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    // Per-instance colours preserve topology classes while opacity reveals underground objects.
    const update = () => {
      for (const kind of Object.keys(terrainColors) as TerrainPatch["kind"][]) {
        for (const b of terrainBatches.current) {
          if (!b.ready) continue;
          const attrs = b.getGeometryInstanceAttributes(`terrain/${kind}`);
          if (attrs)
            attrs.color = ColorGeometryInstanceAttribute.toValue(
              Color.fromCssColorString(surfaceColors[kind]).withAlpha(
                terrainOpacity,
              ),
            );
          if (b.appearance.translucent !== (terrainOpacity < 1))
            b.appearance = new PerInstanceColorAppearance({ closed: false, translucent: terrainOpacity < 1 });
          b.show = terrainOpacity > 0;
        }
      }
      const ground = v.entities.getById("city-ground-plane");
      if (ground) ground.show = showGround && (!terrain || terrainOpacity >= 0.99);
    };
    update();
    const off = v.scene.postRender.addEventListener(() => {
      if (terrainBatches.current.every((b) => b.ready)) {
        update();
        off();
        v.scene.requestRender();
      }
    });
    v.scene.requestRender();
    return off;
  }, [
    terrainOpacity,
    scenePurpose,
    showGround,
    terrain,
    city.instances,
    city.assets,
    city.roads,
    drapeBuildings,
  ]);
  useEffect(() => {
    const v = viewer.current;
    setTopologyNotice("");
    if (!v || !terrain || !sampler || !terrainWire) return;
    const { lines, limited } = terrainTopologyPreview(terrain);
    if (limited) {
      setTopologyNotice("原生拓扑线超过 20,000 条，本次未绘制线框。地形面与查询保留；可使用更大 DEM 采样步长。");
      return;
    }
    if (!lines.length) return;
    const geometryInstances = lines.map((line, index) =>
      new GeometryInstance({
        id: `native-topology/${index}`,
        geometry: new PolylineGeometry({
          positions: line.points.map((p) =>
            Matrix4.multiplyByPoint(
              sampler.frame,
              new Cartesian3(
                p[0],
                p[1],
                p[2] - terrain.reference_height + 0.06,
              ),
              new Cartesian3(),
            ),
          ),
          width: line.role === "generator" ? 2 : 1,
          arcType: ArcType.NONE,
          vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(terrainLineColors[line.role])) },
      }),
    );
    // Static native edges share one primitive instead of one reactive Entity per edge.
    const batch = v.scene.primitives.add(new Primitive({ geometryInstances,
      appearance: new PolylineColorAppearance({ translucent: false }), asynchronous: true }));
    v.scene.requestRender();
    return () => {
      if (!v.isDestroyed()) { v.scene.primitives.remove(batch); v.scene.requestRender(); }
    };
  }, [terrainWire, terrain, sampler]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const geometries: GeometryInstance[] = [];
    featureSpheres.current.clear();
    const cache = new Map<
      string,
      {
        geometry: ReturnType<typeof solidGeometry>;
        solid: ReturnType<typeof functionSolid>;
      }
    >();
    for (const item of features ?? []) {
      const asset = featureAssets![item.asset];
      const frame = Matrix4.multiplyByMatrix3(
        Transforms.eastNorthUpToFixedFrame(
          Cartesian3.fromDegrees(
            item.longitude,
            item.latitude,
            item.altitude +
              (sampler?.height(item.longitude, item.latitude) ?? 0),
          ),
        ),
        Matrix3.fromRotationZ(CM.toRadians(-item.heading)),
        new Matrix4(),
      );
      const scaled = Matrix4.multiplyByUniformScale(
        frame,
        item.scale,
        new Matrix4(),
      );
      const points: Cartesian3[] = [];
      for (const component of asset.components) {
        const key = `${item.asset}/${component.id}`;
        let cached = cache.get(key);
        if (!cached) {
          const solid = functionSolid(component, 24);
          cached = {
            solid,
            geometry: solidGeometry(solid, component.position),
          };
          cache.set(key, cached);
        }
        const { geometry, solid } = cached;
        geometries.push(
          new GeometryInstance({
            id: `feature:${item.id}/${component.id}`,
            geometry,
            modelMatrix: scaled,
            attributes: {
              color: ColorGeometryInstanceAttribute.fromColor(
                Color.fromCssColorString(component.color),
              ),
              show: new ShowGeometryInstanceAttribute(true),
            },
          }),
        );
        const vertices =
          solid.kind === "box"
            ? [-1, 1].flatMap((x) =>
                [-1, 1].flatMap((y) =>
                  [-1, 1].map((z) => [
                    (x * solid.size![0]) / 2,
                    (y * solid.size![1]) / 2,
                    (z * solid.size![2]) / 2,
                  ]),
                ),
              )
            : solid.vertices!;
        for (const p of vertices)
          points.push(
            Matrix4.multiplyByPoint(
              scaled,
              new Cartesian3(
                p[0] + component.position[0],
                p[1] + component.position[1],
                p[2] + component.position[2],
              ),
              new Cartesian3(),
            ),
          );
      }
      featureSpheres.current.set(item.id, BoundingSphere.fromPoints(points));
    }
    if (!geometries.length) return;
    const batch = v.scene.primitives.add(
      new Primitive({
        geometryInstances: geometries,
        appearance: new PerInstanceColorAppearance({
          translucent: false,
          closed: true,
        }),
        asynchronous: false,
      }),
    );
    featureBatch.current = batch;
    v.scene.requestRender();
    return () => {
      featureBatch.current = null;
      if (!v.isDestroyed()) v.scene.primitives.remove(batch);
    };
  }, [features, featureAssets, sampler]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const update = () => {
      const batch = featureBatch.current;
      if (!batch?.ready) return;
      for (const item of features ?? []) {
        const visible =
          (featureLayer === "all" || item.layer === featureLayer) &&
          (!isolateFeature || !selectedFeature || item.id === selectedFeature);
        for (const component of featureAssets?.[item.asset]?.components ?? []) {
          const attrs = batch.getGeometryInstanceAttributes(`feature:${item.id}/${component.id}`);
          if (attrs) attrs.show = ShowGeometryInstanceAttribute.toValue(visible);
        }
      }
    };
    update();
    const off = v.scene.postRender.addEventListener(() => {
      if (featureBatch.current?.ready) {
        update();
        off();
        v.scene.requestRender();
      }
    });
    v.scene.requestRender();
    return off;
  }, [features, featureAssets, sampler, featureLayer, isolateFeature, selectedFeature]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const item = showFeatureMarkers
      ? features?.find((f) => f.id === selectedFeature && (featureLayer === "all" || f.layer === featureLayer))
      : undefined;
    const marker = item
      ? v.entities.add({
          position: Cartesian3.fromDegrees(
            item.longitude,
            item.latitude,
            item.altitude +
              (sampler?.height(item.longitude, item.latitude) ?? 0) +
              6 * item.scale,
          ),
          label: {
            text: item.name,
            font: "bold 13px sans-serif",
            fillColor: Color.fromCssColorString("#315f50"),
            showBackground: true,
            backgroundColor: Color.WHITE.withAlpha(0.95),
            disableDepthTestDistance: Infinity,
          },
        })
      : null;
    v.scene.requestRender();
    return () => {
      if (!v.isDestroyed()) {
        if (marker) v.entities.remove(marker);
      }
    };
  }, [features, sampler, selectedFeature, showFeatureMarkers, featureLayer]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const item = city.instances.find((i) => i.id === selected);
    for (const instance of city.instances) {
      const label = v.entities.getById(`landmark/${instance.id}`);
      if (label) label.show = instance.id !== selected || !!placement;
    }
    const location = placement ?? item;
    const selectedEnvironmentFeature = features?.find((f) => f.id === selectedFeature);
    if (placementKind === "feature" && !placing &&
        (!showFeatureMarkers || (selectedEnvironmentFeature && featureLayer !== "all" && selectedEnvironmentFeature.layer !== featureLayer))) return;
    if (
      !location ||
      ![location.longitude, location.latitude, location.altitude].every(
        Number.isFinite,
      ) ||
      Math.abs(location.latitude) > 85 ||
      Math.abs(location.longitude) > 180
    )
      return;
    const marker = v.entities.add({
      id: placement ? "placement-preview" : `${selected}/location-marker`,
      position: Cartesian3.fromDegrees(
        location.longitude,
        location.latitude,
        location.altitude +
          0.5 +
          ((placement && placementKind === "feature") || drapeBuildings
            ? (sampler?.height(location.longitude, location.latitude) ?? 0)
            : 0),
      ),
      point: {
        pixelSize: 12,
        color: Color.fromCssColorString(placement ? "#b27835" : "#315f50"),
        outlineColor: Color.WHITE,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: placement
          ? placementKind === "feature"
            ? "函数地物基点"
            : "新建 / 更新位置"
          : `选中：${item!.name}`,
        font: "bold 13px sans-serif",
        fillColor: Color.fromCssColorString(placement ? "#785529" : "#315f50"),
        showBackground: true,
        backgroundColor: Color.fromCssColorString(placement ? "#fffaf0" : "#ffffff").withAlpha(0.95),
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    v.scene.requestRender();
    return () => {
      if (!v.isDestroyed()) {
        v.entities.remove(marker);
        v.scene.requestRender();
      }
    };
  }, [
    city.instances,
    city.assets,
    sampler,
    drapeBuildings,
    placementKind,
    selected,
    placement?.longitude,
    placement?.latitude,
    placement?.altitude,
    showFeatureMarkers,
    placing,
    features,
    selectedFeature,
    featureLayer,
  ]);
  return (
    <div
      className={`building-scene${placing || queryTerrain || analysisDrawing || spatialPicking ? " is-placing" : ""}`}
      role="region"
      aria-label={scenePurpose==='research'?'混合地形研究三维视图':'三维城市视图'}
    >
      <div className="scene-canvas" ref={host} />
      <div className="camera-distance" role="status">
        视距 {distance.toLocaleString()} m · 缓速缩放
      </div>
      {scenePurpose==='research'?<div className="lod-note" role="status">研究地形 · 原生查询与显示三角网分别计算</div>:<div className="lod-note" role="status" title="构件模型与 LoD1 轮廓分开统计；数量依据模型类型，不代表实测精度或内部已核验。">
        {renderOnly ? "渲染包原始构件 · 不含编辑语义" : <>
          {fullDetails ? detailProgress.ready < detailProgress.total
            ? `构件加载中 · ${detailProgress.ready} / ${detailProgress.total} 栋`
            : `已加载构件模型 · ${detailProgress.ready} 栋 · ${detailProgress.components.toLocaleString()} 个构件`
            : "自动精细已关闭"}
          {detailProgress.footprints > 0 && ` · LoD1 轮廓 ${detailProgress.footprints.toLocaleString()} 栋`}
          {fullDetails && ` · 拉近自动加载`}
        </>}
        {` · 已渲染 ${renderProgress.buildings.toLocaleString()} / ${city.instances.length.toLocaleString()} 栋 · 按视域与预算加载`}
        {topologyNotice && <div className="terrain-topology-notice">{topologyNotice}</div>}
      </div>}
      {error && (
        <div className="scene-error" role="alert">
          <strong>{renderFailed.current ? "三维渲染暂时中断" : "三维视图提示"}</strong>
          <p>{scenePurpose==='research'?'研究档案未改动。可重新建立三维视图后继续核查。':'城市数据仍然保留。可重新建立三维视图后继续操作。'}</p>
          <details><summary>错误详情</summary>{error}</details>
          {onRetry && <button onClick={onRetry}>恢复三维视图</button>}
        </div>
      )}
    </div>
  );
});
