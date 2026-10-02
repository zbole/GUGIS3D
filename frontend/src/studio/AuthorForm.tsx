import { Box, MapPin, Settings2 } from "lucide-react";
import type { Parameters } from "./model";
import { kinds, presets } from "./cityModel";
export default function AuthorForm({
  draft,
  setDraft,
  onGenerate,
  busy,
  mode = "add",
  placing = false,
  onPickPosition,
  onUseViewCenter,
}: {
  draft: Parameters;
  setDraft: (p: Parameters) => void;
  onGenerate: () => void;
  busy: boolean;
  mode?: "add" | "update";
  placing?: boolean;
  onPickPosition?: () => void;
  onUseViewCenter?: () => void;
}) {
  const civic = ["wills", "cabot", "cathedral"].includes(draft.kind),
    footprint = ["footprint", "urban"].includes(draft.kind);
  const num = (key: keyof Parameters, value: string) =>
    setDraft({ ...draft, [key]: value === "" ? NaN : Number(value) });
  return (
    <>
      <div className="panel-heading">
        <h2>{mode === "add" ? "添加建筑" : "更新选中建筑"}</h2>
        <Settings2 size={17} />
      </div>
      <form
        className="author-form"
        onSubmit={(e) => {
          e.preventDefault();
          onGenerate();
        }}
      >
        <fieldset disabled={busy} className="feature-fields">
          <p className="muted">
            {mode === "add"
              ? "先预览，确认后写入城市。草稿可丢弃，刷新可恢复。"
              : "修改先进入草稿预览，确认后才替换这一栋。共享模型的其他建筑保持独立。"}
          </p>
          <label>
            建筑名称
            <input
              required
              maxLength={80}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            建筑类型
            <select
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as Parameters["kind"];
                setDraft({
                  ...draft,
                  ...presets[kind],
                  kind,
                  name: kinds[kind],
                  scale: 1,
                  longitude: draft.longitude,
                  latitude: draft.latitude,
                  heading: draft.heading,
                });
              }}
            >
              {Object.entries(kinds)
                .filter(
                  ([key]) =>
                    !["footprint", "urban"].includes(key) || key === draft.kind,
                )
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          {civic && (
            <p className="form-note">
              地标形态参考：比例可调整，分层为建模分段。内部空间与细部未测绘核验。
            </p>
          )}
          {footprint ? (
            <p className="form-note">
              此建筑保留原始轮廓与现有构件。可移动、旋转或改名；选择另一类型将替换整栋几何。
            </p>
          ) : (
            <div className="form-grid">
              <label>
                {civic ? "建模分段数" : "楼层数"}
                <input
                  required
                  type="number"
                  min={1}
                  max={
                    draft.kind === "warehouse"
                      ? Math.min(8, Math.floor(16 / Math.max(1, draft.units)))
                      : civic ||
                          draft.kind === "georgian" ||
                          draft.kind === "victorian" ||
                          ["tudor", "warehouse", "chapel", "civic"].includes(
                            draft.kind,
                          )
                        ? 12
                        : 30
                  }
                  step={1}
                  value={Number.isNaN(draft.floors) ? "" : draft.floors}
                  onChange={(e) => num("floors", e.target.value)}
                />
              </label>
              {!civic && (
                <>
                  <label>
                    联排 / 单元数
                    <input
                      required
                      type="number"
                      min={1}
                      max={draft.kind === "civic" ? 3 : 4}
                      step={1}
                      value={Number.isNaN(draft.units) ? "" : draft.units}
                      onChange={(e) => num("units", e.target.value)}
                    />
                  </label>
                  <label>
                    层高 / m
                    <input
                      required
                      type="number"
                      min={2.5}
                      max={4.5}
                      step={0.1}
                      value={
                        Number.isNaN(draft.floor_height)
                          ? ""
                          : draft.floor_height
                      }
                      onChange={(e) => num("floor_height", e.target.value)}
                    />
                  </label>
                </>
              )}
              <label>
                模型比例
                <input
                  required
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={Number.isNaN(draft.scale) ? "" : (draft.scale ?? 1)}
                  onChange={(e) => num("scale", e.target.value)}
                />
              </label>
            </div>
          )}
          <div className="origin-fields">
            <h4>地理位置与朝向</h4>
            {onPickPosition && (
              <div className="city-placement-actions">
                <button
                  type="button"
                  className="full"
                  disabled={busy}
                  aria-pressed={placing}
                  onClick={onPickPosition}
                >
                  <MapPin size={15} />{" "}
                  {placing ? "取消场景选址" : "在场景中选位置"}
                </button>
                <button
                  type="button"
                  className="full"
                  disabled={busy}
                  onClick={onUseViewCenter}
                >
                  使用当前视图中心
                </button>
                <p className="muted">
                  标记表示建筑基点；切换类型保留选址。请选择空地，避免与已有建筑重叠。
                </p>
              </div>
            )}
            {(
              [
                ["longitude", "经度", -180, 180],
                ["latitude", "纬度", -85, 85],
                ["altitude", "基准高程 / m", -500, 9000],
                ["heading", "朝向 / °", -180, 180],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  required
                  type="number"
                  step="any"
                  min={min}
                  max={max}
                  value={Number.isNaN(draft[key]) ? "" : draft[key]}
                  onChange={(e) => num(key, e.target.value)}
                />
              </label>
            ))}
          </div>
          <button type="submit" className="primary full" disabled={busy}>
            <Box size={17} />
            {busy
              ? "正在制作预览…"
              : mode === "add"
                ? "生成建筑草稿"
                : "预览建筑修改"}
          </button>
        </fieldset>
      </form>
    </>
  );
}
