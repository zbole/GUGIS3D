import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CityScene, { type CitySceneHandle } from "./CityScene";
import LoadedBuildingInspector from "./LoadedBuildingInspector";
import { loadedBuildings } from "./loadedBuildings";
import { useTileLoadingControl } from "./useTileLoadingControl";
import { cityCenter, heightPolicyLabel, type CityWorkspace } from "./cityWorkspaces";
import { loadRenderManifest, RenderPackageUnavailable, RenderTileStream, renderTilesToCity, tileBudget,
  type RenderManifest, type RenderView, type TileStreamState } from "./renderTileClient";
import "./CityTilePreview.css";

export interface CityTilePreviewProps {
  workspace: CityWorkspace;
  onWorkspaceState?: (id: string, busy: boolean, hasDraft: boolean) => void;
}
const emptyStream: TileStreamState = { tiles: [], wanted: 0, candidates: 0, omitted: 0,
  loading: 0, activeBytes: 0, cacheTiles: 0, cacheBytes: 0, failures: [] };
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
function safeLink(value: string): string | undefined {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}
/** A keyed session also protects callers that forget to key their workspace switch. */
export default function CityTilePreview(props: CityTilePreviewProps) {
  return <TilePreviewSession key={props.workspace.id} {...props} />;
}
function TilePreviewSession({ workspace, onWorkspaceState }: CityTilePreviewProps) {
  const center = useMemo(() => cityCenter(workspace), [workspace.id]);
  const [manifest, setManifest] = useState<RenderManifest | null>(null);
  const [freshness, setFreshness] = useState<"current" | "unknown">("unknown");
  const [streamState, setStreamState] = useState<TileStreamState>(emptyStream);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const { manualPaused, pageHidden, paused, setManualPaused } = useTileLoadingControl();
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const projection = useMemo(() => manifest ? renderTilesToCity(manifest, streamState.tiles) : null, [manifest, streamState.tiles]);
  const buildings = useMemo(() => manifest ? loadedBuildings(manifest, streamState.tiles) : [], [manifest, streamState.tiles]);
  const loadedIds = useRef(new Set<string>());
  loadedIds.current = new Set(buildings.map(building => building.placement.id));
  const activeSelected = selected && loadedIds.current.has(selected) ? selected : null;
  const scene = useRef<CitySceneHandle>(null), stream = useRef<RenderTileStream | null>(null);
  const selectedRef = useRef(activeSelected); selectedRef.current = activeSelected;
  const view = useRef<RenderView>({ bounds: null, center });
  useEffect(() => { stream.current?.setPaused(paused); }, [paused]);
  useEffect(() => {
    // Read-only requests are cancellable. Never lock workspace navigation or claim a draft.
    onWorkspaceState?.(workspace.id, false, false);
  }, [workspace.id, onWorkspaceState]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true, session: RenderTileStream | null = null;
    setLoadingManifest(true); setError(""); setUnavailable(false); setManifest(null);
    setStreamState(emptyStream); setSelected(null); selectedRef.current = null;
    const timeout = setTimeout(() => controller.abort(), 20000);
    const base = (import.meta.env?.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
    void loadRenderManifest(workspace.id, controller.signal, base).then(result => {
      if (!active) return;
      clearTimeout(timeout);
      setManifest(result.manifest); setFreshness(result.freshness);
      session = new RenderTileStream(result.manifest, state => { if (active) setStreamState(state); }, { base });
      stream.current = session;
      // A newly checked manifest must not start tile reads behind a pause.
      session.setPaused(pausedRef.current); session.setView(view.current);
    }).catch(reason => {
      if (!active) return;
      setUnavailable(reason instanceof RenderPackageUnavailable);
      setError(controller.signal.aborted ? "渲染清单读取超时，请重试" : reason instanceof Error ? reason.message : "渲染包读取失败");
    }).finally(() => { clearTimeout(timeout); if (active) setLoadingManifest(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); session?.dispose(); if (stream.current === session) stream.current = null; };
  }, [workspace.id, attempt]);
  const onViewBounds = useCallback((next: RenderView) => {
    view.current = next; stream.current?.setView(next, selectedRef.current);
  }, []);
  const onSelect = useCallback((id: string | null) => {
    // Ignore a scene/list callback for a building already evicted from this session.
    if (id !== null && !loadedIds.current.has(id)) return;
    selectedRef.current = id; setSelected(id); stream.current?.setView(view.current, id);
  }, []);
  useEffect(() => { if (selected && !activeSelected) onSelect(null); }, [selected, activeSelected, onSelect]);
  const onFocus = useCallback((id: string) => {
    if (loadedIds.current.has(id)) scene.current?.focusBuilding(id);
  }, []);
  const source = workspace.id === "bristol" ? "backend/data/bristol.gugis.json" : `backend/data/cities/${workspace.id}.gugis.json`;
  const attribution = manifest?.attribution;
  const sourceLink = safeLink(attribution?.license_url ?? "") ?? safeLink(attribution?.metadata.source_url ?? "");
  const partial = !!manifest && (streamState.tiles.length < manifest.counts.tiles || (projection?.instances.length ?? 0) < manifest.counts.buildings);
  return <section className="city-tile-preview" aria-label={`${workspace.name}只读分块浏览`}>
    <header className="tile-preview-heading">
      <div><strong>{workspace.name} · 只读分块浏览</strong><p>{workspace.coverage_label} · 当前视口按需读取，保留源几何</p></div>
      <div className="tile-preview-actions">
        {projection && <button type="button" onClick={() => scene.current?.reset()}>已加载范围</button>}
        {activeSelected && <button type="button" onClick={() => onSelect(null)}>取消建筑选择</button>}
        {manifest && <button type="button" aria-pressed={manualPaused} onClick={() => setManualPaused(value => !value)}>
          {manualPaused ? "恢复瓦片读取" : "暂停瓦片读取"}
        </button>}
        <button type="button" disabled={loadingManifest} onClick={() => setAttempt(value => value + 1)}>重新检查渲染包</button>
      </div>
    </header>
    <div className="tile-preview-status" role="status" aria-live="polite">
      {loadingManifest ? "正在读取有界渲染清单…" : manifest ? <>
        已加载 {projection?.instances.length ?? 0} / {manifest.counts.buildings} 栋（跨瓦片去重），{streamState.tiles.length} / {manifest.counts.tiles} 瓦片
        {` · ${paused ? "暂停前视口目标" : "当前视口目标"} ${streamState.wanted} / ${streamState.candidates} 瓦片 · ${streamState.loading} 个待加载`}
        {paused && <strong> · {pageHidden ? "页面已隐藏，自动暂停瓦片读取" : "已暂停瓦片读取，保持已加载画面"}</strong>}
        {partial && <strong> · 局部加载，并非完整覆盖</strong>}
        {streamState.omitted > 0 && <strong> · 预算暂缓 {streamState.omitted} 瓦片，缩小视口或移动相机继续读取</strong>}
        <small>驻留源字节 {megabytes(streamState.activeBytes)} / {megabytes(tileBudget.activeBytes)} MiB · 缓存 {streamState.cacheTiles} / {tileBudget.cacheTiles} 瓦片，{megabytes(streamState.cacheBytes)} / {megabytes(tileBudget.cacheBytes)} MiB · 最多 {tileBudget.concurrency} 个并发请求；非 GPU / JS 内存测量</small>
        {paused && <small>相机与建筑详情仍可使用；恢复后按最新视口继续读取。手动暂停不会因页面重新显示而取消。</small>}
      </> : "尚未加载几何"}
    </div>
    {error && <div className="tile-preview-error" role="alert"><strong>{error}</strong>
      {unavailable && <><p>需先在本机仓库离线构建此城市的渲染包，然后重试。不会自动生成、初始化或替换正式城市。</p>
        <code>python data-pipeline/build_render_tiles.py {source} --city {workspace.id}</code>
        <p>若要查看已保存项目，请将输入路径替换为该项目的 current.gugis.json。构建方法见 docs/render_tiles.md。</p></>}
      <button type="button" onClick={() => setAttempt(value => value + 1)}>重试读取清单</button>
    </div>}
    {streamState.failures.length > 0 && <div className="tile-preview-error" role="alert">
      <strong>{streamState.failures.length} 个瓦片未加载；画面仍不完整</strong>
      <ul>{streamState.failures.map(f => <li key={f.id}>{f.id}：{f.message}</li>)}</ul>
      <button type="button" disabled={paused} onClick={() => stream.current?.retry()}>重试失败瓦片</button>
    </div>}
    {manifest && <details className="tile-preview-provenance" open>
      <summary>来源修订与缺失图层</summary>
      <p>来源 SHA-256：<code>{manifest.revision}</code></p>
      <p>{freshness === "current" ? "已验证当前快照：服务端确认离线来源文件身份、大小与时间戳仍匹配（本次清单检查时）" : "新鲜度未知：可能已过期，未验证与当前正式文件一致"}</p>
      <p>仅建筑渲染；道路、地形、功能要素和语义均未包含。源文件的 {manifest.counts.source_roads} 条道路不在此视图中；不代表完整城市或实测高度。</p>
      <p>{sourceLink ? <a href={sourceLink} target="_blank" rel="noreferrer">{attribution?.source || attribution?.license || "查看来源许可"}</a> : attribution?.source} {attribution?.license}</p>
      {attribution?.metadata.coverage_label && <p>{attribution.metadata.coverage_label}</p>}
      {attribution?.metadata.height_policy && <p>{heightPolicyLabel(attribution.metadata.height_policy)}</p>}
      {attribution?.metadata["精度说明"] && <p>{attribution.metadata["精度说明"]}</p>}
      {attribution?.metadata["采样说明"] && <p>{attribution.metadata["采样说明"]}</p>}
      {manifest.quality_warnings.map((warning, i) => <p className="tile-preview-warning" key={`${warning.code}-${i}`}>{warning.message}</p>)}
      <small>上述质量警告只适用于此完整来源修订；浏览器未修正源模型。选中建筑保留包内全部构件（若有既有总览，则为总览构件），并固定一个关联瓦片，仍受瓦片硬预算限制。</small>
    </details>}
    <div className="tile-preview-content">
      {manifest && <LoadedBuildingInspector key={`${manifest.city_id}:${manifest.revision}:${attempt}`}
        buildings={buildings} manifest={manifest} selected={activeSelected} onSelect={onSelect} onFocus={onFocus} />}
      <div className="tile-preview-scene">
        {projection ? <CityScene ref={scene} city={projection} center={center} selected={activeSelected} onSelect={onSelect}
          context fullDetails={false} showGround={false} renderOnly onViewBounds={onViewBounds} /> : <p>几何将在渲染包验证通过后显示</p>}
      </div>
    </div>
  </section>;
}
