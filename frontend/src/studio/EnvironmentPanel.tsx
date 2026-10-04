import { useEffect, useMemo, useRef, useState } from "react";
import { Mountain, MapPin, Plus, Upload } from "lucide-react";
import {
  emptyEnvironment,
  featurePresets,
  terrainColors,
  terrainNames,
  type Environment,
  type FeatureAsset,
  type Terrain,
} from "./environment";
import { terrainStatistics, type TerrainHit } from "./terrainMath";
import * as legacyCityApi from "./cityApi";
import type { CityApi } from "./cityApi";
import { featureErrors } from "./featureEditing";
import FunctionExplanation from "./FunctionExplanation";
import { terrainLineColors } from "./terrainTopology";

type Position = { longitude: number; latitude: number; altitude: number };

function RuledStripGuide({ legacyFans }: { legacyFans: boolean }) {
  return (
    <section className="ruled-guide" aria-label="直纹面带构造示意">
      <strong>直纹面带 · 原生拓扑示意</strong>
      <svg viewBox="0 0 320 180" role="img" aria-label="两条边界曲线 L 和 R 之间，由四条直纹生成线连接的连续面带；仅示意结构，不表示真实高程比例">
        <path d="M35 117 97 83 162 139 95 157Z" fill={terrainColors["ruled-strip"]} fillOpacity=".36" />
        <path d="M97 83 158 54 226 116 162 139Z" fill={terrainColors["ruled-strip"]} fillOpacity=".52" />
        <path d="M158 54 224 36 291 91 226 116Z" fill={terrainColors["ruled-strip"]} fillOpacity=".7" />
        <path d="M35 117 97 83 158 54 224 36 M95 157 162 139 226 116 291 91" fill="none" stroke={terrainLineColors.boundary} strokeWidth="3" strokeLinejoin="round" />
        <path d="M35 117 95 157 M97 83 162 139 M158 54 226 116 M224 36 291 91" fill="none" stroke={terrainLineColors.generator} strokeWidth="2.5" />
        <g fill={terrainLineColors.boundary}>
          <circle cx="35" cy="117" r="3"/><circle cx="97" cy="83" r="3"/><circle cx="158" cy="54" r="3"/><circle cx="224" cy="36" r="3"/>
          <circle cx="95" cy="157" r="3"/><circle cx="162" cy="139" r="3"/><circle cx="226" cy="116" r="3"/><circle cx="291" cy="91" r="3"/>
        </g>
        <text x="25" y="105">L₀</text><text x="221" y="25">L(u)</text>
        <text x="73" y="175">R₀</text><text x="272" y="111">R(u)</text>
        <text x="146" y="94">v</text>
      </svg>
      <p>两侧深绿线是边界曲线，金色横线是连接对应控制点的直纹。u 沿面带延伸，v 沿直纹移动；放大场景并点击地形，可读出面带编号和 u / v。</p>
      <code>S(u,v) = (1−v)L(u) + vR(u)</code>
      <div className="terrain-topology-key" aria-label="三维地形线色图例">
        <span><i style={{ background: terrainLineColors.boundary }} />面带边界</span>
        <span><i style={{ background: terrainLineColors.generator }} />直纹生成线</span>
        <span><i style={{ background: terrainLineColors["triangle-strip"] }} />三角带边</span>
        {legacyFans && <span><i style={{ background: terrainLineColors["triangle-fan"] }} />旧档案三角扇边 / 辐条</span>}
      </div>
      <small>构造原理图，非真实高程比例；三维场景中的线对应当前城市档案的原生控制网。</small>
    </section>
  );
}

