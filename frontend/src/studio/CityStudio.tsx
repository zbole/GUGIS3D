import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Plus,
  Download,
  Upload,
  RotateCcw,
  Layers3,
  LocateFixed,
  Copy,
  Trash2,
  Undo2,
  X,
  Building2,
  Maximize2,
  Minimize2,
  Grid2X2,
  PencilRuler,
  Mountain,
  ScanLine,
  History,
  Search,
  Route,
} from "lucide-react";
import CityScene, {
  type CitySceneHandle,
  type GeographicPosition,
} from "./CityScene";
import DetailPanel from "./DetailPanel";
import AuthorForm from "./AuthorForm";
import ComponentLegend from "./ComponentLegend";
import MemoryComparison from "./MemoryComparison";
import EnvironmentPanel from "./EnvironmentPanel";
import RecoveryPanel from "./RecoveryPanel";
import BlockForm from "./BlockForm";
import AnalysisPanel from "./AnalysisPanel";
import SpatialPanel from "./SpatialPanel";
import ProjectStatusPanel, { type ProjectDataSource } from "./ProjectStatusPanel";
import { analyzeCitySection, queryCityPoint, type PointQuery, type SpatialObject } from "./spatialAnalysis";
import { type AnalysisPoint, pathPointAtDistance } from "./terrainAnalysis";
import { usePathAnalysis } from "./usePathAnalysis";
import { readAnalyses, writeAnalyses, terrainFingerprint, analysisAlgorithm, type SavedAnalysis } from "./analysisStore";
import type { Environment } from "./environment";
import type { TerrainHit } from "./terrainMath";
import type { Parameters } from "./model";
import {
  CityDocument,
  kinds,
  placedDocument,
  putBuilding,
  removeBuilding,
} from "./cityModel";
import {
  cityExportUrl,
  loadCity,
  persistCity,
  validateCity,
  importGeoJSON,
  refineBuilding,
  loadDraft,
  persistDraft,
  discardDraft,
  commitDraft,
  loadVersion,
  generateBlock,
  type CityDraft,
  type DraftEditor,
} from "./cityApi";
import {
  generateBuilding,
  validateDocument,
  saveDocument,
  downloadUrl,
} from "./api";
import "./studio.css";
import "./workbench.css";
import type { StorageStatistics } from "./cityArchive";
import type { BuildingColorMode } from "./buildingAppearance";
import { type WorkspaceTab } from "./workspaceNavigation";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation";

