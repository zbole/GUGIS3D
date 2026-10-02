import { useState } from "react";
export default function BlockForm({
  busy,
  longitude,
  latitude,
  onGenerate,
}: {
  busy: boolean;
  longitude: number;
  latitude: number;
  onGenerate: (count: number, longitude: number, latitude: number) => void;
}) {
  const [count, setCount] = useState(24),
    [lon, setLon] = useState(longitude),
    [lat, setLat] = useState(latitude);
  return (
    <details className="block-form">
      <summary>扩建英式街区 · 12 / 24 / 48 栋</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onGenerate(count, lon, lat);
        }}
      >
        <p>
          组合四类设计建筑，共享楼栋定义。先生成草稿，检查与已有建筑的位置关系后确认。
        </p>
        <label>
          建筑数量
          <select
            aria-label="街区建筑数量"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            {[12, 24, 48].map((n) => (
              <option key={n} value={n}>
                {n} 栋
              </option>
            ))}
          </select>
        </label>
        <label>
          街区中心经度
          <input
            required
            type="number"
            step="any"
            min="-180"
            max="180"
            value={lon}
            onChange={(e) => setLon(Number(e.target.value))}
          />
        </label>
        <label>
          街区中心纬度
          <input
            required
            type="number"
            step="any"
            min="-85"
            max="85"
            value={lat}
            onChange={(e) => setLat(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setLon(longitude);
            setLat(latitude);
          }}
        >
          使用当前建筑选址
        </button>
        <button className="primary full" disabled={busy} type="submit">
          生成街区草稿
        </button>
        <small>
          示意扩建，不代表新增建筑的实测位置；本操作不会直接写入正式城市。
        </small>
      </form>
    </details>
  );
}
