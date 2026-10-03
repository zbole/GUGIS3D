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
} from "cesium";
import type { CityDocument } from "./cityModel";
import type { SceneHandle } from "./BuildingScene";
import { solidGeometry, solidCorners } from "./geometry";
import { hasBuildingOverview, type BuildingDocument, type SceneNode, type Solid } from "./model";
import { buildingColor, type BuildingColorMode } from "./buildingAppearance";
import { functionSolid, terrainColors, type TerrainPatch } from "./environment";
import {
  terrainSampler,
  surfaceGeometry,
} from "./terrainScene";
import { terrainLineColors, terrainTopologyLines } from "./terrainTopology";
import type { TerrainHit } from "./terrainMath";
import { chooseDetails } from "./detailBudget";
import { createPathLocator, type AnalysisPoint, type PathAnalysis } from "./terrainAnalysis";

const noAnalysisPoints: AnalysisPoint[] = [];

export interface GeographicPosition {
  longitude: number;
  latitude: number;
}
export interface CitySceneHandle extends SceneHandle {
  centerPosition: () => GeographicPosition | null;
  focusFeature: (id: string) => void;
  focusBuilding: (id: string) => void;
}
interface Props {
  city: CityDocument;
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
  queryTerrain?: boolean;
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
    queryTerrain = false,
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
  const colorModeRef = useRef(colorMode);
  const analysisClick = useRef({ analysisDrawing, onAnalysisPoint });
  analysisClick.current = { analysisDrawing, onAnalysisPoint };
  const spatialClick = useRef({ spatialPicking, onSpatialPoint });
  spatialClick.current = { spatialPicking, onSpatialPoint };
  const lastStyle = useRef({ selected: null as string | null, colorMode });
  const [detailProgress, setDetailProgress] = useState({ ready: 0, total: 0, components: 0 });
  colorModeRef.current = colorMode;
  const [error, setError] = useState(""),
    [distance, setDistance] = useState(0);
  const terrain = city.environment?.terrain;
  const drapeBuildings = city.environment?.drape_buildings;
  const features = city.environment?.features;
  const featureAssets = city.environment?.feature_assets;
  const sampler = useMemo(() => terrainSampler(terrain), [terrain]);
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
    const position = (ray && sampleRef.current?.ray(ray)?.position) ??
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
  function fit(top = false, focus = false) {
    const v = viewer.current,
      s =
        (focus && selection.current
          ? spheres.current.get(selection.current)
          : bounds.current) ?? bounds.current;
    if (v && s)
      v.camera.flyToBoundingSphere(s, {
        duration: 0.6,
        offset: new HeadingPitchRange(
          CM.toRadians(18),
          CM.toRadians(top ? -89 : -45),
          Math.max(s.radius * (focus ? 3.3 : 2.7), 40),
        ),
      });
  }
  useImperativeHandle(ref, () => ({
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
          !(
            p.overview && detailedBuildings.current.get(p.cityId)?.ready
          ),
        );
      }
    }
    if (batches.current[0]) batches.current[0].show = contextRef.current;
    for (const [id, detail] of detailedBuildings.current) {
      if (!detail.batch.ready) continue;
      detail.batch.show = !detail.context || contextRef.current;
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
        environmentClick.current.onTerrainQuery?.(ray ? sampleRef.current?.ray(ray)?.hit ?? null : null);
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
    v.camera.percentageChanged = 0.002;
    const off = v.camera.changed.addEventListener(() => {
      if (bounds.current)
        setDistance(
          Math.round(
            Cartesian3.distance(v.camera.positionWC, bounds.current.center),
          ),
        );
    });
    const offError = v.scene.renderError.addEventListener(
      (_s: unknown, e: Error) => { renderFailed.current = true; setError(e.message); },
    );
    return () => {
      click.destroy();
      off();
      offError();
      v.destroy();
      viewer.current = null;
    };
  }, []);
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
    const allPoints: Cartesian3[] = [],
      sets: GeometryInstance[][] = [[], []],
      meta: (Omit<(typeof parts.current)[number], "batch"> & { group: number })[] = [];
    const lightFrame = Transforms.eastNorthUpToFixedFrame(
      Cartesian3.fromDegrees(center.longitude, center.latitude),
    );
    const direction = Matrix4.multiplyByPointAsVector(
      lightFrame,
      new Cartesian3(-0.5, 0.7, -1),
      new Cartesian3(),
    );
    v.scene.light = new DirectionalLight({
      direction: Cartesian3.normalize(direction, direction),
      intensity: 1.1,
    });
    // Cesium's synchronous Primitive clones each input geometry before applying
    // instance transforms. Generate local shapes and bounds once per template.
    const sharedGeometry = new WeakMap<Solid, { geometry: ReturnType<typeof solidGeometry>; corners: Cartesian3[] }>();
    for (const item of city.instances) {
      const doc = city.assets[item.asset],
        group = ["footprint", "urban"].includes(doc.parameters.kind) ? 0 : 1;
      const frame = Matrix4.multiplyByMatrix3(
        Transforms.eastNorthUpToFixedFrame(
          Cartesian3.fromDegrees(
            item.longitude,
            item.latitude,
            item.altitude +
              (city.environment?.drape_buildings
                ? (sampler?.height(item.longitude, item.latitude) ?? 0)
                : 0),
          ),
        ),
        Matrix3.fromRotationZ(CM.toRadians(-item.heading)),
        new Matrix4(),
      );
      const points: Cartesian3[] = [];
      const overview = hasBuildingOverview(doc) ? doc.overview : undefined;
      const renderNodes: SceneNode[] = overview
        ? Object.keys(overview).map((key) => ({
            id: `overview_${key}`,
            name: key,
            category: key === "roof" ? "roof" : "wall",
            template: key,
            position: [0, 0, 0],
          }))
        : doc.nodes;
      for (const node of renderNodes) {
        if (!node.template || !node.position) continue;
        const solid = (overview ?? doc.templates)[node.template],
          id = `${item.id}/${node.id}`,
          color = Color.fromCssColorString(
            buildingColor(node.category, doc.parameters.kind, item.asset, colorModeRef.current, solid.color),
          );
        const positioned = Matrix4.multiplyByTranslation(
          frame,
          new Cartesian3(...node.position),
          new Matrix4(),
        );
        const transform = Matrix4.multiplyByMatrix3(
          positioned,
          Matrix3.fromRotationZ(CM.toRadians(node.rotation_z ?? 0)),
          new Matrix4(),
        );
        let cached = sharedGeometry.get(solid);
        if (!cached) {
          cached = { geometry: solidGeometry(solid), corners: solidCorners(solid) };
          sharedGeometry.set(solid, cached);
        }
        const geometry = cached.geometry;
        sets[group].push(
          new GeometryInstance({
            id,
            geometry,
            modelMatrix: transform,
            attributes: {
              color: ColorGeometryInstanceAttribute.fromColor(color),
              show: new ShowGeometryInstanceAttribute(true),
            },
          }),
        );
        meta.push({ id, cityId: item.id, group, category: node.category, kind: doc.parameters.kind,
          asset: item.asset, fallback: solid.color, overview: !!overview });
        const vertices = cached.corners;
        points.push(
          ...vertices.map((p) =>
            Matrix4.multiplyByPoint(transform, p, new Cartesian3()),
          ),
        );
      }
      const sphere = BoundingSphere.fromPoints(points);
      spheres.current.set(item.id, sphere);
      allPoints.push(
        Cartesian3.add(
          sphere.center,
          new Cartesian3(sphere.radius, sphere.radius, sphere.radius),
          new Cartesian3(),
        ),
        Cartesian3.subtract(
          sphere.center,
          new Cartesian3(sphere.radius, sphere.radius, sphere.radius),
          new Cartesian3(),
        ),
      );
      if (["wills", "cabot", "cathedral"].includes(doc.parameters.kind))
        addEntity({
          id: `landmark/${item.id}`,
          position: Cartesian3.fromDegrees(
            item.longitude,
            item.latitude,
            item.altitude +
              70 * (doc.parameters.scale ?? 1) +
              (city.environment?.drape_buildings
                ? (sampler?.height(item.longitude, item.latitude) ?? 0)
                : 0),
          ),
          label: {
            text: item.name,
            font: "13px sans-serif",
            fillColor: Color.fromCssColorString("#354c40"),
            outlineColor: Color.WHITE,
            outlineWidth: 1,
            style: LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: Color.WHITE.withAlpha(0.9),
            pixelOffset: new Cartesian2(0, -10),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
    }
    for (const group of sets)
      batches.current.push(
        v.scene.primitives.add(
          new Primitive({
            geometryInstances: group,
            appearance: new PerInstanceColorAppearance({
              translucent: false,
              closed: true,
            }),
            asynchronous: false,
            releaseGeometryInstances: true,
          }),
        ),
      );
    parts.current = meta.map((p) => ({
      ...p,
      batch: batches.current[p.group],
    }));
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
          allPoints.push(
            Matrix4.multiplyByPoint(
              sampler.frame,
              new Cartesian3(x, y, max[2] - terrain.reference_height),
              new Cartesian3(),
            ),
          );
    }
    bounds.current = allPoints.length
      ? BoundingSphere.fromPoints(allPoints)
      : new BoundingSphere(Cartesian3.fromDegrees(center.longitude, center.latitude), 300);
    // A flat local ground plane keeps context offline and avoids inventing terrain elevations.
    const inverse = Matrix4.inverse(lightFrame, new Matrix4());
    const local = allPoints.map((p) =>
      Matrix4.multiplyByPoint(inverse, p, new Cartesian3()),
    );
    const minX = Math.min(-300, ...local.map((p) => p.x)) - 30,
      maxX = Math.max(300, ...local.map((p) => p.x)) + 30,
      minY = Math.min(-300, ...local.map((p) => p.y)) - 30,
      maxY = Math.max(300, ...local.map((p) => p.y)) + 30;
    const groundHeight = terrain
      ? terrain.points.reduce(
          (min, p) => Math.min(min, p[2] - terrain.reference_height),
          Infinity,
        ) - 3
      : -1.5;
    addEntity({
      id: "city-ground-plane",
      show: !terrain || terrainOpacity >= 0.99,
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
    const off = v.scene.postRender.addEventListener(() => {
      if (batches.current.every((b) => b.ready)) {
        highlight();
        off();
      }
    });
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
    const ownedBatches = [...batches.current];
    return () => {
      off();
      if (!v.isDestroyed()) {
        for (const entity of ownedEntities) v.entities.remove(entity);
        for (const batch of ownedBatches) v.scene.primitives.remove(batch);
      }
    };
  }, [
    city.instances,
    center.longitude,
    center.latitude,
    city.assets,
    city.roads,
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
    const permanent = city.instances.filter(item => !hasBuildingOverview(city.assets[item.asset]));
    const permanentComponents = permanent.reduce((n, item) => n + city.assets[item.asset].nodes.filter(node => node.template && node.position).length, 0);
    const componentCounts = new Map(candidates.map(item => [item.id,
      city.assets[item.asset].nodes.filter(node => node.template && node.position).length]));
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    let cameraTimer: ReturnType<typeof setTimeout> | undefined;
    let queue: typeof candidates = [], desired = new Set<string>(), reported = "";
    const reportReady = () => {
      if (!active || renderFailed.current) return;
      let changed = false, ready = permanent.length, components = permanentComponents;
      for (const detail of owned.values()) {
        if (!detail.ready && detail.batch.ready) { detail.ready = true; changed = true; }
        if (detail.ready) { ready++; components += detail.nodes.length; }
      }
      if (changed) highlight();
      const total = permanent.length + desired.size;
      const signature = `${ready}/${total}/${components}`;
      if (reported !== signature) {
        reported = signature;
        setDetailProgress({ ready, total, components });
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
      desired = fullDetails ? chooseDetails(candidates.map(item => {
        const sphere = spheres.current.get(item.id)!;
        const pixelSize = camera.getPixelSize(sphere, Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
        return { id: item.id, components: componentCounts.get(item.id)!,
          pixels: sphere.radius * 2 / Math.max(0.001, pixelSize),
          visible: (contextRef.current || !["urban", "footprint"].includes(city.assets[item.asset].parameters.kind)) &&
            culling.computeVisibility(sphere) !== Intersect.OUTSIDE };
      }), new Set(owned.keys())) : new Set();
      // Removing primitives releases their vertex buffers and batch textures.
      for (const [id, detail] of owned) if (!desired.has(id)) {
        v!.scene.primitives.remove(detail.batch);
        owned.delete(id);
      }
      const byId = new Map(candidates.map(item => [item.id, item]));
      queue = [...desired].filter(id => !owned.has(id)).map(id => byId.get(id)!);
      highlight();
      reportReady();
      if (queue.length) timer = setTimeout(pump, 0);
    }
    const onCameraChange = () => {
      if (timer !== undefined) clearTimeout(timer);
      queue = [];
      if (cameraTimer !== undefined) clearTimeout(cameraTimer);
      cameraTimer = setTimeout(refresh, 180);
    };
    const offCamera = v.camera.changed.addEventListener(onCameraChange);
    const offMove = v.camera.moveEnd.addEventListener(onCameraChange);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onCameraChange);
    resize?.observe(v.scene.canvas);
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
      offMove();
      resize?.disconnect();
      if (detailedBuildings.current === owned) detailedBuildings.current = new Map();
      if (!v.isDestroyed()) for (const detail of owned.values()) v.scene.primitives.remove(detail.batch);
    };
  }, [city.instances, city.assets, fullDetails, sampler, drapeBuildings, context]);
  useEffect(() => highlight(), [selected, context, colorMode]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const objects: Primitive[] = [];
    if (terrain && sampler) {
      for (const kind of Object.keys(terrainColors) as TerrainPatch["kind"][]) {
        const geometry = surfaceGeometry(terrain, kind);
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
                    Color.fromCssColorString(terrainColors[kind]),
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
  }, [terrain, sampler]);
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
              Color.fromCssColorString(terrainColors[kind]).withAlpha(
                terrainOpacity,
              ),
            );
          if (b.appearance.translucent !== (terrainOpacity < 1))
            b.appearance = new PerInstanceColorAppearance({ closed: false, translucent: terrainOpacity < 1 });
          b.show = terrainOpacity > 0;
        }
      }
      const ground = v.entities.getById("city-ground-plane");
      if (ground) ground.show = !terrain || terrainOpacity >= 0.99;
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
    terrain,
    city.instances,
    city.assets,
    city.roads,
    drapeBuildings,
  ]);
  useEffect(() => {
    const v = viewer.current;
    if (!v || !terrain || !sampler || !terrainWire) return;
    const lines = terrainTopologyLines(terrain);
    if (lines.length > 20000) {
      setError("拓扑线超过 20,000 条；请使用更大的 DEM 采样步长查看线框");
      return;
    }
    const entities = lines.map((line) =>
      v.entities.add({
        polyline: {
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
          material: Color.fromCssColorString(terrainLineColors[line.role]),
        },
      }),
    );
    v.scene.requestRender();
    return () => {
      if (!v.isDestroyed()) for (const e of entities) v.entities.remove(e);
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
      aria-label="三维城市视图"
    >
      <div className="scene-canvas" ref={host} />
      <div className="camera-distance" role="status">
        视距 {distance.toLocaleString()} m · 缓速缩放
      </div>
      <div className="lod-note" role="status">
        {fullDetails ? detailProgress.ready < detailProgress.total
          ? `精细结构加载中 · ${detailProgress.ready} / ${detailProgress.total} 栋`
          : `自动精细 · ${detailProgress.ready} 栋 · ${detailProgress.components.toLocaleString()} 个构件 · 拉近自动加载`
          : "轻量概览 · 可开启自动精细结构"}
      </div>
      {error && (
        <div className="scene-error" role="alert">
          <strong>{renderFailed.current ? "三维渲染暂时中断" : "三维视图提示"}</strong>
          <p>城市数据仍然保留。可重新建立三维视图后继续操作。</p>
          <details><summary>错误详情</summary>{error}</details>
          {onRetry && <button onClick={onRetry}>恢复三维视图</button>}
        </div>
      )}
    </div>
  );
});
