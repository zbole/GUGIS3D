import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers3, RotateCcw, Expand, Maximize2, Minimize2 } from "lucide-react";
import BuildingScene, { SceneHandle } from "./BuildingScene";
import Inspector from "./Inspector";
import SemanticTree from "./SemanticTree";
import {
  BuildingDocument,
  SceneView,
  categoryLabels,
  componentCategories,
  initialView,
  presentation,
} from "./model";
import { buildingColor, type BuildingColorMode } from "./buildingAppearance";
export default function DetailPanel({
  document,
  expanded = false,
  onToggleExpanded,
  colorMode = "material",
  appearanceKey,
  onColorModeChange,
}: {
  document: BuildingDocument;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  colorMode?: BuildingColorMode;
  appearanceKey?: string;
  onColorModeChange?: (mode: BuildingColorMode) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [view, setView] = useState<SceneView>(() =>
      initialView(document.parameters.floors),
    ),
    [ready, setReady] = useState(false);
  const select = useCallback((id: string | null) => setSelected(id), []),
    scene = useRef<SceneHandle>(null);
  useEffect(() => {
    setSelected(null);
    setView(initialView(document.parameters.floors));
  }, [document]);
  const patch = (p: Partial<SceneView>) => setView((v) => ({ ...v, ...p }));
  const floors = Array.from(
    { length: document.parameters.floors },
    (_, i) => i + 1,
  );
  const count = useMemo(
    () =>
      document.nodes.filter((n) => n.template && presentation(n, view).visible)
        .length,
    [document, view],
  );
  return (
    <div className="studio-workspace">
      <aside className="studio-left">
        <SemanticTree
          document={document}
          selected={selected}
          onSelect={select}
        />
      </aside>
      <main className="studio-center">
        <div className="scene-topline">
          <div>
            <span className="live-dot" />
            {document.parameters.name}
            <small>{count.toLocaleString()} 个可见构件</small>
          </div>
          <div className="scene-tools">
            {onToggleExpanded && <button
              aria-label={expanded ? "恢复场景面板" : "放大场景"}
              title={expanded ? "恢复面板（Esc）" : "放大场景"}
              aria-pressed={expanded}
              onClick={onToggleExpanded}
            >{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>}
            <button
              aria-label="俯视"
              title="俯视建筑"
              disabled={!ready}
              onClick={() => scene.current?.top()}
            >
              <Layers3 size={17} />
            </button>
            <button
              aria-label="定位选中对象"
              title="定位选中对象"
              disabled={!ready}
              onClick={() => scene.current?.focus()}
            >
              <Expand size={17} />
            </button>
            <button
              aria-label="重置相机"
              title="重置相机"
              disabled={!ready}
              onClick={() => scene.current?.reset()}
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>
        <div className="scene-area">
          <BuildingScene
            ref={scene}
            document={document}
            expanded={expanded}
            colorMode={colorMode}
            appearanceKey={appearanceKey}
            view={view}
            selected={selected}
            onSelect={select}
            onReady={setReady}
          />
          <div className="scene-annotation">
            <span>三维实体 · 语义关联</span>
            <small>局部坐标 / 米</small>
          </div>
          <div className="scene-help">
            拖动旋转 · 滚轮缓速缩放 · 点击查看构件
          </div>
        </div>
        <section className="floor-controls" aria-label="楼层分析">
          <div className="floor-control-title">
            <h2>楼层 / 分段查看</h2>
            {onColorModeChange && <label className="palette-select">建筑配色
              <select aria-label="建筑配色" value={colorMode} onChange={e => onColorModeChange(e.target.value as BuildingColorMode)}>
                <option value="material">自然材质</option><option value="category">构件分类</option>
              </select>
            </label>}
            <button
              className="text-button"
              onClick={() => {
                setView(initialView(document.parameters.floors));
                select(null);
              }}
            >
              恢复全部
            </button>
          </div>
          <div className="floor-modes">
            {(
              [
                ["all", "完整"],
                ["focus", "关注楼层"],
                ["isolate", "仅看区间"],
                ["lift", "移开上部"],
                ["hide", "隐藏上部"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                className={view.mode === mode ? "active" : ""}
                aria-pressed={view.mode === mode}
                onClick={() => patch({ mode })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="floor-options">
            {view.mode === "isolate" || view.mode === "focus" ? (
              <>
                <label>
                  起始层
                  <select
                    aria-label="起始楼层"
                    value={view.from}
                    onChange={(e) => {
                      const from = Number(e.target.value);
                      patch({ from, to: Math.max(from, view.to) });
                    }}
                  >
                    {floors.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label>
                  结束层
                  <select
                    aria-label="结束楼层"
                    value={view.to}
                    onChange={(e) => {
                      const to = Number(e.target.value);
                      patch({ to, from: Math.min(to, view.from) });
                    }}
                  >
                    {floors.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : view.mode === "lift" || view.mode === "hide" ? (
              <>
                <label>
                  上部起始层
                  <select
                    aria-label="上部起始楼层"
                    value={view.split}
                    onChange={(e) => patch({ split: Number(e.target.value) })}
                  >
                    {floors.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                {view.mode === "lift" && (
                  <label>
                    抬升
                    <input
                      aria-label="抬升距离"
                      type="range"
                      min={3}
                      max={50}
                      value={view.lift}
                      onChange={(e) => patch({ lift: Number(e.target.value) })}
                    />
                    {view.lift} m
                  </label>
                )}
              </>
            ) : (
              <p className="muted">
                查看变换不会改变已保存的实体坐标。地标分段不代表实测楼层。
              </p>
            )}
          </div>
        </section>
      </main>
      <aside className="studio-right">
        <Inspector
          document={document}
          selected={selected}
          onSelect={select}
          onFocus={() => scene.current?.focus()}
          ready={ready}
          colorMode={colorMode}
          appearanceKey={appearanceKey}
        />
        <section className="component-layers">
          <h4>构件显示</h4>
          <div>
            {componentCategories.map((category) => (
              <label key={category}>
                <input
                  type="checkbox"
                  checked={view.categories.has(category)}
                  onChange={(e) => {
                    const categories = new Set(view.categories);
                    e.target.checked
                      ? categories.add(category)
                      : categories.delete(category);
                    patch({ categories });
                  }}
                />
                <i
                  className="category-swatch"
                  style={{ backgroundColor: buildingColor(category, document.parameters.kind, appearanceKey ?? document.parameters.name, colorMode) }}
                />
                {categoryLabels[category]}
              </label>
            ))}
          </div>
          <label className="overall-opacity">
            整体透明度
            <input
              aria-label="整体透明度"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={view.opacity}
              onChange={(e) => patch({ opacity: Number(e.target.value) })}
            />
            {Math.round(view.opacity * 100)}%
          </label>
        </section>
      </aside>
    </div>
  );
}
