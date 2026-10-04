import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, LocateFixed, Link2, Pause, Play, RefreshCw } from "lucide-react";
import { cameraBookmarkUrl, noCameraNavigation, type CameraBookmark, type CameraNavigation } from "./cameraBookmark";
import { defaultCameraTarget } from "./cameraFraming";
import CityScene, { type CitySceneHandle, type CameraViewRequest } from "./CityScene";
import LoadedBuildingInspector from "./LoadedBuildingInspector";
import { loadedBuildings } from "./loadedBuildings";
import { useTileLoadingControl } from "./useTileLoadingControl";
import { cityCenter, heightPolicyLabel, type CityWorkspace, type CityId } from "./cityWorkspaces";
import { loadRenderManifest, RenderPackageUnavailable, RenderTileStream, renderTilesToCity, tileLoadingProfiles, normalizeTileLoadingProfile,
  type RenderManifest, type RenderView, type TileStreamState, type TileLoadingProfile } from "./renderTileClient";
import "./CityTilePreview.css";

export interface CityTilePreviewProps {
  workspace: CityWorkspace;
  tileProfile?: TileLoadingProfile;
  onTileProfileChange?: (profile: TileLoadingProfile, bookmark?: CameraBookmark) => void;
  cameraNavigation?: CameraNavigation;
  onCameraBookmarkDismiss?: () => void;
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
  const tileProfile = normalizeTileLoadingProfile(props.tileProfile);
  return <TilePreviewSession key={`${props.workspace.id}:${tileProfile}`} {...props} tileProfile={tileProfile} />;
}
function TilePreviewSession({ workspace, tileProfile = "balanced", onTileProfileChange, onWorkspaceState, cameraNavigation = noCameraNavigation, onCameraBookmarkDismiss }: CityTilePreviewProps) {
  const budget = tileLoadingProfiles[tileProfile];
  const sessionActive = useRef(true);
  const center = useMemo(() => cityCenter(workspace), [workspace.id]);
  const [manifest, setManifest] = useState<RenderManifest | null>(null);
  const [freshness, setFreshness] = useState<"current" | "unknown">("unknown");
  const [streamState, setStreamState] = useState<TileStreamState>(emptyStream);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [dismissedSequence, setDismissedSequence] = useState<number | null>(null);
  const [failedCamera, setFailedCamera] = useState<string | null>(null);
  const [readyCamera, setReadyCamera] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [copyLink, setCopyLink] = useState("");
  const copyAttempt = useRef(0);
  const result = dismissedSequence === cameraNavigation.sequence ? noCameraNavigation.result : cameraNavigation.result;
  const bookmark = result.kind === "valid" ? result.bookmark : null;
  const mismatch = !!manifest && !!bookmark && bookmark.revision !== manifest.revision;
  const invalidCity = !!bookmark && bookmark.city !== workspace.id;
  const cameraKey = `${cameraNavigation.sequence}:${attempt}:${dismissedSequence === cameraNavigation.sequence ? "default" : "link"}`;
  const blocked = result.kind === "invalid" || invalidCity || mismatch || failedCamera === cameraKey;
  const cameraRequest = useMemo<CameraViewRequest | undefined>(() => {
    if (blocked || !manifest) return undefined;
    if (bookmark) return { sequence: cameraKey, pose: bookmark.pose };
    // Default navigation aims at the verified sample footprint. A camera placed
    // above its center with an oblique pitch would look past the sample.
    if (cameraNavigation.sequence > 0 || dismissedSequence !== null) return { sequence: cameraKey,
      target: defaultCameraTarget(manifest.bounds_wgs84, center) };
    return undefined;
  }, [blocked, manifest, cameraKey, bookmark, cameraNavigation.sequence, dismissedSequence, center]);
  const gate = useRef({ blocked, sequence: cameraRequest?.sequence });
  gate.current = { blocked, sequence: cameraRequest?.sequence };
  const readySequence = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const inspectorId = useId();
  const moreTools = useRef<HTMLDetailsElement>(null);
  const closeMoreTools = (restoreFocus = false) => {
    if (moreTools.current) {
      moreTools.current.open = false;
      if (restoreFocus) moreTools.current.querySelector?.("summary")?.focus();
    }
  };
  useEffect(() => {
    if (typeof document === "undefined") return;
    const owner = document;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreTools.current?.contains(event.target)) closeMoreTools();
    };
    owner.addEventListener("pointerdown", closeOutside);
    return () => owner.removeEventListener("pointerdown", closeOutside);
  }, []);
  const { manualPaused, pageHidden, paused, setManualPaused } = useTileLoadingControl();
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const projection = useMemo(() => manifest ? renderTilesToCity(manifest, streamState.tiles) : null, [manifest, streamState.tiles]);
  const buildings = useMemo(() => manifest ? loadedBuildings(manifest, streamState.tiles) : [], [manifest, streamState.tiles]);
  const loadedIds = useRef(new Set<string>());
  loadedIds.current = new Set(buildings.map(building => building.placement.id));
  const activeSelected = selected && loadedIds.current.has(selected) ? selected : null;
  const scene = useRef<CitySceneHandle>(null), stream = useRef<RenderTileStream | null>(null);
  const sceneContainer = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(activeSelected); selectedRef.current = activeSelected;
  const view = useRef<RenderView>({ bounds: null, center });
  useEffect(() => {
    const session = stream.current;
    if (!session) return;
    const waiting = !!cameraRequest && readySequence.current !== cameraRequest.sequence;
    session.setPaused(true);
    if (!blocked && !waiting) { session.setView(view.current, selectedRef.current); session.setPaused(paused); }
  }, [paused, blocked, cameraRequest?.sequence, manifest]);
  useEffect(() => {
    ++copyAttempt.current; setCopyMessage(""); setCopyLink("");
    selectedRef.current = null; setSelected(null);
  }, [cameraNavigation.sequence, attempt]);
  useEffect(() => { sessionActive.current = true; return () => { sessionActive.current = false; ++copyAttempt.current; }; }, []);
  useEffect(() => {
    // Read-only requests are cancellable. Never lock workspace navigation or claim a draft.
    onWorkspaceState?.(workspace.id, false, false);
  }, [workspace.id, onWorkspaceState]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true, session: RenderTileStream | null = null;
    setLoadingManifest(true); setError(""); setUnavailable(false); setManifest(null);
    setStreamState(emptyStream); setSelected(null); selectedRef.current = null;
    readySequence.current = null; setReadyCamera(null); setFailedCamera(null);
    const timeout = setTimeout(() => controller.abort(), 20000);
    const base = (import.meta.env?.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
    void loadRenderManifest(workspace.id, controller.signal, base).then(result => {
      if (!active) return;
      clearTimeout(timeout);
      session = new RenderTileStream(result.manifest, state => { if (active) setStreamState(state); }, { base, budget });
      stream.current = session;
      // A newly checked manifest must not start tile reads behind a pause.
      // React applies the accepted navigation only after this verified manifest.
      // In particular, never issue a center/all-tiles burst before restoring a link.
      session.setPaused(true);
      setFreshness(result.freshness); setManifest(result.manifest);
    }).catch(reason => {
      if (!active) return;
      setUnavailable(reason instanceof RenderPackageUnavailable);
      setError(controller.signal.aborted ? "渲染清单读取超时，请重试" : reason instanceof Error ? reason.message : "渲染包读取失败");
    }).finally(() => { clearTimeout(timeout); if (active) setLoadingManifest(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); session?.dispose(); if (stream.current === session) stream.current = null; };
  }, [workspace.id, attempt, budget]);
  const onViewBounds = useCallback((next: RenderView, sequence?: string) => {
    if (!sessionActive.current) return;
    const current = gate.current;
    if (current.blocked || sequence !== current.sequence) return;
    if (sequence && readySequence.current !== sequence && (!next.bounds || !next.bounds.every(Number.isFinite))) {
      setFailedCamera(sequence); stream.current?.setPaused(true); return;
    }
    view.current = next;
    readySequence.current = sequence ?? null; setReadyCamera(sequence ?? null);
    stream.current?.setView(next, selectedRef.current);
    stream.current?.setPaused(pausedRef.current);
  }, []);
  const onSelect = useCallback((id: string | null) => {
    if (!sessionActive.current) return;
    // Ignore a scene/list callback for a building already evicted from this session.
    if (id !== null && !loadedIds.current.has(id)) return;
    if (id !== null) setInspectorOpen(true);
    selectedRef.current = id; setSelected(id);
    if (!gate.current.blocked && (!gate.current.sequence || readySequence.current === gate.current.sequence)) stream.current?.setView(view.current, id);
  }, []);
  useEffect(() => { if (selected && !activeSelected) onSelect(null); }, [selected, activeSelected, onSelect]);
  const onFocus = useCallback((id: string) => {
    if (sessionActive.current && loadedIds.current.has(id)) scene.current?.focusBuilding(id);
  }, []);
  const useCurrentDefault = () => {
    if (!sessionActive.current) return;
    setDismissedSequence(cameraNavigation.sequence); setFailedCamera(null);
    readySequence.current = null; setReadyCamera(null);
    onCameraBookmarkDismiss?.();
  };
  const copyCurrentView = async () => {
    if (!sessionActive.current) return;
    const token = ++copyAttempt.current;
    setCopyMessage(""); setCopyLink("");
    if (!manifest || blocked) return;
    const pose = scene.current?.getCameraPose();
    if (!pose) { setCopyMessage("当前视角没有有限的地球椭球视域，或相机超出链接范围；请调整相机后重试。"); return; }
    try {
      const link = cameraBookmarkUrl(window.location.href, { city: manifest.city_id as CityId, revision: manifest.revision, pose });
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(link);
        if (copyAttempt.current === token) setCopyMessage("视角链接已复制");
      } catch {
        if (copyAttempt.current === token) { setCopyLink(link); setCopyMessage("无法自动复制，请选择下面的链接手动复制。"); }
      }
    } catch (reason) { if (copyAttempt.current === token) setCopyMessage(reason instanceof Error ? reason.message : "无法生成视角链接"); }
  };
  const source = workspace.id === "bristol" ? "backend/data/bristol.gugis.json" : `backend/data/cities/${workspace.id}.gugis.json`;
  const changeProfile = (next: TileLoadingProfile) => {
    if (!sessionActive.current || blocked || !manifest || !onTileProfileChange) return;
    const pose = scene.current?.getCameraPose();
    onTileProfileChange(next, pose ? { city: manifest.city_id as CityId, revision: manifest.revision, pose } : undefined);
  };
  const attribution = manifest?.attribution;
  const sourceLink = safeLink(attribution?.license_url ?? "") ?? safeLink(attribution?.metadata.source_url ?? "");
  const creditHasLicense = !!attribution?.license && (attribution.source ?? "").includes(attribution.license);
  const oversizedTiles = manifest?.tiles.filter(tile => tile.byte_length > budget.activeBytes).length ?? 0;
  const partial = !!manifest && (streamState.tiles.length < manifest.counts.tiles || (projection?.instances.length ?? 0) < manifest.counts.buildings);
  return <section className={`city-tile-preview${inspectorOpen ? "" : " is-map-focused"}`} aria-label={`${workspace.name}只读分块浏览`}>
    <header className="tile-preview-heading">
      <div className="tile-preview-title"><span>GUGIS3D / CITY EXPLORER</span><strong>{workspace.name} · 只读分块浏览</strong><p>{workspace.coverage_label} · 当前视口按需读取，保留源几何</p></div>
      <div className="tile-preview-actions">
        {onTileProfileChange && <label className="tile-profile-choice">读取配置 <select aria-label="分块读取配置" value={tileProfile}
          disabled={!manifest || blocked || (!!cameraRequest && readyCamera !== cameraRequest.sequence)}
          onChange={event => changeProfile(normalizeTileLoadingProfile(event.target.value))}>
          <option value="economy">低资源 · 2 瓦片</option><option value="balanced">均衡 · 8 瓦片</option>
        </select></label>}
        {projection && <button type="button" className="tile-fit-action" onClick={() => scene.current?.reset()}><LocateFixed size={15} aria-hidden="true" />已加载范围</button>}
        {manifest && <button type="button" aria-expanded={inspectorOpen} aria-controls={inspectorId}
          onClick={() => setInspectorOpen(value => !value)}>
          {inspectorOpen ? <PanelLeftClose size={15} aria-hidden="true" /> : <PanelLeftOpen size={15} aria-hidden="true" />}
          {inspectorOpen ? "收起建筑列表" : "显示建筑列表"}</button>}
        {projection && !blocked && <button type="button" className="tile-scene-jump" onClick={() => {
          sceneContainer.current?.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        }}>查看三维画面</button>}
        {manifest && <button type="button" aria-pressed={manualPaused} onClick={() => setManualPaused(value => !value)}>
          {manualPaused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
          {manualPaused ? "恢复瓦片读取" : "暂停瓦片读取"}
        </button>}
        <details ref={moreTools} className="tile-more-tools" onKeyDown={event => {
          if (event.key === "Escape") {
            event.preventDefault(); closeMoreTools(true);
          }
        }}><summary>更多工具</summary><div>
          <button type="button" disabled={!manifest || blocked || (!!cameraRequest && readyCamera !== cameraRequest.sequence)}
            onClick={() => { closeMoreTools(true); void copyCurrentView(); }}><Link2 size={15} aria-hidden="true" />复制当前视角链接</button>
          {activeSelected && <button type="button" onClick={() => { closeMoreTools(true); onSelect(null); }}>取消建筑选择</button>}
          <button type="button" disabled={loadingManifest} onClick={() => { closeMoreTools(true); setAttempt(value => value + 1); }}><RefreshCw size={15} aria-hidden="true" />重新检查渲染包</button>
          <p>重新核验来源修订，清除当前查询与选择；保留正式城市数据。</p>
          <details><summary>视角分享说明</summary><p>视角链接只记录城市、来源修订与相机位置，不包含或分发城市数据。接收方使用自己明确选择或默认的读取配置；链接不携带配置或预算。接收方须能访问此站点及匹配的渲染包；localhost 地址仅指接收方自己的电脑。</p></details>
        </div></details>
      </div>
    </header>
    {(copyMessage || copyLink) && <div className="tile-camera-share">
    {copyMessage && <p role="status">{copyMessage}</p>}
    {copyLink && <label>手动复制视角链接 <input aria-label="手动复制视角链接" readOnly value={copyLink}
      onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} /></label>}
    </div>}
    {blocked && <div className="tile-preview-error" role="alert">
      <p>{mismatch ? "视角链接的来源修订与当前渲染包不一致，未恢复旧视角。当前服务不提供按修订读取历史清单。"
        : failedCamera === cameraKey ? "此视角在当前窗口没有有限的地球椭球视域，未开始读取瓦片。"
        : "视角链接无效或不属于当前城市，未应用相机位置。"}</p>
      {mismatch && <p>链接修订：{bookmark?.revision} · 当前修订：{manifest?.revision}</p>}
      <button type="button" onClick={useCurrentDefault}>使用当前默认视角</button>
    </div>}
    <div className="tile-preview-status" role="status" aria-live="polite">
      {loadingManifest ? "正在读取有界渲染清单…" : manifest ? <>
        <span className="tile-loaded-count">已加载 {projection?.instances.length ?? 0} / {manifest.counts.buildings} 栋（跨瓦片去重），{streamState.tiles.length} / {manifest.counts.tiles} 瓦片</span>
        {paused && <strong> · {pageHidden ? "页面已隐藏，自动暂停瓦片读取" : "已暂停瓦片读取，保持已加载画面"}</strong>}
        {partial && <strong> · 局部加载，并非完整覆盖</strong>}
        {streamState.omitted > 0 && <strong className="tile-budget-note"> · 预算暂缓 {streamState.omitted} 瓦片，缩小视口或移动相机继续读取</strong>}
        <details className="tile-loading-details"><summary>加载明细与预算 · {tileProfile === "economy" ? "低资源" : "均衡"} · 驻留 ≤ {budget.activeTiles} 瓦片</summary>
        <small>{`${paused ? "暂停前视口目标" : "当前视口目标"} ${streamState.wanted} / ${streamState.candidates} 瓦片 · ${streamState.loading} 个待加载`}</small>
        <small>{tileProfile === "economy" ? "低资源（Economy）" : "均衡（Balanced）"} · 驻留 ≤ {budget.activeTiles} 瓦片 · 驻留源字节 {megabytes(streamState.activeBytes)} / {megabytes(budget.activeBytes)} MiB · 缓存 {streamState.cacheTiles} / {budget.cacheTiles} 瓦片，{megabytes(streamState.cacheBytes)} / {megabytes(budget.cacheBytes)} MiB · 最多 {budget.concurrency} 个并发请求；非 GPU / JS 内存测量或帧率保证</small>
        {paused && <small>相机与建筑详情仍可使用；恢复后按最新视口继续读取。手动暂停不会因页面重新显示而取消。</small>}
        </details>
        {oversizedTiles > 0 && <small className="tile-oversize-warning">此渲染包有 {oversizedTiles} 个源瓦片超过当前 {megabytes(budget.activeBytes)} MiB 单瓦片预算，不会请求或截断其几何。
          {tileProfile === "economy" ? onTileProfileChange ? "可在当前页面选择均衡配置，或离线生成更小瓦片。" : "请返回城市选择页，选择均衡配置，或离线生成更小瓦片。" : "请离线生成更小瓦片；不会自动扩大预算。"}</small>}
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
    {manifest && <><p className="tile-preview-scope">仅建筑预览 · 道路与地形未包含 · {freshness === "current" ? "已核验来源快照" : "来源与正式项目的一致性未验证"}
      {manifest.quality_warnings.length > 0 && <strong> · {manifest.quality_warnings.length} 项来源质量提示，展开下方说明查看</strong>}</p>
      {sourceLink && <p className="tile-source-credit"><a href={sourceLink} target="_blank" rel="noreferrer">{attribution?.source || "来源与许可"}</a>{!creditHasLicense && attribution?.license && <> · {attribution.license}</>}</p>}
    <details className="tile-preview-provenance">
      <summary>来源修订、质量与缺失图层</summary>
      <p>来源 SHA-256：<code>{manifest.revision}</code></p>
      <p>{freshness === "current" ? "已验证当前快照：服务端确认离线来源文件身份、大小与时间戳仍匹配（本次清单检查时）" : "新鲜度未知：可能已过期，未验证与当前正式文件一致"}</p>
      <p>仅建筑渲染；道路、地形、功能要素和语义均未包含。源文件的 {manifest.counts.source_roads} 条道路不在此视图中；不代表完整城市或实测高度。</p>
      <p>{attribution?.source} {attribution?.license}</p>
      {attribution?.metadata.coverage_label && <p>{attribution.metadata.coverage_label}</p>}
      {attribution?.metadata.height_policy && <p>{heightPolicyLabel(attribution.metadata.height_policy)}</p>}
      {attribution?.metadata["精度说明"] && <p>{attribution.metadata["精度说明"]}</p>}
      {attribution?.metadata["采样说明"] && <p>{attribution.metadata["采样说明"]}</p>}
      {manifest.quality_warnings.map((warning, i) => <p className="tile-preview-warning" key={`${warning.code}-${i}`}>{warning.message}</p>)}
      <small>上述质量警告只适用于此完整来源修订；浏览器未修正源模型。选中建筑保留包内全部构件（若有既有总览，则为总览构件），并固定一个关联瓦片，仍受瓦片硬预算限制。</small>
    </details></>}
    <div className="tile-preview-content">
      {manifest && <LoadedBuildingInspector key={`${manifest.city_id}:${manifest.revision}:${attempt}`}
        buildings={buildings} manifest={manifest} selected={activeSelected} onSelect={onSelect} onFocus={onFocus} hidden={!inspectorOpen} panelId={inspectorId} />}
      <div className="tile-preview-scene" ref={sceneContainer}>
        {projection && !blocked ? <CityScene ref={scene} city={projection} center={center} selected={activeSelected} onSelect={onSelect}
          context fullDetails={false} showGround={false} renderOnly onViewBounds={onViewBounds} cameraRequest={cameraRequest} /> : <p>{blocked ? "选择“使用当前默认视角”后显示当前渲染包。" : "几何将在渲染包验证通过后显示"}</p>}
      </div>
    </div>
  </section>;
}
