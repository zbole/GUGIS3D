import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppErrorBoundary from "./AppErrorBoundary";
import { createCityApi } from "./studio/cityApi";
import { cityCoverageCoordinates, cityIdFromSearch, cityWorkspaceUrl, loadCityWorkspaces, type CityId, type CityWorkspace } from "./studio/cityWorkspaces";
import "./studio/cityWorkspaces.css";

const BuildingStudio = lazy(() => import("./studio/CityStudio"));
const CompareShowcase = lazy(() => import("./compare/CompareShowcase"));

export default function App() {
  const comparison = window.location.pathname.replace(/\/$/, "") === "/compare";
  const [cityId, setCityId] = useState<CityId>(() => cityIdFromSearch(window.location.search));
  const [cities, setCities] = useState<CityWorkspace[]>([]);
  const [directoryError, setDirectoryError] = useState("");
  const [busy, setBusy] = useState(!comparison);
  const [draft, setDraft] = useState(false);
  const [switchNotice, setSwitchNotice] = useState("");
  const selection = useRef(cityId);
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
    if (next === selection.current) return;
    if (state.current.busy) {
      setSwitchNotice("当前操作尚未完成，请完成后切换城市。");
      if (restore) window.history.replaceState(window.history.state, "", cityWorkspaceUrl(window.location.href, selection.current));
      return;
    }
    setSwitchNotice(state.current.draft ? "原城市草稿已独立保留，切回该城市可继续。" : "已切换独立工作区；仅加载当前城市的三维场景。");
    selection.current = next;
    if (!restore) window.history.pushState(window.history.state, "", cityWorkspaceUrl(window.location.href, next));
    state.current = { busy: !comparison, draft: false };
    setBusy(!comparison); setDraft(false); setCityId(next);
  }, [comparison]);
  useEffect(() => {
    const restore = () => switchCity(cityIdFromSearch(window.location.search), true);
    window.addEventListener("popstate", restore);
    const url = cityWorkspaceUrl(window.location.href, selection.current);
    if (url !== window.location.href) window.history.replaceState(window.history.state, "", url);
    return () => window.removeEventListener("popstate", restore);
  }, [switchCity]);
  const workspaceState = useCallback((id: string, nextBusy: boolean, hasDraft: boolean) => {
    if (id !== selection.current) return;
    state.current = { busy: nextBusy, draft: hasDraft };
    setBusy(nextBusy); setDraft(hasDraft);
  }, []);
  return (
    <AppErrorBoundary>
      <section className="city-workspaces" aria-label="城市独立工作区">
        <label>城市工作区 <select aria-label="选择城市" value={cityId} disabled={busy || !cities.length}
          onChange={event => switchCity(event.target.value as CityId)}>
          {cities.map(item => <option key={item.id} value={item.id}>{item.name} · {item.status === "pending" ? "待导入" : item.status === "invalid" ? "数据异常" : "已导入"}</option>)}
        </select></label>
        {city && <div className="city-workspaces__coverage"><strong>{city.coverage_label}</strong>
          <span>{city.status === "pending" ? "尚无已导入数据" : `${city.building_count ?? 0} 栋建筑 · ${city.road_count ?? 0} 条道路`} · 每城独立保存与恢复</span>
          {cityCoverageCoordinates(city) && <span>{cityCoverageCoordinates(city)} · 非城市行政边界</span>}</div>}
        {switchNotice && <p role="status">{switchNotice}</p>}
        {directoryError && <p role="alert">{directoryError} <button onClick={() => void refresh()}>重试城市目录</button></p>}
      </section>
      <Suspense fallback={<div className="app-loading">GUGIS3D · 正在载入</div>}>
        {city ? comparison ? <CompareShowcase key={cityId} workspace={city} api={api} />
          : <BuildingStudio key={cityId} workspace={city} api={api} onWorkspaceState={workspaceState} onRevisionChange={refresh} />
          : !directoryError && <div className="app-loading">正在读取城市目录…</div>}
      </Suspense>
    </AppErrorBoundary>
  );
}