const newDraft = (): Parameters => ({
  name: "乔治式住宅 · 新建",
  kind: "georgian",
  floors: 3,
  units: 1,
  floor_height: 3.4,
  scale: 1,
  longitude: -2.6084,
  latitude: 51.4527,
  altitude: 0,
  heading: 0,
});
export default function CityStudio() {
  const [city, setCity] = useState<CityDocument | null>(null),
    [storage, setStorage] = useState<StorageStatistics | null>(null),
    [revision, setRevision] = useState(""),
    [active, setActive] = useState<string | null>("wills");
  const [tab, setTab] = useWorkspaceNavigation();
  const [mode, setMode] = useState<"add" | "update">("add"),
    [draft, setDraft] = useState<Parameters>(newDraft),
    [editId, setEditId] = useState<string | null>(null),
    [placing, setPlacing] = useState(false),
    [addedId, setAddedId] = useState<string | null>(null),
    [objectLink, setObjectLink] = useState("");
  const [environmentPosition, setEnvironmentPosition] = useState({
      longitude: -2.6091,
      latitude: 51.4538,
      altitude: 0,
    }),
    [selectedFeature, setSelectedFeature] = useState<string | null>(null),
    [terrainOpacity, setTerrainOpacity] = useState(1),
    [terrainWire, setTerrainWire] = useState(false),
    [queryTerrain, setQueryTerrain] = useState(false),
    [terrainHit, setTerrainHit] = useState<TerrainHit | null>(null);
  const [featureLayer, setFeatureLayer] = useState<"all" | "surface" | "underground">("all");
  const [isolateFeature, setIsolateFeature] = useState(false);
  const [showFeatureMarkers, setShowFeatureMarkers] = useState(true);
  const [environmentEditing, setEnvironmentEditing] = useState(false);
  const [expandedScene, setExpandedScene] = useState(false);
  const [colorMode, setColorMode] = useState<BuildingColorMode>("material");
  const [fullDetails, setFullDetails] = useState(true);
  const [sceneRevision, setSceneRevision] = useState(0);
  const [preview, setPreview] = useState<CityDraft | null>(null),
    [draftUnavailable, setDraftUnavailable] = useState(false),
    [needsRegenerate, setNeedsRegenerate] = useState(false),
    [recovery, setRecovery] = useState(false);
  const displayCity = preview?.document ?? city;
  const [analysisPoints, setAnalysisPoints] = useState<AnalysisPoint[]>([]);
  const [analysisDrawing, setAnalysisDrawing] = useState(false);
  const [analysisHover, setAnalysisHover] = useState<AnalysisPoint | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [analysisSpacing, setAnalysisSpacing] = useState(5);
  const [analysisView, setAnalysisView] = useState<"route" | "unified">("route");
  const [sectionWidth, setSectionWidth] = useState(30);
  const [spatialPicking, setSpatialPicking] = useState(false);
  const [spatialSelection, setSpatialSelection] = useState<{ position: AnalysisPoint; inspected: PointQuery["inspected"] } | null>(null);
  const analysisTerrain = displayCity?.environment?.terrain ?? undefined;
  const terrainSource = useMemo<ProjectDataSource | undefined>(() => {
    if (!analysisTerrain) return undefined;
    if (analysisTerrain.demonstration) return { kind: "demonstration", detail: "解析高程函数生成，用于验证面带表达；尚未导入真实 DTM。" };
    const source = analysisTerrain.source;
    if (source["文件"] && /^[a-f\d]{64}$/i.test(source.SHA256 ?? ""))
      return { kind: "user-imported", detail: `${source["文件"]} · 数据集自报源文件 SHA256 ${source.SHA256.slice(0, 12)}…；实测属性未独立核验。` };
    return { kind: "unknown", detail: source["来源"] || "当前地形未标注可核验的数据来源。" };
  }, [analysisTerrain]);
  const analysisState = usePathAnalysis(analysisPoints, analysisTerrain, analysisSpacing);
  const sectionResult = useMemo(() =>
    tab === "analysis" && analysisView === "unified" && displayCity && analysisState.result && analysisPoints.length >= 2
      ? analyzeCitySection(displayCity, analysisPoints, analysisState.result, sectionWidth) : null,
    [tab, analysisView, displayCity?.instances, displayCity?.assets, displayCity?.environment, analysisPoints, analysisState.result, sectionWidth],
  );
  const spatialResult = useMemo(() => tab === "analysis" && analysisView === "unified" && displayCity && spatialSelection
    ? queryCityPoint(displayCity, spatialSelection.position, 100, spatialSelection.inspected) : null,
    [tab, analysisView, displayCity?.instances, displayCity?.assets, displayCity?.roads, displayCity?.environment, spatialSelection],
  );
  const fingerprint = useMemo(() => terrainFingerprint(analysisTerrain), [analysisTerrain]);
  const savedAnalyses = useMemo(() => {
    try { return { records: city ? readAnalyses(city) : [], error: "" }; }
    catch (error) { return { records: [], error: error instanceof Error ? error.message : "分析记录无法读取" }; }
  }, [city?.metadata]);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("正在恢复本地城市项目…"),
    [savedPath, setSavedPath] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [visibleCount, setVisibleCount] = useState(40),
    [context, setContext] = useState(true),
    [history, setHistory] = useState<CityDocument[]>([]);
  const file = useRef<HTMLInputElement>(null),
    historyButton = useRef<HTMLButtonElement>(null),
    scene = useRef<CitySceneHandle>(null),
    sceneRegion = useRef<HTMLElement>(null),
    locked = useRef(false);
  useEffect(() => {
    // Stop tools when leaving a workspace, but retain the editor and analysis route.
    setExpandedScene(false);
    setPlacing(false);
    setQueryTerrain(false);
    setAnalysisDrawing(false);
    setSpatialPicking(false);
    setAnalysisHover(null);
  }, [tab]);
  useEffect(() => {
    if (!placing && !(tab === "city" && addedId)) return;
    const frame = requestAnimationFrame(() => {
      const region = sceneRegion.current;
      if (!region) return;
      const bounds = region.getBoundingClientRect();
      // A stacked mobile form can move the scene outside the page viewport.
      // Scroll the page back to it without changing the 3D camera.
      if (bounds.top < 0 || bounds.top >= window.innerHeight - 100)
        region.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [placing, tab, addedId]);
  const select = useCallback((id: string | null) => setActive(id), []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlacing(false);
        setQueryTerrain(false);
        setExpandedScene(false);
        setRecovery(false);
        setAnalysisDrawing(false);
        setSpatialPicking(false);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  useEffect(() => {
    setTerrainHit(null);
    setQueryTerrain(false);
    setTerrainOpacity(1);
    setTerrainWire(false);
  }, [displayCity?.environment?.terrain]);
  useEffect(() => {
    if (
      selectedFeature &&
      !displayCity?.environment?.features.some((f) => f.id === selectedFeature)
    )
      setSelectedFeature(null);
  }, [displayCity?.environment?.features, selectedFeature]);
  useEffect(() => { setAnalysisHover(null); }, [analysisPoints, analysisTerrain]);
  function appendAnalysisPoint(point: AnalysisPoint | null) {
    if (!point) { setNotice("请在场景地面选择路线点。"); return; }
    if (analysisPoints.length >= 64) { setAnalysisDrawing(false); setNotice("单条路线最多 64 个选点，请完成当前分析。"); return; }
    const previous = analysisPoints[analysisPoints.length - 1];
    if (previous && Math.abs(previous.longitude - point.longitude) + Math.abs(previous.latitude - point.latitude) < 1e-8) return;
    setAnalysisPoints(p => [...p, point]);
    setAnalysisId(null);
  }
  function hoverAnalysis(distance: number | null) {
    if (distance === null || !analysisState.result) { setAnalysisHover(null); return; }
    const sample = analysisState.result.samples.find(s => s.distance === distance);
    const point = pathPointAtDistance(analysisPoints, analysisTerrain, distance);
    setAnalysisHover(point && sample?.height !== null && sample?.height !== undefined
      ? { ...point, altitude: sample.height - (analysisTerrain?.reference_height ?? 0) } : null);
  }
  function inspectSpatialPoint(position: AnalysisPoint | null, picked: string | null) {
    if (!position) { setNotice("该位置不能投影到地面，请重新选择。"); return; }
    let inspected: PointQuery["inspected"] = null;
    if (picked?.startsWith("feature:")) {
      const [id, component] = picked.slice(8).split("/");
      const layer = displayCity?.environment?.features.find(item => item.id === id)?.layer ?? "surface";
      inspected = { layer, id, component };
    }
    else if (picked) {
      const [id, component] = picked.split("/");
      if (displayCity?.instances.some(item => item.id === id)) inspected = { layer: "building", id, component };
    }
    setSpatialSelection({ position, inspected });
  }
  function focusSpatialObject(object: SpatialObject) {
    if (object.layer === "building") { setActive(object.id); scene.current?.focusBuilding(object.id); }
    else { setSelectedFeature(object.id); scene.current?.focusFeature(object.id); }
  }
  async function saveAnalysis(name: string) {
    if (!city || preview || busy || draftUnavailable || savedAnalyses.error || !analysisState.result || analysisState.busy || analysisState.result.horizontalDistance <= 0) return false;
    const record: SavedAnalysis = {
      id: analysisId ?? `a_${crypto.randomUUID()}`, name: name.trim().slice(0, 80), createdAt: new Date().toISOString(),
      points: analysisPoints.map(p => ({ ...p })), spacing: analysisSpacing,
      terrainFingerprint: fingerprint, result: analysisState.result, algorithm: analysisAlgorithm,
      coordinateSystem: "WGS84_DEGREES_LOCAL_HEIGHT_METERS", source: { ...analysisTerrain?.source },
      referenceHeight: analysisTerrain?.reference_height ?? null,
      sectionWidth,
    };
    try {
      const records = savedAnalyses.records.filter(r => r.id !== record.id);
      const ok = await commit(writeAnalyses(city, [...records, record]), "分析已保存到 GUGIS 城市项目");
      if (ok) { setAnalysisId(record.id); setAnalysisDrawing(false); }
      return ok;
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
  }
  function openAnalysis(record: SavedAnalysis) {
    setAnalysisId(record.id); setAnalysisDrawing(false); setAnalysisPoints(record.points.map(p => ({ ...p })));
    setAnalysisSpacing(record.spacing);
    setSectionWidth(record.sectionWidth ?? 30);
    setNotice(record.terrainFingerprint === fingerprint ? "已重开分析，并依据当前原生地形复算；视角保持不变。" : "地形已变更：正在复算。历史结果仍保留，点击保存后才更新记录。");
  }
  async function deleteAnalysis(id: string) {
    if (!city || preview || busy || draftUnavailable || savedAnalyses.error) return;
    try {
      const ok = await commit(writeAnalyses(city, savedAnalyses.records.filter(r => r.id !== id)), "已删除分析记录，可撤销或从历史恢复");
      if (ok && id === analysisId) setAnalysisId(null);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  async function reload() {
    setBusy(true);
    setError("");
    try {
      const [formal, pendingResult] = await Promise.allSettled([loadCity(), loadDraft()]);
      if (formal.status === "rejected") throw formal.reason;
      const r = formal.value;
      const pending = pendingResult.status === "fulfilled" ? pendingResult.value : null;
      setDraftUnavailable(pendingResult.status === "rejected");
      if (pendingResult.status === "rejected")
        setError(`正式城市已载入，独立草稿暂不可用：${String(pendingResult.reason)}。请重新载入后继续制作。`);
      setCity(r.document);
      setRevision(r.revision);
      setStorage(r.storage);
      setHistory([]);
      setPreview(pending);
      setSelectedFeature((pending?.document ?? r.document).environment?.features[0]?.id ?? null);
      setNeedsRegenerate(false);
      if (pending?.editor) {
        setDraft(pending.editor.parameters);
        setMode(pending.editor.mode);
        setEditId(pending.editor.mode === "update" ? pending.editor.instance_id : null);
        setActive(pending.editor.instance_id);
        setAddedId(pending.editor.mode === "add" ? pending.editor.instance_id : null);
      } else {
        setDraft(newDraft());
        setMode("add");
        setEditId(null);
        setAddedId(null);
      }
      setNotice(
        pending
          ? "已恢复独立草稿 · 正式城市尚未改变"
          : "已恢复本地项目 · 所有数据均可继续编辑",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  const document = useMemo(
    () => (displayCity && active ? placedDocument(displayCity, active) : null),
    [displayCity, active],
  );
  const selected = displayCity?.instances.find((i) => i.id === active);
  const shown = useMemo(
    () =>
      displayCity?.instances
        .filter(
          (i) =>
            (filter === "all" ||
              (filter === "landmark" &&
                !["footprint", "urban"].includes(
                  displayCity!.assets[i.asset].parameters.kind,
                )) ||
              (filter === "detail" &&
                displayCity!.assets[i.asset].parameters.kind === "urban") ||
              (filter === "context" &&
                displayCity!.assets[i.asset].parameters.kind ===
                  "footprint")) &&
            `${i.name} ${i.id}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) => Number(b.id === addedId) - Number(a.id === addedId)) ??
      [],
    [displayCity, filter, query, addedId],
  );
  useEffect(() => { setVisibleCount(40); }, [query, filter, displayCity]);
  const visibleBuildings = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount]);
  const workspaceHint: Record<WorkspaceTab, string> = {
    city: "选择建筑或查看街区；新建、导入和细化会先进入独立草稿。",
    author: "填写参数并生成建筑；检查预览后确认，才写入正式城市。",
    environment: "编辑地形与函数地物；保存后写入正式城市并保留历史版本。",
    analysis: "在场景中选点进行剖面与空间查询；分析记录可保存到城市档案。",
    detail: "查看楼层与构件；返回城市项目时可继续原来的场景工作。",
  };
  async function stage(next: CityDocument, label: string, id?: string, editor?: DraftEditor) {
    const saved = await persistDraft(
      next,
      revision,
      preview?.revision ?? null,
      label,
      editor,
    );
    setPreview({
      document: next,
      label,
      base_revision: revision,
      revision: saved.revision,
      editor,
    });
    setNeedsRegenerate(false);
    setPlacing(false);
    if (id) setActive(id);
    setQuery("");
    setFilter("all");
    setNotice("草稿已独立保存 · 检查场景后确认写入，或丢弃草稿");
  }
  async function confirmPreview() {
    if (!preview || needsRegenerate || busy || locked.current) return;
    if (preview.base_revision !== revision) {
      setError("正式城市已变化，请丢弃旧草稿并基于当前版本重新生成。");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await commitDraft(preview.revision);
      if (city) setHistory((h) => [...h.slice(-9), city]);
      setCity(preview.document);
      setRevision(result.revision);
      setStorage(result.storage);
      setSavedPath(`${result.directory}/${result.filename}`);
      setNotice(`${preview.label} · 已写入正式城市，上一版本可恢复`);
      setPreview(null);
      setNeedsRegenerate(false);
      setTab("city");
    } catch (e) {
      setError(`${String(e)}。提交未确认，可重试或重新载入核对；草稿不会重复添加。`);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function discardPreview() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      await discardDraft(preview.revision);
      setPreview(null);
      setNeedsRegenerate(false);
      setNotice("已丢弃草稿，正式城市保持原样");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function previewVersion(
    id: string,
    label: string,
    buildingsOnly = false,
  ) {
    if (busy || preview) return;
    setBusy(true);
    setError("");
    try {
      const version = await loadVersion(id);
      await stage(
        buildingsOnly && city
          ? { ...city, assets: version.assets, instances: version.instances }
          : version,
        label,
      );
      setRecovery(false);
      setTab("city");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function changeDraft(p: Parameters) {
    setDraft(p);
    if (preview) setNeedsRegenerate(true);
  }
  async function makeBlock(count: number, longitude: number, latitude: number) {
    if (!city || busy || preview) return;
    setBusy(true);
    setError("");
    try {
      const block = await generateBlock(count, longitude, latitude);
      await stage(
        {
          ...city,
          assets: { ...city.assets, ...block.assets },
          instances: [...city.instances, ...block.instances],
        },
        `已加入 ${count} 栋英式设计街区`,
        block.instances[0]?.id,
      );
      setTab("city");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const detailed =
    city?.instances.filter(
      (i) => city.assets[i.asset].parameters.kind !== "footprint",
    ).length ?? 0;
  async function commit(next: CityDocument, message: string, record = true) {
    if (locked.current) {
      setNotice("正在保存，请稍后重试");
      return false;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await persistCity(next, revision);
      if (city && record) setHistory((h) => [...h.slice(-9), city]);
      setCity(next);
      setRevision(result.revision);
      setStorage(result.storage);
      setSavedPath(`${result.directory}/${result.filename}`);
      setNotice(`${message} · 已自动保存`);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function add() {
    setMode("add");
    setEditId(null);
    setDraft({ ...newDraft(), ...scene.current?.centerPosition() });
    setPlacing(false);
    setTab("author");
  }
  function place(position: GeographicPosition | null) {
    if (!position) {
      setNotice("未选中地面，请在城市场景内重新选择位置");
      return;
    }
    if (tab === "environment")
      setEnvironmentPosition((p) => ({ ...p, ...position }));
    else setDraft((p) => ({ ...p, ...position }));
    if (preview && tab !== "environment") setNeedsRegenerate(true);
    setPlacing(false);
    setNotice(
      `已更新选址 · 橙色标记为${tab === "environment" ? "函数地物" : "建筑"}基点，保存前可继续调整`,
    );
  }
  async function saveEnvironment(environment: Environment, message: string) {
    if (!city || preview) return false;
    const ok = await commit({ ...city, environment }, message);
    if (ok) {
      setPlacing(false);
      setTerrainHit(null);
    }
    return ok;
  }
  function edit() {
    if (document) {
      setEditId(active);
      setMode("update");
      setDraft({ ...document.parameters });
      setPlacing(false);
      setTab("author");
    }
  }
  async function generate() {
    if (!city || busy || draftUnavailable || (preview && !preview.editor)) return;
    setBusy(true);
    setError("");
    try {
      const original =
        mode === "update" && editId ? placedDocument(city, editId) : null;
      const next =
        ["footprint", "urban"].includes(draft.kind) && original
          ? { ...original, parameters: { ...draft } }
          : await generateBuilding(draft);
      const id =
        mode === "update"
          ? editId!
          : preview?.editor?.instance_id ?? `b_${crypto.randomUUID().replace(/-/g, "")}`;
      await stage(
        putBuilding(city, next, id, mode === "update"),
        mode === "update" ? "已更新选中建筑" : "新建筑已加入城市",
        id,
        { mode, parameters: { ...draft }, instance_id: id },
      );
      setActive(id);
      setAddedId(mode === "add" ? id : null);
      setQuery("");
      setFilter("all");
      setPlacing(false);
      setNotice("建筑已生成预览 · 尚未写入正式城市，确认后才保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function duplicate() {
    if (!city || !document) return;
    const id = `b_${crypto.randomUUID().replace(/-/g, "")}`;
    const p = {
      ...document.parameters,
      name: `${document.parameters.name.slice(0, 70)} · 副本`,
      longitude: document.parameters.longitude + 0.00022,
    };
    setBusy(true);
    setError("");
    try {
      await stage(
        {
          ...city,
          instances: [
            ...city.instances,
            { ...selected!, id, name: p.name, longitude: p.longitude },
          ],
        },
        "已加入建筑副本",
        id,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function refine() {
    if (!city || !document || !active || busy || preview) return;
    setBusy(true);
    setError("");
    try {
      const r = await refineBuilding(document);
      await stage(
        putBuilding(city, r.document, active, true),
        "已补全选栋结构与分类颜色",
        active,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!city || !active || preview) return;
    if (await commit(removeBuilding(city, active), "已删除建筑，可撤销"))
      setActive(null);
  }
  async function undo() {
    if (preview) return;
    const previous = history[history.length - 1];
    if (previous && (await commit(previous, "已撤销上一项修改", false)))
      setHistory((h) => h.slice(0, -1));
  }
  async function importFile(chosen: File | undefined) {
    if (!chosen || !city) return;
    setBusy(true);
    setError("");
    try {
      if (chosen.size > 128 * 1024 * 1024)
        throw new Error("文件不能超过 128 MiB");
      const payload = JSON.parse(await chosen.text());
      if (payload.format === "gugis-city") {
        const r = await validateCity(payload);
        await stage(r.document, "已恢复完整城市文件");
        {
          setActive(r.document.instances[0]?.id ?? null);
          setQuery("");
          setFilter("all");
          setTab("city");
        }
      } else if (payload.type === "FeatureCollection") {
        const r = await importGeoJSON(payload);
        let next = city;
        for (const doc of r.documents)
          next = putBuilding(
            next,
            doc,
            `b_${crypto.randomUUID().replace(/-/g, "")}`,
          );
        await stage(next, `已导入 ${r.documents.length} 栋轮廓建筑`);
        setTab("city");
      } else {
        const r = await validateDocument(payload),
          id = `b_${crypto.randomUUID().replace(/-/g, "")}`;
        await stage(
          putBuilding(city, r.document, id),
          "对象文件已加入当前城市",
          id,
        );
        {
          setActive(id);
          setAddedId(id);
          setQuery("");
          setFilter("all");
          setTab("city");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "文件读取失败");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  async function exportObject() {
    if (!document) return;
    setBusy(true);
    setError("");
    try {
      const r = await saveDocument(document);
      setSavedPath(`${r.directory}/${r.filename}`);
      setNotice("选中建筑已单独保存，城市项目保持完整");
      setObjectLink(downloadUrl(r.download_path));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`studio-shell city-shell${expandedScene ? " scene-expanded" : ""}`}>
      <header className="studio-header">
        <div className="studio-brand">
          <Box size={27} />
          <strong>
            GUGIS<span>3D</span>
          </strong>
          <small>城市工作台</small>
        </div>
        <nav aria-label="工作区">
          {(
            [
              ["city", "城市项目", Grid2X2],
              ["author", "制作 / 更新", PencilRuler],
              ["environment", "地形 / 地物", Mountain],
              ["analysis", "空间分析", Route],
              ["detail", "楼栋详查", ScanLine],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              aria-current={tab === id ? "page" : undefined}
              disabled={id === "detail" && !document}
              onClick={() => setTab(id)}
            >
              <Icon size={16} aria-hidden="true" />{label}
            </button>
          ))}
        </nav>
        <span className="local-indicator">
          <i /> 本地工作区
        </span>
      </header>
      <div className="studio-titlebar">
        <div>
          <span className="eyebrow">BRISTOL <span>/</span> CITY WORKSPACE</span>
          <h1>{city?.name ?? "正在载入城市项目"}</h1>
          <p>
            {city?.instances.length ?? 0} 栋建筑 <span>／</span> {detailed}{" "}
            栋构件模型 <span>／</span> {city?.roads.length ?? 0} 条道路
          </p>
        </div>
        <div className="file-actions">
          <a className="button-link compare-launch" href="/compare" title="查看 GUGIS3D 与 ArcGIS 的证据对比">
            <ScanLine size={16} /> 对比展示
          </a>
          <button
            ref={historyButton}
            aria-expanded={recovery}
            aria-controls="city-history"
            disabled={busy || !!preview}
            onClick={() => setRecovery(!recovery)}
          >
            <History size={16} />历史版本 / 恢复
          </button>
          <button
            disabled={busy || !!preview}
            onClick={() => file.current?.click()}
          >
            <Upload size={16} />
            导入城市 / 建筑
          </button>
          <a
            className={`button-link primary ${busy ? "disabled" : ""}`}
            href={cityExportUrl}
            download
            onClick={() => setNotice("已请求导出正式城市，请确认浏览器下载完成；本地项目仍可继续编辑")}
          >
            <Download size={16} />
            导出整个城市
          </a>
        </div>
      </div>
      <div className="workspace-context" aria-label="当前工作步骤与数据状态">
        <span className="workspace-context-step">{tab === "city" ? "浏览城市" : tab === "author" ? "制作建筑" : tab === "environment" ? "编辑环境" : tab === "analysis" ? "空间分析" : "楼栋详查"}</span>
        <span className="workspace-context-hint">{workspaceHint[tab]}</span>
        <span className={`workspace-context-state${preview ? " is-draft" : ""}`}>{preview ? "独立草稿 · 待确认" : "正式项目"}</span>
      </div>
      <ProjectStatusPanel city={displayCity} revision={revision} hasDraft={!!preview}
        draftLabel={preview?.label} draftUnavailable={draftUnavailable}
        canSave={!!city && !preview && !draftUnavailable} busy={busy} activeWorkspace={tab}
        sources={{ terrain: terrainSource }}
        onAction={action => action === "recovery" ? setRecovery(true) : setTab(action)} />
      {recovery && (
        <div className="recovery-drawer" id="city-history">
          <button className="recovery-close" aria-label="关闭历史版本" onClick={() => {
            setRecovery(false);
            historyButton.current?.focus();
          }}><X size={17} /></button>
        <RecoveryPanel
          busy={busy || !!preview}
          onPreview={(id, label, buildingsOnly) =>
            void previewVersion(id, label, buildingsOnly)
          }
        />
        </div>
      )}
      {preview && city && (
        <section className="draft-banner" aria-label="未提交城市草稿">
          <div>
            <strong>草稿预览 · 正式城市尚未改变</strong>
            <p>
              {preview.label}：{city.instances.length} →{" "}
              {preview.document.instances.length} 栋建筑；
              {city.environment?.terrain?.points.length ?? 0} →{" "}
              {preview.document.environment?.terrain?.points.length ?? 0}{" "}
              个地形控制点。
              地物 {city.environment?.features.length ?? 0} → {preview.document.environment?.features.length ?? 0} 个；
              道路 {city.roads.length} → {preview.document.roads.length} 条。
            </p>
            <small>
              刷新可恢复草稿；导出整个城市仍导出正式版本。
              {needsRegenerate ? " 参数已改变，请重新生成预览。" : ""}
              {preview.base_revision !== revision
                ? " 草稿已过期，不能直接写入。"
                : ""}
            </small>
          </div>
          <button
            className="primary"
            disabled={
              busy || needsRegenerate || preview.base_revision !== revision
            }
            onClick={() => void confirmPreview()}
          >
            确认写入正式城市
          </button>
          <button disabled={busy} onClick={() => void discardPreview()}>
            丢弃草稿
          </button>
        </section>
      )}
      <input
        hidden
        type="file"
        accept=".json,.gugis,.geojson"
        ref={file}
        aria-label="选择 GUGIS 文件"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {error && (
        <div className="studio-alert" role="alert">
          <span>{error}</span>
          <button disabled={busy} onClick={() => void reload()}>
            重新载入已保存项目
          </button>
          <button aria-label="关闭错误提示" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {objectLink && (
        <div className="save-receipt">
          <span>
            选中建筑已保存到本机<code>{savedPath}</code>
          </span>
          <a href={objectLink} download>
            下载单栋文件
          </a>
          <button aria-label="关闭保存位置" onClick={() => setObjectLink("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {!city ? (
        <div className="city-loading">
          {busy ? "正在读取本地数据…" : "请确认本地服务已启动，然后重新载入。"}
        </div>
      ) : tab === "detail" && document ? (
        <DetailPanel document={document} appearanceKey={selected?.asset} colorMode={colorMode} onColorModeChange={setColorMode} expanded={expandedScene} onToggleExpanded={() => setExpandedScene((value) => !value)} />
      ) : (
        <div className={`studio-workspace city-workspace${tab === "environment" ? " environment-workspace" : ""}${tab === "analysis" ? " analysis-workspace" : ""}`}>
          <aside className="studio-left">
            {tab === "analysis" ? (<>
              {(savedAnalyses.error || analysisState.error) && <p className="analysis-caution" role="alert">{savedAnalyses.error || analysisState.error}</p>}
              {analysisState.error && !savedAnalyses.error && <button disabled={busy || analysisState.busy} onClick={analysisState.retry}>重新计算剖面</button>}
              {analysisState.busy && <p className="analysis-hint" role="status">正在后台计算原生剖面…</p>}
              <div className="spatial-tabs" role="group" aria-label="空间分析类型">
                <button className={analysisView === "route" ? "active" : ""} aria-pressed={analysisView === "route"} onClick={() => { setAnalysisView("route"); setSpatialPicking(false); }}>路线剖面</button>
                <button className={analysisView === "unified" ? "active" : ""} aria-pressed={analysisView === "unified"} onClick={() => { setAnalysisView("unified"); setAnalysisDrawing(false); }}>城市联合剖面</button>
              </div>
              {analysisView === "route" ? <AnalysisPanel points={analysisPoints} result={analysisState.result} terrain={analysisTerrain}
                drawing={analysisDrawing} busy={busy} canSave={!preview && !draftUnavailable && !savedAnalyses.error}
                records={savedAnalyses.records} selectedId={analysisId} fingerprint={fingerprint}
                onDrawing={setAnalysisDrawing} onUndo={() => { setAnalysisPoints(p => p.slice(0, -1)); setAnalysisId(null); }}
                onClear={() => { setAnalysisPoints([]); setAnalysisDrawing(false); setAnalysisId(null); setAnalysisSpacing(5); }}
                onHover={hoverAnalysis} onSave={saveAnalysis} onOpen={openAnalysis} onDelete={(id) => void deleteAnalysis(id)} />
              : <SpatialPanel city={displayCity!} points={analysisPoints} terrain={analysisTerrain} query={spatialResult} section={sectionResult} profile={analysisState.result}
                  width={sectionWidth} setWidth={setSectionWidth} picking={spatialPicking} setPicking={setSpatialPicking}
                  onFocus={focusSpatialObject} onSave={saveAnalysis} canSave={!preview && !draftUnavailable && !savedAnalyses.error}
                  busy={busy || analysisState.busy} selectedName={savedAnalyses.records.find(record => record.id === analysisId)?.name ?? null}
                  hasSavedRecord={!!analysisId} onEnvironment={() => { setSpatialPicking(false); setTab("environment"); }} />}
            </>) : tab === "environment" ? (
              <EnvironmentPanel
                environment={displayCity!.environment}
                initialSection={typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "terrain" ? "terrain" : undefined}
                busy={busy || !!preview}
                save={saveEnvironment}
                position={environmentPosition}
                setPosition={setEnvironmentPosition}
                placing={placing}
                onPick={() => {
                  setPlacing((p) => !p);
                  setQueryTerrain(false);
                }}
                onCenter={() => place(scene.current?.centerPosition() ?? null)}
                selected={selectedFeature}
                onSelect={setSelectedFeature}
                focus={(id) => scene.current?.focusFeature(id)}
                opacity={terrainOpacity}
                setOpacity={setTerrainOpacity}
                wire={terrainWire}
                setWire={setTerrainWire}
                query={queryTerrain}
                setQuery={(q) => {
                  setQueryTerrain(q);
                  setPlacing(false);
                }}
                hit={terrainHit}
                onEditingChange={setEnvironmentEditing}
              />
            ) : tab === "author" ? (
              <>
                {preview && !preview.editor && <p className="form-note">当前为导入、街区或恢复草稿，请先确认或丢弃，再制作单栋建筑。</p>}
                <AuthorForm
                  draft={draft}
                  setDraft={changeDraft}
                  mode={mode}
                  busy={busy || draftUnavailable || (!!preview && !preview.editor)}
                  onGenerate={() => void generate()}
                  placing={placing}
                  onPickPosition={() => setPlacing((p) => !p)}
                  onUseViewCenter={() =>
                    place(scene.current?.centerPosition() ?? null)
                  }
                />
                <BlockForm
                  busy={busy || draftUnavailable || !!preview}
                  longitude={draft.longitude}
                  latitude={draft.latitude}
                  onGenerate={(...args) => void makeBlock(...args)}
                />
              </>
            ) : (
              <>
                <div className="panel-heading">
                  <h2>城市对象</h2>
                  <span className="object-count">{displayCity!.instances.length}</span>
                </div>
                <div className="city-list-tools">
                  <button
                    className="primary full"
                    onClick={add}
                    disabled={busy || !!preview}
                  >
                    <Plus size={16} />
                    添加建筑
                  </button>
                  <div className="city-search-field">
                  <Search size={15} aria-hidden="true" />
                  <input
                    aria-label="搜索城市建筑"
                    placeholder="搜索建筑名称或编号"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  </div>
                  <select
                    aria-label="建筑筛选"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="landmark">地标与设计街屋</option>
                    <option value="detail">已细化街区建筑</option>
                    <option value="context">待细化轮廓</option>
                    <option value="all">全部建筑</option>
                  </select>
                  <small>显示 {Math.min(visibleCount, shown.length)} / {shown.length} 个匹配对象</small>
                </div>
                {selected && !visibleBuildings.some(i => i.id === selected.id) && (
                  <div className="city-current-selection" aria-label="当前选中建筑">
                    <small>当前选中 · 不在本批列表</small>
                    <button onClick={() => { setFilter("all"); setQuery(selected.id); }}>
                      {selected.name}<Search size={13} aria-hidden="true" />
                    </button>
                  </div>
                )}
                <div className="city-building-list">
                  {visibleBuildings.map((i) => (
                    <button
                      key={i.id}
                      className={active === i.id ? "selected" : ""}
                      aria-pressed={active === i.id}
                      onClick={() => setActive(i.id)}
                    >
                      <strong>{i.name}</strong>
                      <span>
                        {kinds[displayCity!.assets[i.asset].parameters.kind]}
                      </span>
                    </button>
                  ))}
                  {!shown.length && <p className="muted">没有匹配的建筑</p>}
                  {shown.length > visibleCount && (
                    <button className="city-list-more" onClick={() => setVisibleCount(count => count + 40)}>
                      再显示 40 栋 · 剩余 {shown.length - visibleCount} 栋
                    </button>
                  )}
                </div>
              </>
            )}
          </aside>
          <main className="studio-center" ref={sceneRegion}>
            <div className="scene-topline">
              <div>
                <span className="live-dot" />
                布里斯托城市项目<small>WGS84 · 离线实体数据</small>
              </div>
              <div className="scene-tools">
                <button
                  aria-label={expandedScene ? "恢复场景面板" : "放大场景"}
                  title={expandedScene ? "恢复面板（Esc）" : "放大场景"}
                  aria-pressed={expandedScene}
                  onClick={() => setExpandedScene((value) => !value)}
                >
                  {expandedScene ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                </button>
                <button
                  aria-label="城市俯视"
                  title="城市俯视"
                  onClick={() => scene.current?.top()}
                >
                  <Layers3 size={17} />
                </button>
                <button
                  aria-label="定位城市选中建筑"
                  title="定位选中建筑"
                  disabled={!selected}
                  onClick={() => scene.current?.focus()}
                >
                  <LocateFixed size={17} />
                </button>
                <button
                  aria-label="城市全景"
                  title="城市全景"
                  onClick={() => scene.current?.reset()}
                >
                  <RotateCcw size={17} />
                </button>
              </div>
            </div>
            <div className="scene-area">
              <CityScene
                key={sceneRevision}
                onRetry={() => setSceneRevision(value => value + 1)}
                ref={scene}
                city={displayCity!}
                colorMode={colorMode}
                fullDetails={fullDetails}
                selected={active}
                onSelect={select}
                context={context}
                placement={
                  tab === "author"
                    ? draft
                    : tab === "environment" &&
                        environmentEditing &&
                        !queryTerrain
                      ? environmentPosition
                      : undefined
                }
                placementKind={tab === "environment" ? "feature" : "building"}
                placing={
                  (tab === "author" || tab === "environment") &&
                  placing &&
                  !busy
                }
                onPlace={place}
                terrainOpacity={terrainOpacity}
                terrainWire={terrainWire}
                queryTerrain={tab === "environment" && queryTerrain}
                onTerrainQuery={setTerrainHit}
                analysisDrawing={tab === "analysis" && analysisDrawing}
                analysisPoints={tab === "analysis" ? analysisPoints : undefined}
                analysisProfile={tab === "analysis" ? analysisState.result : null}
                analysisHover={tab === "analysis" ? analysisHover : null}
                onAnalysisPoint={appendAnalysisPoint}
                spatialPicking={tab === "analysis" && analysisView === "unified" && spatialPicking}
                spatialPoint={tab === "analysis" && analysisView === "unified" ? spatialSelection?.position : null}
                onSpatialPoint={inspectSpatialPoint}
                selectedFeature={selectedFeature}
                featureLayer={featureLayer}
                isolateFeature={isolateFeature}
                showFeatureMarkers={showFeatureMarkers}
                onFeatureSelect={(id) => {
                  setSelectedFeature(id);
                  setTab("environment");
                }}
              />
              {tab === "analysis" && spatialPicking ? (
                <div className="city-placement-notice" role="status"><strong>单击场景做地上 / 地下联合查询</strong><span>原生地形与附近模型将一起显示；按 Esc 结束。</span><button onClick={() => setSpatialPicking(false)}>完成查询</button></div>
              ) : tab === "analysis" && analysisDrawing ? (
                <div className="city-placement-notice" role="status"><strong>单击地面绘制路线 · {analysisPoints.length} / 64 点</strong><span>绿色为原生地形采样线，金色为选点折线。Esc 完成绘制，视角保持不变。</span><button onClick={() => setAnalysisDrawing(false)}>完成绘制</button></div>
              ) : tab === "environment" && (placing || queryTerrain) ? (
                <div className="city-placement-notice" role="status">
                  <strong>
                    {placing
                      ? "点击场景设置函数地物基点"
                      : "点击地形查询原生面带"}
                  </strong>
                  <span>
                    {queryTerrain
                      ? "返回高程、坡度、坡向和局部参数；按 Esc 结束查询。"
                      : "保留当前视角，位置将回填到地物表单；按 Esc 取消选址。"}
                  </span>
                </div>
              ) : tab === "author" ? (
                <div className="city-placement-notice" role="status">
                  <strong>
                    {placing
                      ? "点击场景地面，确定建筑基点"
                      : "橙色标记为建筑基点"}
                  </strong>
                  <span>添加后保留当前视角；可通过左侧按钮重新选址。</span>
                </div>
              ) : addedId === active && selected ? (
                <div className="city-placement-notice" role="status">
                  <strong>
                    {preview ? "草稿：" : "已添加："}
                    {selected.name}
                  </strong>
                  <span>已保留视角，橙色标记指向新建筑。</span>
                  <button onClick={() => scene.current?.focus()}>
                    <LocateFixed size={15} /> 定位新建筑
                  </button>
                  <button
                    aria-label="关闭添加提示"
                    onClick={() => setAddedId(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : null}
              <div className="scene-annotation">
                <span>城市复现 · 起始街区</span>
                {displayCity!.environment?.terrain && (
                  <strong className="terrain-scene-label">
                    {displayCity!.environment.terrain.demonstration
                      ? "演示地形 · 非实测"
                      : "用户 DEM · 相对高程显示"}
                  </strong>
                )}
                <small>© OpenStreetMap contributors</small>
              </div>
              <div className="scene-help">
                拖动平移 · 中键旋转 · 滚轮缓速缩放 · 点击选栋
              </div>
              <ComponentLegend colorMode={colorMode} />
            </div>
            <div className="city-view-options">
              <label>
                <input
                  type="checkbox"
                  checked={context}
                  onChange={(e) => setContext(e.target.checked)}
                />
                显示街区建筑
              </label>
              <button
                disabled={busy || !!preview || !history.length}
                onClick={() => void undo()}
              >
                <Undo2 size={15} />
                撤销修改
              </button>
              <label className="palette-select">建筑配色
                <select aria-label="建筑配色" value={colorMode} onChange={e => setColorMode(e.target.value as BuildingColorMode)}>
                  <option value="material">自然材质</option>
                  <option value="category">构件分类</option>
                </select>
              </label>
              <label title="按视野与距离自动加载窗户、门、柱与屋顶，无需点选；远处保留轮廓并释放精细模型缓存。关闭后使用轻量概览。">
                <input type="checkbox" checked={fullDetails} onChange={e => setFullDetails(e.target.checked)} />
                自动精细结构
              </label>
            </div>
          </main>
          <aside className="studio-right">
            {tab === "environment" && (
              <div className="environment-overview">
                <h3>统一环境表达</h3>
                <p>地形 · 地物 · 地上 / 地下</p>
                <div className="feature-view-controls">
                  <label>
                    地物显示范围
                    <select aria-label="地物显示范围" value={featureLayer} onChange={(e) => setFeatureLayer(e.target.value as typeof featureLayer)}>
                      <option value="all">地上与地下</option>
                      <option value="surface">仅地上地物</option>
                      <option value="underground">仅地下地物</option>
                    </select>
                  </label>
                  <label className="check-row">
                    <input type="checkbox" checked={isolateFeature} disabled={!selectedFeature} onChange={(e) => setIsolateFeature(e.target.checked)} />
                    只看选中地物
                  </label>
                  <label className="check-row">
                    <input type="checkbox" checked={showFeatureMarkers} onChange={(e) => setShowFeatureMarkers(e.target.checked)} />
                    显示地物定位标记
                  </label>
                </div>
                <p>
                  {displayCity!.environment?.features.length ?? 0}{" "}
                  个函数地物实例，
                  {
                    Object.keys(displayCity!.environment?.feature_assets ?? {})
                      .length
                  }{" "}
                  个共享定义。
                </p>
                <details className="inspector-fold">
                <summary>显示与数据说明</summary>
                <p className="muted">仅改变视图。地形不透明度设为 0 并关闭面带边界，可检查完整地物；地上实体仍会遮住其下方对象。</p>
                <p className="muted">函数和面带拓扑随整个城市保存。</p>
                <p className="muted">
                  当前实现为 GUGIS
                  理论的工程原型。效率优势需在相同精度、完整数据和查询工作负载下继续对比验证。
                </p>
                </details>
              </div>
            )}
            <div className="panel-heading">
              <h2>{selected ? "选中建筑" : "项目说明"}</h2>
              <Building2 size={17} />
            </div>
            <div className="inspector-content">
              {selected && document ? (
                <>
                  <span className="object-kind">
                    {kinds[document.parameters.kind]}
                  </span>
                  <h3>{selected.name}</h3>
                  <code className="object-id">{selected.id}</code>
                  <div className="city-object-actions">
                    {document.parameters.kind === "footprint" && (
                      <button
                        className="primary full"
                        disabled={busy || !!preview}
                        onClick={() => void refine()}
                      >
                        补全精细结构
                      </button>
                    )}
                    <button
                      className="primary full"
                      onClick={() => setTab("detail")}
                    >
                      查看实体与楼层
                    </button>
                    <button disabled={busy || !!preview} onClick={edit}>
                      修改建筑
                    </button>
                    <button
                      disabled={busy || !!preview}
                      onClick={() => void duplicate()}
                    >
                      <Copy size={14} />
                      复制
                    </button>
                    <button
                      disabled={busy || !!preview}
                      onClick={() => void remove()}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                    <button disabled={busy} onClick={() => void exportObject()}>
                      单栋导出
                    </button>
                  </div>
                  <section>
                    <h4>地理定位</h4>
                    <dl>
                      <dt>经度</dt>
                      <dd>{selected.longitude.toFixed(6)}</dd>
                      <dt>纬度</dt>
                      <dd>{selected.latitude.toFixed(6)}</dd>
                      <dt>朝向</dt>
                      <dd>{selected.heading}°</dd>
                      <dt>构件数</dt>
                      <dd>{document.nodes.filter((n) => n.template).length}</dd>
                      <dt>共享模型</dt>
                      <dd>
                        {
                          displayCity!.instances.filter(
                            (i) => i.asset === selected.asset,
                          ).length
                        }{" "}
                        栋使用
                      </dd>
                    </dl>
                  </section>
                  <details className="inspector-fold">
                    <summary>来源与精度</summary>
                    {Object.entries(document.nodes[0].attributes ?? {}).map(
                      ([k, v]) => (
                        <p className="source-note" key={k}>
                          <b>{k}</b>
                          {v.startsWith("https://") ? (
                            <a href={v} target="_blank" rel="noreferrer">
                              查看参考资料 ↗
                            </a>
                          ) : (
                            <span>{v}</span>
                          )}
                        </p>
                      ),
                    )}
                  </details>
                </>
              ) : (
                <p className="muted">
                  点击场景或左侧列表选择建筑，可以修改、复制、删除和查看内部结构。
                </p>
              )}
              <details className="inspector-fold">
                <summary>建筑几何复用</summary>
                {storage && (
                  <>
                    <dl>
                      <dt>独立几何原型</dt>
                      <dd>{storage.shared_geometries.toLocaleString()}</dd>
                      <dt>构件实例</dt>
                      <dd>{storage.component_instances.toLocaleString()}</dd>
                      <dt>每原型平均引用</dt>
                      <dd>
                        {(
                          storage.component_instances /
                          Math.max(1, storage.shared_geometries)
                        ).toFixed(1)}{" "}
                        次
                      </dd>
                    </dl>
                    <p className="muted">
                      相同几何在全城保存一份，尺寸参数与分类颜色分别保留。几何原型数量不包含城市概览专用几何。
                    </p>
                  </>
                )}
              </details>
              <details className="inspector-fold">
                <summary>城市文件与数据来源</summary>
                <p className="muted">
                  模型定义、建筑实例、地理位置、道路和来源说明保存在同一 GUGIS
                  项目中。支持单栋 GUGIS 文件及 WGS84 GeoJSON Polygon
                  追加；读取城市文件会恢复整个项目，并保留替换前版本。
                </p>
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  街区数据：OpenStreetMap / ODbL
                </a>
              </details>
            </div>
          </aside>
        </div>
      )}
      {city && <MemoryComparison revision={revision} />}
      {city && (
        <div className="city-summary">
          <span>
            <b>{city.instances.length}</b> 建筑实例
          </span>
          <span>
            <b>{Object.keys(city.assets).length}</b> 楼栋模型
          </span>
          {storage && (
            <span>
              <b>{storage.shared_geometries.toLocaleString()}</b> 几何原型 ·{" "}
              <b>
                {(
                  storage.component_instances /
                  Math.max(1, storage.shared_geometries)
                ).toFixed(1)}
              </b>{" "}
              次平均引用
            </span>
          )}
          <span>
            <b>{city.roads.length}</b> 道路要素
          </span>
          <span>地标为参考模型 · 轮廓高度多为推算 · 平面底稿</span>
        </div>
      )}
      <footer className="studio-status">
        <span role="status">{busy ? "正在处理，请稍候…" : notice}</span>
        <span title={savedPath || "GUGIS3D/.local/city/current.gugis.json"}>
          {savedPath ? "本地文件已写入" : "本地城市工作区"}
        </span>
        <span>
          {city?.environment
            ? "City 1.2 · 函数地物与地形"
            : "City 1.1 · 共享几何"}
        </span>
      </footer>
    </div>
  );
}