export default function EnvironmentPanel({
  environment,
  busy,
  save,
  previewTerrain,
  terrainIsDraft = false,
  position,
  setPosition,
  placing,
  onPick,
  onCenter,
  selected,
  onSelect,
  focus,
  opacity,
  setOpacity,
  wire,
  setWire,
  query,
  setQuery,
  hit,
  onEditingChange,
  initialSection,
  api = legacyCityApi,
  cityName = "布里斯托",
  onBusyChange,
  previewChanges = false,
  readOnly = false,
}: {
  environment?: Environment;
  busy: boolean;
  save: (e: Environment, message: string) => Promise<boolean>;
  previewTerrain?: (terrain: Terrain, label: string) => Promise<boolean>;
  terrainIsDraft?: boolean;
  position: Position;
  setPosition: (p: Position) => void;
  placing: boolean;
  onPick: () => void;
  onCenter: () => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  focus: (id: string) => void;
  opacity: number;
  setOpacity: (n: number) => void;
  wire: boolean;
  setWire: (b: boolean) => void;
  query: boolean;
  setQuery: (b: boolean) => void;
  hit: TerrainHit | null;
  onEditingChange: (editing: boolean) => void;
  initialSection?: "terrain" | "features";
  api?: CityApi;
  cityName?: string;
  onBusyChange?: (busy: boolean) => void;
  previewChanges?: boolean;
  readOnly?: boolean;
}) {
  const { demoTerrain, importTerrain, terrainMultipatchUrl, upgradeLegacyTerrain } = api;
  const [section, setSection] = useState<"terrain" | "features">(() =>
      initialSection ?? (environment?.features.length ? "features" : "terrain"),
    ),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  useEffect(() => { onBusyChange?.(working); }, [working, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  const [asset, setAsset] = useState<FeatureAsset>(() =>
      structuredClone(featurePresets.lamp),
    ),
    [name, setName] = useState("球灯与灯柱"),
    [scale, setScale] = useState(1),
    [heading, setHeading] = useState(0),
    [applyShared, setApplyShared] = useState(false),
    [layer, setLayer] = useState<"surface" | "underground">("surface");
  const [crs, setCrs] = useState(""),
    [datum, setDatum] = useState("unknown"),
    [stride, setStride] = useState(10);
  const file = useRef<HTMLInputElement>(null),
    skipInitialFeatureSelection = useRef(initialSection === "terrain"),
    observedSelection = useRef<string | null | undefined>(undefined),
    env = environment ?? emptyEnvironment(),
    terrain = env.terrain;
  const item = env.features.find((f) => f.id === selected);
  const storedAsset = item ? env.feature_assets[item.asset] : undefined;
  const shared = item ? env.features.filter(f => f.asset === item.asset) : [];
  const changedParts = storedAsset ? asset.components.filter((part, i) =>
    JSON.stringify(part) !== JSON.stringify(storedAsset.components[i])).length +
    Math.max(0, storedAsset.components.length - asset.components.length) : 0;
  const stats = useMemo(
    () => (terrain ? terrainStatistics(terrain) : null),
    [terrain],
  );
  const validation = useMemo(() => featureErrors(asset), [asset]);
  const viewingDisabled = busy || working;
  const disabled = viewingDisabled || readOnly;
  const terrainOperation = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    onEditingChange(section === "features");
    return () => onEditingChange(false);
  }, [section, onEditingChange]);
  useEffect(() => {
    if (!item || !storedAsset) return;
    setAsset(structuredClone(storedAsset));
    setName(item.name);
    setScale(item.scale);
    setHeading(item.heading);
    setLayer(item.layer);
    setApplyShared(false);
    setPosition({
      longitude: item.longitude,
      latitude: item.latitude,
      altitude: item.altitude,
    });
  }, [item, storedAsset]);
  useEffect(() => {
    if (observedSelection.current === selected) return;
    observedSelection.current = selected;
    if (skipInitialFeatureSelection.current) {
      if (selected) skipInitialFeatureSelection.current = false;
      return;
    }
    if (selected) setSection("features");
  }, [selected]);
  async function terrainAction(chosen?: File) {
    if (disabled || terrainOperation.current) return;
    terrainOperation.current = true;
    if (file.current) file.current.value = "";
    setWorking(true);
    setError("");
    try {
      if (chosen && chosen.size > 128 * 1024 * 1024)
        throw new Error("DEM 超过 128 MiB，请先裁剪");
      if (chosen && (!Number.isInteger(stride) || stride < 1 || stride > 100))
        throw new Error("采样步长必须为 1 至 100 的整数。");
      if (!previewTerrain) throw new Error("当前工作区不支持独立地形预览，请重新打开城市工作台。");
      const r = chosen
        ? await importTerrain(chosen, crs, datum, stride)
        : await demoTerrain();
      if (!mounted.current) return;
      if (await previewTerrain(r.terrain, chosen ? "DEM 地形预览" : "非实测演示地形预览"))
        setQuery(false);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      terrainOperation.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function convertLegacyTerrain() {
    if (!terrain || disabled || terrainOperation.current) return;
    terrainOperation.current = true;
    setWorking(true);
    setError("");
    try {
      if (!previewTerrain) throw new Error("当前工作区不支持独立地形预览，请重新打开城市工作台。");
      const result = await upgradeLegacyTerrain(terrain);
      if (!mounted.current) return;
      await previewTerrain(result.terrain, "旧三角扇转换为三角带预览（保留原三角面）");
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      terrainOperation.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function storeFeature() {
    if (disabled || validation.length) return;
    setWorking(true);
    setError("");
    try {
      const assets = { ...env.feature_assets };
      let assetId = Object.keys(assets).find(
        (k) => JSON.stringify(assets[k]) === JSON.stringify(asset),
      );
      if (!assetId) {
        assetId = `f_${crypto.randomUUID().replace(/-/g, "")}`;
        assets[assetId] = asset;
      }
      const id = item?.id ?? `f_${crypto.randomUUID().replace(/-/g, "")}`;
      const next = {
        id,
        asset: assetId,
        name: name.trim(),
        ...position,
        scale,
        heading,
        layer,
      };
      const features = item
        ? env.features.map((f) => f.id === id ? next :
            applyShared && f.asset === item.asset ? { ...f, asset: assetId } : f)
        : [...env.features, next];
      const used = new Set(features.map((f) => f.asset));
      if (
        await save(
          {
            ...env,
            features,
            feature_assets: Object.fromEntries(
              Object.entries(assets).filter(([key]) => used.has(key)),
            ),
          },
          previewChanges ? item ? "函数地物修改预览" : "新增函数地物预览" : item ? "已更新函数地物" : "已添加函数地物",
        )
      )
        onSelect(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }
  async function addExamples() {
    if (disabled) return;
    setWorking(true);
    setError("");
    try {
      const assets = { ...featurePresets, ...env.feature_assets };
      const items = [
        {
          id: "function_plaza",
          asset: "round-plaza",
          name: "函数示例 · 圆形广场",
          longitude: position.longitude,
          latitude: position.latitude,
          altitude: 0,
        },
        {
          id: "function_arch",
          asset: "arched-door",
          name: "函数示例 · 拱门",
          longitude: position.longitude,
          latitude: position.latitude + 0.00014,
          altitude: 0,
        },
        {
          id: "function_balcony",
          asset: "curved-balcony",
          name: "函数示例 · 弧形阳台构件",
          longitude: position.longitude + 0.0002,
          latitude: position.latitude,
          altitude: 2.5,
        },
        ...[0, 1, 2, 3].map((i) => ({
          id: `function_lamp${i}`,
          asset: "lamp",
          name: `函数示例 · 路灯 ${i + 1}`,
          longitude: position.longitude + Math.cos((i * Math.PI) / 2) * 0.0002,
          latitude: position.latitude + Math.sin((i * Math.PI) / 2) * 0.00013,
          altitude: 0,
        })),
      ].map((f) => ({ ...f, scale: 1, heading: 0, layer: "surface" as const }));
      const additions = items.filter(
        (f) => !env.features.some((existing) => existing.id === f.id),
      );
      if (!additions.length) {
        onSelect("function_plaza");
        return;
      }
      if (
        await save(
          {
            ...env,
            feature_assets: assets,
            features: [...env.features, ...additions],
          },
          previewChanges ? "补齐函数地物示例预览" : "已加入可编辑的函数地物示例",
        )
      ) {
        onSelect("function_plaza");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }
  function switchSection(next: "terrain" | "features") {
    setSection(next);
    setQuery(false);
  }
  return (
    <>
      <div className="panel-heading">
        <h2>地形与函数地物</h2>
        <Mountain size={17} />
      </div>
      <div className="environment-panel">
        <div className="environment-tabs">
          <button
            className={section === "terrain" ? "active" : ""}
            onClick={() => switchSection("terrain")}
          >
            地形
          </button>
          <button
            className={section === "features" ? "active" : ""}
            onClick={() => switchSection("features")}
          >
            函数地物
          </button>
        </div>
        {error && (
          <p className="form-note environment-error" role="alert">
            {error}
          </p>
        )}
        {section === "terrain" ? (
          <>
            <p className="muted">
              本阶段使用直纹面带和三角带：平缓区域保留连续曲面，较大起伏用三角带。原生结构与高程基准保存在城市文件中。
            </p>
            <p className="form-note">生成、导入或转换地形先创建独立草稿。在场景中检查后，点击上方“确认写入”才替换正式地形；丢弃草稿可返回原项目。</p>
            <button
              className="full"
              disabled={disabled}
              onClick={() => void terrainAction()}
            >
              创建演示地形（非实测）
            </button>
            <details className="dem-import" open={!terrain}>
              <summary>导入 Digimap / DEM</summary>
              <p className="muted">
                选择裸地 DTM；支持 .tif /
                .asc，高程单位为米。自动裁剪到{cityName}当前工作区的采集范围。
              </p>
              <label>
                源坐标系
                <select value={crs} onChange={(e) => setCrs(e.target.value)}>
                  <option value="">从文件读取</option>
                  <option value="EPSG:27700">英国国家格网 EPSG:27700</option>
                  <option value="EPSG:4326">经纬度 EPSG:4326</option>
                </select>
              </label>
              <label>
                源高程基准
                <select
                  value={datum}
                  onChange={(e) => setDatum(e.target.value)}
                >
                  <option value="ODN">英国 ODN（Newlyn）</option>
                  <option value="ellipsoidal">椭球高</option>
                  <option value="local">局部相对高程</option>
                  <option value="unknown">未知，保留原值</option>
                </select>
              </label>
              <p className="muted">默认不推断高程基准，请按源数据说明选择。指定 ODN 或椭球高不会自动转换源高程；水平坐标系不能证明高程基准。</p>
              <label>
                采样步长 / 像元
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={stride}
                  onChange={(e) => setStride(Number(e.target.value))}
                />
              </label>
              <p className="muted">
                1 为原像元密度；较大步长会降低采样精度。输出最多 300,000
                个控制点，不填补 NoData；降采样保守扩大缺测边缘。缺测检查最多 5,000 万个裁剪源像元，超限需先裁剪或拆块。
              </p>
              <button
                className="primary full"
                disabled={
                  disabled ||
                  !Number.isInteger(stride) ||
                  stride < 1 ||
                  stride > 100
                }
                onClick={() => file.current?.click()}
              >
                <Upload size={15} />
                选择 DEM 并导入
              </button>
              <input
                hidden
                ref={file}
                type="file"
                accept=".tif,.tiff,.asc"
                aria-label="选择 DEM 文件"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  if (chosen) void terrainAction(chosen);
                }}
              />
            </details>
            {working && <p role="status">正在转换地形并创建独立预览草稿…</p>}
            {terrain && stats && (
              <>
                <h3>{terrain.name}</h3>
                <p
                  className={
                    terrain.demonstration ? "terrain-demo-note" : "form-note"
                  }
                >
                  {terrain.demonstration
                    ? `方法演示 · 非${cityName}实测地形`
                    : "用户 DEM · 已保留来源与采样信息"}
                </p>
                <dl className="environment-stats">
                  <dt>共享控制点</dt>
                  <dd>{stats.points.toLocaleString()}</dd>
                  {Object.entries(stats.count).filter(([, n]) => n > 0).map(([k, n]) => (
                    <div className="terrain-count" key={k}>
                      <dt>
                        <i
                          style={{
                            background:
                              terrainColors[k as keyof typeof terrainColors],
                          }}
                        />
                        {terrainNames[k as keyof typeof terrainNames]}
                      </dt>
                      <dd>{n}</dd>
                    </div>
                  ))}
                </dl>
                {stats.count["triangle-fan"] > 0 && <button className="full" disabled={disabled}
                  onClick={() => void convertLegacyTerrain()}>转换旧三角扇为三角带（保留原三角面）</button>}
                {terrainIsDraft ? <p className="form-note">当前地形属于独立草稿；确认写入后可下载对应的 MultiPatch 对照数据。</p> : <a className="button-link full" href={terrainMultipatchUrl} download>
                  下载 ArcGIS Pro 对照数据 · MultiPatch 三角带
                </a>}
                <p className="muted">
                  相对同一控制网的独立三角索引，拓扑索引容量减少{" "}
                  {stats.indexSaving.toFixed(1)}%（Uint32
                  估算，不代表整城内存节省）。
                </p>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={wire}
                    onChange={(e) => setWire(e.target.checked)}
                  />
                  显示原生拓扑线（面带 / 三角结构）
                </label>
                <RuledStripGuide legacyFans={stats.count["triangle-fan"] > 0} />
                <label>
                  地形不透明度
                  <input
                    aria-label="地形不透明度"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                  />
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={env.drape_buildings}
                    disabled={disabled}
                    onChange={(e) =>
                      void save(
                        { ...env, drape_buildings: e.target.checked },
                        "已更新建筑随地形定位",
                      )
                    }
                  />
                  建筑基点随地形抬升
                </label>
                <p className="muted">
                  建筑保持刚体，以基点高程整体平移；显示高程 = 源高程 −{" "}
                  {terrain.reference_height.toFixed(2)} m，不进行
                  ODN／椭球高转换。
                </p>
                <button
                  className="primary full"
                  aria-pressed={query}
                  onClick={() => setQuery(!query)}
                >
                  {query ? "结束地形查询" : "点击场景查询地形"}
                </button>
                {query && (
                  <p className="muted">
                    点击地形获取面带编号、高程、坡度与坡向。边界处坡度采用命中的一侧。
                  </p>
                )}
                {hit ? (
                  <div className="terrain-query" role="status">
                    <strong>
                      {terrainNames[hit.kind]} · {hit.patch}
                    </strong>
                    <dl>
                      <dt>高程 / {terrain.vertical_datum}</dt>
                      <dd>{hit.height.toFixed(3)} m</dd>
                      <dt>坡度</dt>
                      <dd>{hit.slope.toFixed(2)}°</dd>
                      <dt>坡向（局部北起顺时针）</dt>
                      <dd>
                        {hit.aspect === null
                          ? "平坦，无坡向"
                          : `${hit.aspect.toFixed(1)}°`}
                      </dd>
                      <dt>局部参数 u / v</dt>
                      <dd>
                        {hit.u.toFixed(3)} / {hit.v.toFixed(3)}
                      </dd>
                    </dl>
                  </div>
                ) : (
                  query && <p>尚未命中有效地形（空洞和范围外不外推）。</p>
                )}
                <details>
                  <summary>来源与表达说明</summary>
                  {Object.entries(terrain.source).map(([k, v]) => (
                    <p className="source-note" key={k}>
                      <b>{k}</b>
                      <span>{v}</span>
                    </p>
                  ))}
                </details>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void save({ ...env, terrain: null }, previewChanges ? "移除地形预览" : "已移除地形，可撤销")
                  }
                >
                  {previewChanges ? "预览移除地形" : "移除当前地形"}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {previewChanges && <p className="form-note">新增、修改、补齐示例及移除均先保存独立草稿。检查后在上方确认写入；丢弃草稿可返回原项目。</p>}
            <FunctionExplanation
              asset={asset}
              references={
                item
                  ? env.features.filter((f) => f.asset === item.asset).length
                  : 0
              }
            />
            <button
              className="full"
              disabled={disabled}
              onClick={() => void addExamples()}
            >
              {env.features.some((f) => f.id === "function_plaza")
                ? previewChanges ? "选择 / 预览补齐示例" : "选择 / 补齐函数示例"
                : previewChanges ? "预览添加函数示例" : "加入函数地物示例"}
            </button>
            <label>
              选择已有地物
              <select
                aria-label="选择函数地物"
                disabled={viewingDisabled}
                value={item?.id ?? ""}
                onChange={(e) => onSelect(e.target.value || null)}
              >
                <option value="">新建地物</option>
                {env.features.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            {item && (
              <button
                className="full"
                disabled={viewingDisabled}
                onClick={() => focus(item.id)}
              >
                <MapPin size={15} /> 定位此地物
              </button>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void storeFeature();
              }}
            >
              <fieldset disabled={disabled} className="feature-fields">
                <label>
                  地物类型
                  <select
                    aria-label="地物类型"
                    value={asset.kind}
                    onChange={(e) => {
                      const next = structuredClone(
                        featurePresets[e.target.value as FeatureAsset["kind"]],
                      );
                      setAsset(next);
                      setName(next.name);
                    }}
                  >
                    {Object.entries(featurePresets).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  地物名称
                  <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="full"
                  disabled={disabled}
                  onClick={onPick}
                >
                  <MapPin size={15} />
                  {placing ? "取消地物选址" : "在场景中放置地物"}
                </button>
                <button type="button" className="full" onClick={onCenter}>
                  使用视图中心放置地物
                </button>
                {(["longitude", "latitude", "altitude"] as const).map(
                  (k, i) => (
                    <label key={k}>
                      {["地物经度", "地物纬度", "距地形高度 / m"][i]}
                      <input
                        required
                        type="number"
                        step="any"
                        min={[-180, -85, -500][i]}
                        max={[180, 85, 9000][i]}
                        value={position[k]}
                        onChange={(e) =>
                          setPosition({
                            ...position,
                            [k]: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ),
                )}
                <label>
                  所属层
                  <select
                    value={layer}
                    onChange={(e) => setLayer(e.target.value as typeof layer)}
                  >
                    <option value="surface">地上 / 地表</option>
                    <option value="underground">
                      地下（请填写负的距地形高度）
                    </option>
                  </select>
                </label>
                <label>
                  整体比例
                  <input
                    required
                    type="number"
                    min="0.1"
                    max="20"
                    step="0.1"
                    value={scale}
                    onChange={(e) => setScale(Number(e.target.value))}
                  />
                </label>
                <label>
                  地物朝向 / °
                  <input
                    required
                    type="number"
                    min="-180"
                    max="180"
                    step="any"
                    value={heading}
                    onChange={(e) => setHeading(Number(e.target.value))}
                  />
                </label>
                <h4>函数组件 · {asset.components.length} 个组件</h4>
                <p className="muted">
                  橙色标记为当前地物基点，保存与选址均保留视角。尺寸与组件位置可分别调整。
                </p>
                {asset.components.map((part, index) => (
                  <details key={part.id} className="function-component">
                    <summary>
                      <i style={{ background: part.color }} />
                      {part.category} · {part.function}
                    </summary>
                    <label>
                      {part.category}颜色
                      <input
                        type="color"
                        aria-label={`${part.category}颜色`}
                        value={part.color}
                        onChange={(e) =>
                          setAsset({
                            ...asset,
                            components: asset.components.map((p) =>
                              p.category === part.category
                                ? { ...p, color: e.target.value }
                                : p,
                            ),
                          })
                        }
                      />
                    </label>
                    {Object.entries(part.parameters).map(([k, v]) => (
                      <label key={k}>
                        {(
                          {
                            radius: "半径 / m",
                            height: "高度 / m",
                            width: "宽度 / m",
                            depth: "厚度 / m",
                            inner_radius: "内半径 / m",
                            outer_radius: "外半径 / m",
                            angle: "圆弧角度 / °",
                          } as Record<string, string>
                        )[k] ?? k}
                        <input
                          required
                          type="number"
                          step="any"
                          min={k === "inner_radius" ? 0 : 0.001}
                          max={k === "angle" ? 360 : 1000}
                          value={v}
                          onChange={(e) =>
                            setAsset({
                              ...asset,
                              components: asset.components.map((p, i) =>
                                i === index
                                  ? {
                                      ...p,
                                      parameters: {
                                        ...p.parameters,
                                        [k]: Number(e.target.value),
                                      },
                                    }
                                  : p,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                    {part.position.map((v, axis) => (
                      <label key={`pos${axis}`}>
                        组件位置 {["X", "Y", "Z"][axis]} / m
                        <input
                          required
                          type="number"
                          step="any"
                          min="-10000"
                          max="10000"
                          value={v}
                          onChange={(e) =>
                            setAsset({
                              ...asset,
                              components: asset.components.map((p, i) =>
                                i === index
                                  ? {
                                      ...p,
                                      position: p.position.map((n, j) =>
                                        j === axis ? Number(e.target.value) : n,
                                      ) as [number, number, number],
                                    }
                                  : p,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </details>
                ))}
                {item && shared.length > 1 && <div className="feature-batch-preview">
                  <label className="check-row"><input type="checkbox" aria-label="同步更新同定义地物" checked={applyShared}
                    onChange={e => setApplyShared(e.target.checked)} />同步更新同定义地物 · {shared.length} 个实例</label>
                  <p>本次函数定义改变 {changedParts} 个构件；{applyShared ? `将影响 ${shared.length} 个实例` : "仅更新当前实例"}。各实例原有名称、位置、朝向、比例及地上 / 地下分类保持不变。</p>
                  {applyShared && <details><summary>查看受影响对象</summary><ul>{shared.slice(0, 20).map(f => <li key={f.id}>{f.name} · {f.id}</li>)}</ul>{shared.length > 20 && <p>另有 {shared.length - 20} 个实例。</p>}</details>}
                </div>}
                {validation.length > 0 && (
                  <div className="feature-validation" role="alert">
                    {validation.map((message, i) => (
                      <p key={i}>{message}</p>
                    ))}
                  </div>
                )}
                <button
                  className="primary full"
                  disabled={disabled || validation.length > 0 || !name.trim()}
                  type="submit"
                >
                  <Plus size={15} />
                  {previewChanges ? item ? "预览地物修改" : "预览添加地物" : item ? "保存地物修改" : "添加函数地物"}
                </button>
              </fieldset>
            </form>
            {item && (
              <div className="city-object-actions">
                <button
                  disabled={disabled}
                  onClick={() => {
                    onSelect(null);
                    setName(`${name.slice(0, 75)} · 副本`);
                  }}
                >
                  复制为新地物草稿
                </button>
                <button
                  disabled={disabled}
                  onClick={() => {
                    const features = env.features.filter(
                      (f) => f.id !== item.id,
                    );
                    const used = new Set(features.map((f) => f.asset));
                    void save(
                      {
                        ...env,
                        features,
                        feature_assets: Object.fromEntries(
                          Object.entries(env.feature_assets).filter(([id]) =>
                            used.has(id),
                          ),
                        ),
                      },
                      previewChanges ? "移除函数地物预览" : "已移除函数地物",
                    ).then((ok) => {
                      if (ok) onSelect(null);
                    });
                  }}
                >
                  {previewChanges ? "预览移除地物" : "移除此地物"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
