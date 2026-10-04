import { useEffect, useId, useMemo, useState } from "react";
import type { RenderManifest } from "./renderTileClient";
import { loadedBuildingPage, LOADED_BUILDINGS_PAGE_SIZE, type LoadedBuilding } from "./loadedBuildings";

interface Props {
  buildings: readonly LoadedBuilding[];
  manifest: RenderManifest;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  hidden?: boolean;
  panelId?: string;
  emptyHint?: string;
}

/** A read-only view over active tiles, with a hard DOM row limit. */
export default function LoadedBuildingInspector({ buildings, manifest, selected, onSelect, onFocus, hidden = false, panelId, emptyHint }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const results = useMemo(() => loadedBuildingPage(buildings, query, page), [buildings, query, page]);
  const building = useMemo(() => buildings.find(item => item.placement.id === selected), [buildings, selected]);
  const selectedMatchesQuery = !query.trim() || !building ||
    [building.placement.name, building.placement.id].some(value => value.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => { if (page !== results.page) setPage(results.page); }, [page, results.page]);
  const search = (value: string) => { setQuery(value); setPage(0); };
  return <aside id={panelId} hidden={hidden} className="tile-building-inspector" aria-label="已加载建筑查询与详情">
    <h2>已加载建筑</h2>
    <p id={`${id}-scope`} className="tile-building-scope">仅查询当前驻留瓦片中的 {buildings.length} 栋唯一建筑，不搜索全城。移动视口后列表会更新；搜索不请求其他瓦片。</p>
    <label htmlFor={`${id}-search`}>按名称或建筑 ID 搜索</label>
    <div className="tile-building-search">
      <input id={`${id}-search`} type="search" value={query} maxLength={256} autoComplete="off"
        aria-describedby={`${id}-scope`} aria-controls={`${id}-list`}
        onChange={event => search(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); search(""); } }} />
      <button type="button" disabled={!query} onClick={() => search("")}>清空搜索</button>
    </div>
    <p className="tile-building-result-count" role="status" aria-live="polite">
      匹配 {results.matched} / {results.loaded} 栋已加载建筑 · 显示 {results.first}–{results.last} · 每页最多 {LOADED_BUILDINGS_PAGE_SIZE} 栋
    </p>
    <ul id={`${id}-list`} className="tile-building-list" aria-label="已加载建筑搜索结果">
      {results.items.map(({ placement }) => <li key={placement.id}>
        <button type="button" aria-pressed={selected === placement.id} onClick={() => onSelect(placement.id)}>
          <strong>{placement.name || "未命名建筑"}</strong><span>{placement.id}</span>
        </button>
      </li>)}
    </ul>
    {!results.matched && <p className="tile-building-empty">{buildings.length ? "当前已加载建筑中没有匹配项；未加载区域尚未搜索。" : emptyHint ?? "当前没有已加载建筑。请等待瓦片读取，或移动视口。"}</p>}
    {results.pages > 1 && <nav className="tile-building-pages" aria-label="已加载建筑分页">
      <button type="button" disabled={results.page === 0} onClick={() => setPage(results.page - 1)}>上一页</button>
      <span>第 {results.page + 1} / {results.pages} 页</span>
      <button type="button" disabled={results.page + 1 === results.pages} onClick={() => setPage(results.page + 1)}>下一页</button>
    </nav>}
    <div className="tile-building-details" aria-label="所选建筑详情">
      <h3>所选建筑 · 只读</h3>
      {building ? <>
        <strong className="tile-selected-name">{building.placement.name || "未命名建筑"}</strong>
        <span className="tile-selected-id">{building.placement.id} · {building.primitiveCount} 个渲染构件</span>
        {!selectedMatchesQuery && <div className="tile-selection-filter-note" role="status">
          所选建筑不符合当前搜索条件，选择仍然保留。
          <button type="button" onClick={() => {
            setQuery("");
            const index = buildings.findIndex(item => item.placement.id === selected);
            setPage(Math.max(0, Math.floor(index / LOADED_BUILDINGS_PAGE_SIZE)));
          }}>查看所选建筑所在列表</button>
        </div>}
        <div className="tile-building-controls">
          <button type="button" onClick={() => onFocus(building.placement.id)}>定位所选建筑</button>
          <button type="button" onClick={() => onSelect(null)}>清除选择</button>
        </div>
        <details className="tile-building-raw" key={building.placement.id}>
        <summary>原始属性与来源</summary><dl>
          <dt>名称</dt><dd>{building.placement.name || "未命名建筑"}</dd>
          <dt>建筑 ID</dt><dd>{building.placement.id}</dd>
          <dt>资产 ID</dt><dd>{building.placement.asset}</dd>
          <dt>资产类型</dt><dd>{building.kind}</dd>
          <dt>几何来源</dt><dd>{building.quality === "overview" ? "源模型既有总览（overview）" : "完整源构件回退（full-fallback）"}</dd>
          <dt>渲染构件数</dt><dd>{building.primitiveCount}（非三角面数）</dd>
          <dt>经度（WGS84 °）</dt><dd>{String(building.placement.longitude)}</dd>
          <dt>纬度（WGS84 °）</dt><dd>{String(building.placement.latitude)}</dd>
          <dt>源模型放置高程（m）</dt><dd>{String(building.placement.altitude)}</dd>
          <dt>朝向（°）</dt><dd>{String(building.placement.heading)}</dd>
          <dt>当前瓦片引用</dt><dd>{building.tileIds.length}：{building.tileIds.join("、")}</dd>
          <dt>来源城市</dt><dd>{manifest.city_id}</dd>
          <dt>来源 SHA-256</dt><dd>{manifest.revision}</dd>
        </dl>
        <p>坐标、放置高程与朝向按包内原值显示。放置高程不是建筑高度，垂直基准未经独立核验；此渲染包不含原始 OSM 标签，也不提供实测高度。全源修订的质量警告见上方来源说明，不能据此判断单栋建筑精度。</p>
        <p>选择会在硬预算内固定一个关联瓦片；清除选择后，该建筑可能随视口移出列表。</p>
        </details>
      </> : <p>{selected ? "所选建筑已不在当前加载范围，请重新选择。" : "在场景或上方列表中选择一栋建筑以查看包内数据。"}</p>}
    </div>
  </aside>;
}
