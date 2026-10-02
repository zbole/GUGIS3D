import { useEffect, useState } from "react";
import { listVersions, type CityVersion } from "./cityApi";
export default function RecoveryPanel({
  busy,
  onPreview,
}: {
  busy: boolean;
  onPreview: (id: string, label: string, buildingsOnly?: boolean) => void;
}) {
  const [versions, setVersions] = useState<CityVersion[]>([]),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listVersions(offset)
      .then((r) => {
        if (active) {
          setVersions(r.versions);
          setMore(r.has_more);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [offset]);
  return (
    <section className="recovery-panel" aria-label="历史版本恢复">
      <h3>历史版本与恢复</h3>
      <p>先预览版本的建筑和地形，再确认恢复。恢复前的城市会保留为历史版本。</p>
      <button
        disabled={busy || loading}
        onClick={() =>
          onPreview(
            "baseline",
            "仅恢复内置建筑，保留当前道路、地形与函数地物",
            true,
          )
        }
      >
        仅恢复内置建筑（保留地形 / 地物）
      </button>
      <button
        disabled={busy || loading}
        onClick={() =>
          onPreview("baseline", "恢复内置初始城市（615 栋，不含后加地形）")
        }
      >
        预览内置初始城市
      </button>
      {loading && <p role="status">读取版本列表…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="version-list">
        {versions.map((v) => (
          <div key={v.revision}>
            <strong>{new Date(v.modified_at).toLocaleString("zh-CN")}</strong>
            <span>
              {(v.bytes / 1048576).toFixed(1)} MiB · {v.revision.slice(0, 8)}
              {v.current ? " · 当前版本" : ""}
            </span>
            <button
              disabled={busy || v.current}
              onClick={() =>
                onPreview(v.revision, `恢复历史版本 ${v.revision.slice(0, 8)}`)
              }
            >
              预览这个版本
            </button>
          </div>
        ))}
      </div>
      {!loading && !versions.length && <p>尚无历史版本。</p>}
      <div className="city-object-actions">
        <button
          disabled={busy || loading || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          上一页
        </button>
        <button
          disabled={busy || loading || !more}
          onClick={() => setOffset(offset + 20)}
        >
          下一页
        </button>
      </div>
    </section>
  );
}
