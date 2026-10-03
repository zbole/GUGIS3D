import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cameraBookmarkForLocation, stripCameraFragment, type CameraNavigation } from "./studio/cameraBookmark";
import AppErrorBoundary from "./AppErrorBoundary";
import { createCityApi } from "./studio/cityApi";
import { cityCoverageCoordinates, citySessionUrl, tileProfileFromSearch, tileProfileUrl, selectedCitiesFromSearch, selectedCityFromSearch, knownCities, loadCityWorkspaces, type CityId, type CityWorkspace } from "./studio/cityWorkspaces";
import "./studio/cityWorkspaces.css";
import CitySelection from "./studio/CitySelection";
import { type TileLoadingProfile } from "./studio/renderTileClient";

const BuildingStudio = lazy(() => import("./studio/CityStudio"));
const CityTilePreview = lazy(() => import("./studio/CityTilePreview"));
const CompareShowcase = lazy(() => import("./compare/CompareShowcase"));

export default function App() {
  const comparison = window.location.pathname.replace(/\/$/, "") === "/compare";
  const initialSelection = selectedCitiesFromSearch(window.location.search);
  const [selectedCities, setSelectedCities] = useState<CityId[]>(() => comparison ? [...knownCities] : initialSelection);
  const [entered, setEntered] = useState(comparison || initialSelection.length > 0);
  const [previewMode, setPreviewMode] = useState(!comparison && new URLSearchParams(window.location.search).get("view_mode") === "tiles");
  const [tileProfile, setTileProfile] = useState<TileLoadingProfile>(() => !comparison && previewMode ? tileProfileFromSearch(window.location.search) : "balanced");
  const profile = useRef(tileProfile); profile.current = tileProfile;
  const viewMode = useRef(previewMode);
  viewMode.current = previewMode;
  const [multiple, setMultiple] = useState(initialSelection.length > 1);
  const [cityId, setCityId] = useState<CityId>(() => selectedCityFromSearch(window.location.search, initialSelection));
  const cameraSequence = useRef(0);
  const [cameraNavigation, setCameraNavigation] = useState<CameraNavigation>(() => ({ sequence: 0,
    result: cameraBookmarkForLocation(window.location.href, cityId, previewMode) }));
  const lastNavigationHref = useRef(window.location.href);
  const acceptCamera = useCallback((href: string, id: CityId, tiles: boolean) => {
    lastNavigationHref.current = href;
    setCameraNavigation({ sequence: ++cameraSequence.current, result: cameraBookmarkForLocation(href, id, tiles) });
  }, []);
  const [cities, setCities] = useState<CityWorkspace[]>([]);
  const [directoryError, setDirectoryError] = useState("");
  const [busy, setBusy] = useState(!comparison && !previewMode && entered);
  const [draft, setDraft] = useState(false);
  const [switchNotice, setSwitchNotice] = useState("");
  const selection = useRef(cityId);
  const chosen = useRef(selectedCities);
  chosen.current = selectedCities;
  const state = useRef({ busy, draft });
  state.current = { busy, draft };
  const api = useMemo(() => createCityApi(cityId), [cityId]);
  const city = cities.find(item => item.id === cityId);
  const directoryRequest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++directoryRequest.current;
    try {
      const result = await loadCityWorkspaces();
      if (directoryRequest.current !== request) return;
      setCities(result); setDirectoryError("");
    } catch (error) {
      if (directoryRequest.current === request) setDirectoryError(String(error));
    }
  }, []);
  useEffect(() => { void refresh(); return () => { ++directoryRequest.current; }; }, [refresh]);
  const switchCity = useCallback((next: CityId, restore = false) => {
    if (next === selection.current || !chosen.current.includes(next)) return;
    if (state.current.busy) {
      setSwitchNotice("当前操作尚未完成，请完成后切换城市。");
      if (restore) window.history.replaceState(window.history.state, "", citySessionUrl(window.location.href, chosen.current, selection.current, viewMode.current, false, profile.current));
      return;
    }
    setSwitchNotice(state.current.draft ? "原城市草稿已独立保留，切回该城市可继续。" : "已切换独立工作区；仅加载当前城市的三维场景。");
    selection.current = next;
    if (!restore) window.history.pushState(window.history.state, "", citySessionUrl(window.location.href, chosen.current, next, viewMode.current, false, profile.current));
    acceptCamera(window.location.href, next, viewMode.current);
    state.current = { busy: !comparison && !viewMode.current, draft: false };
    setBusy(!comparison && !viewMode.current); setDraft(false); setCityId(next);
  }, [comparison, acceptCamera]);
  useEffect(() => {
    const restore = () => {
      if (lastNavigationHref.current === window.location.href) return;
      const requested = selectedCitiesFromSearch(window.location.search);
      if (!requested.length && !comparison) {
        if (state.current.busy) {
          setSwitchNotice("当前操作尚未完成，请完成后选择城市。");
          window.history.replaceState(window.history.state, "", citySessionUrl(window.location.href, chosen.current, selection.current, viewMode.current, false, profile.current));
        } else {
          setEntered(false); setBusy(false);
          window.history.replaceState(window.history.state, "", citySessionUrl(window.location.href, [], null));
        }
        acceptCamera(window.location.href, selection.current, false);
        return;
      }
      if (state.current.busy) {
        setSwitchNotice("当前操作尚未完成，请完成后切换城市。");
        window.history.replaceState(window.history.state, "", citySessionUrl(window.location.href, chosen.current, selection.current, viewMode.current, false, profile.current));
        acceptCamera(window.location.href, selection.current, viewMode.current);
        return;
      }
      chosen.current = requested.length ? requested : [...knownCities];
      const next = selectedCityFromSearch(window.location.search, chosen.current);
      const nextPreview = !comparison && new URLSearchParams(window.location.search).get("view_mode") === "tiles";
      const nextProfile = nextPreview ? tileProfileFromSearch(window.location.search) : "balanced";
      const changed = next !== selection.current || nextPreview !== viewMode.current || nextProfile !== profile.current || !entered;
      // Validate the incoming camera identity before any URL normalization.
      // Cleaning duplicate/wrong city fields first could turn a rejected link valid.
      acceptCamera(window.location.href, next, nextPreview);
      const restoredUrl = tileProfileUrl(nextPreview ? window.location.href : stripCameraFragment(window.location.href), nextPreview, nextProfile);
      if (restoredUrl !== window.location.href) window.history.replaceState(window.history.state, "", restoredUrl);
      lastNavigationHref.current = window.location.href;
      selection.current = next; viewMode.current = nextPreview; profile.current = nextProfile; setTileProfile(nextProfile);
      setSelectedCities(chosen.current); setEntered(true); setCityId(next); setPreviewMode(nextPreview);
      if (changed) {
        state.current = { busy: !comparison && !nextPreview, draft: false };
        setBusy(!comparison && !nextPreview); setDraft(false);
      }
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    const url = entered ? citySessionUrl(window.location.href, chosen.current, selection.current, viewMode.current, viewMode.current, profile.current) : citySessionUrl(window.location.href, [], null);
    if (url !== window.location.href) window.history.replaceState(window.history.state, "", url);
    lastNavigationHref.current = window.location.href;
    return () => { window.removeEventListener("popstate", restore); window.removeEventListener("hashchange", restore); };
  }, [switchCity, entered, comparison, acceptCamera]);
  const workspaceState = useCallback((id: string, nextBusy: boolean, hasDraft: boolean) => {
    if (id !== selection.current || viewMode.current) return;
    state.current = { busy: nextBusy, draft: hasDraft };
    setBusy(nextBusy); setDraft(hasDraft);
  }, []);
  const previewState = useCallback((id: string) => {
    if (id !== selection.current || !viewMode.current) return;
    state.current = { busy: false, draft: false }; setBusy(false); setDraft(false);
  }, []);
  const changeView = (next: boolean) => {
    if (state.current.busy || next === viewMode.current) return;
    if (next && !window.confirm("切换至只读分块浏览？已保存项目和独立草稿会保留；尚未生成的表单修改、未保存分析和当前视角不会保留。")) return;
    viewMode.current = next; setPreviewMode(next);
    state.current = { busy: !next, draft: false }; setBusy(!next); setDraft(false);
    window.history.pushState(window.history.state, "", citySessionUrl(window.location.href, chosen.current, selection.current, next, false, profile.current));
    acceptCamera(window.location.href, selection.current, next);
  };
  const enterSelected = () => {
    const available = selectedCities.filter(id => cities.some(item => item.id === id && item.status !== "invalid"));
    if (!available.length) return;
    chosen.current = available; setSelectedCities(available); selection.current = available[0];
    setCityId(available[0]); setBusy(!previewMode); setDraft(false); setEntered(true);
    state.current = { busy: !previewMode, draft: false };
    window.history.pushState(window.history.state, "", citySessionUrl(window.location.href, available, available[0], previewMode, false, profile.current));
    acceptCamera(window.location.href, available[0], previewMode);
  };
  if (!entered && !comparison) return <AppErrorBoundary>
    {cameraNavigation.result.kind === "invalid" && <p role="alert">视角链接城市或浏览模式无效，请重新选择城市。</p>}
    <CitySelection cities={cities} selected={selectedCities}
    multiple={multiple} tileProfile={tileProfile} onTileProfileChange={setTileProfile} previewMode={previewMode} onPreviewModeChange={setPreviewMode} error={directoryError} onRetry={() => void refresh()} onEnter={enterSelected}
    onMultiple={value => { setMultiple(value); if (!value) setSelectedCities(ids => ids.slice(0, 1)); }}
    onSelect={id => setSelectedCities(ids => !multiple ? [id] : ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])} />
  </AppErrorBoundary>;
  return (
    <AppErrorBoundary>
      <div className="city-session-shell">
      <section className="city-workspaces" aria-label="城市独立工作区">
        {!comparison && <button disabled={busy} onClick={() => {
          if (state.current.busy) return;
          if (!window.confirm("返回城市选择？已保存项目和独立草稿会保留；尚未生成的表单修改、未保存分析和当前视角不会保留。")) return;
          setEntered(false); setSwitchNotice("");
          window.history.pushState(window.history.state, "", citySessionUrl(window.location.href, [], null));
          acceptCamera(window.location.href, selection.current, false);
        }}>重新选择城市</button>}
        {!comparison && <button disabled={busy} aria-pressed={previewMode} onClick={() => changeView(!previewMode)}>
          {previewMode ? "切换至完整编辑" : "轻量分块浏览"}
        </button>}
        <label>城市工作区 <select aria-label="选择城市" value={cityId} disabled={busy || !cities.length}
          onChange={event => switchCity(event.target.value as CityId)}>
          {cities.filter(item => selectedCities.includes(item.id as CityId)).map(item => <option key={item.id} value={item.id} disabled={item.status === "invalid"}>{item.name} · {item.status === "pending" ? "待导入" : item.status === "invalid" ? "数据异常" : "已导入"}</option>)}
        </select></label>
        {city && <div className="city-workspaces__coverage"><strong>{city.coverage_label}</strong>
          <span>{previewMode ? "正式项目目录：" : ""}{city.status === "pending" ? "尚无已导入数据" : `${city.building_count ?? 0} 栋建筑 · ${city.road_count ?? 0} 条道路`} · {previewMode ? "预览以渲染快照及下方实际加载数为准" : "每城独立保存与恢复"}</span>
          {cityCoverageCoordinates(city) && <span>{cityCoverageCoordinates(city)} · 非城市行政边界</span>}</div>}
        {switchNotice && <p role="status">{switchNotice}</p>}
        {directoryError && <p role="alert">{directoryError} <button onClick={() => void refresh()}>重试城市目录</button></p>}
      </section>
      <Suspense fallback={<div className="app-loading">GUGIS3D · 正在载入</div>}>
        {city ? comparison ? <CompareShowcase key={cityId} workspace={city} api={api} />
          : previewMode ? <CityTilePreview key={`${cityId}:${tileProfile}`} workspace={city} tileProfile={tileProfile} onWorkspaceState={previewState}
            cameraNavigation={cameraNavigation} onCameraBookmarkDismiss={() => {
              window.history.replaceState(window.history.state, "", stripCameraFragment(window.location.href));
              acceptCamera(window.location.href, selection.current, true);
            }} />
          : <BuildingStudio key={cityId} workspace={city} api={api} onWorkspaceState={workspaceState} onRevisionChange={refresh} />
          : !directoryError && <div className="app-loading">正在读取城市目录…</div>}
      </Suspense>
      </div>
    </AppErrorBoundary>
  );
}
