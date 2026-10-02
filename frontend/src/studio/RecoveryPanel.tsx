import { useEffect, useRef, useState } from "react";
import { listVersions, type CityVersion } from "./cityApi";
export default function RecoveryPanel({
  busy,
  onPreview,
}: {
  busy: boolean;
  onPreview: (id: string, label: string, buildingsOnly?: boolean) => void;
}) {
  // A new request identity also reloads the same page without exposing old rows.
  const [request, setRequest] = useState({ offset: 0 });
  const latestRequest = useRef(request);
  const [page, setPage] = useState<{
    request: typeof request;
    versions: CityVersion[];
    more: boolean;
    error: string;
  } | null>(null);
  const loading = page?.request !== request;
  const versions = loading ? [] : (page?.versions ?? []);
  const more = !loading && page?.more;
  const error = loading ? "" : (page?.error ?? "");
  const { offset } = request;
  useEffect(() => {
    let active = true;
    listVersions(offset)
      .then((r) => {
        if (active) {
          setPage({ request, versions: r.versions, more: r.has_more, error: "" });
        }
      })
      .catch((e) => {
        if (active) setPage({ request, versions: [], more: false, error: String(e) });
      });
    return () => {
      active = false;
    };
  }, [request, offset]);
  const changePage = (nextOffset: number) => {
    if (busy || loading || latestRequest.current !== request) return;
    const next = { offset: nextOffset };
    // Guard repeated clicks and old preview handlers before React renders again.
    latestRequest.current = next;
    setRequest(next);
  };
  const preview = (...args: Parameters<typeof onPreview>) => {
    if (busy || loading || latestRequest.current !== request) return;
    onPreview(...args);
  };
  return (
    <section className="recovery-panel" aria-label="历史版本恢复">
      <h3>历史版本与恢复</h3>
      <p>先预览版本的建筑和地形，再确认恢复。恢复前的城市会保留为历史版本。</p>
      <button
        disabled={busy || loading}
        onClick={() =>
          preview(
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
          preview("baseline", "恢复内置初始城市（615 栋，不含后加地形）")
        }
      >
        预览内置初始城市
      </button>
      {loading && <p role="status">读取版本列表…</p>}
      {error && <p role="alert">版本列表读取失败：{error}</p>}
      <button disabled={busy || loading} onClick={() => changePage(offset)}>
        {error ? "重试读取版本列表" : "刷新版本列表"}
      </button>
      <div className="version-list" aria-busy={loading}>
        {versions.map((v) => (
          <div key={v.revision}>
            <strong>{new Date(v.modified_at).toLocaleString("zh-CN")}</strong>
            <span>
              {(v.bytes / 1048576).toFixed(1)} MiB · {v.revision.slice(0, 8)}
              {v.current ? " · 当前版本" : ""}
            </span>
            <button
              disabled={busy || loading || v.current}
              onClick={() => {
                if (!v.current)
                  preview(v.revision, `恢复历史版本 ${v.revision.slice(0, 8)}`);
              }}
            >
              预览这个版本
            </button>
          </div>
        ))}
      </div>
      {!loading && !error && !versions.length && (
        <p>{offset === 0 ? "尚无历史版本。" : "本页暂无历史版本，请返回上一页或刷新列表。"}</p>
      )}
      <div className="city-object-actions">
        <button
          disabled={busy || loading || offset === 0}
          onClick={() => { if (offset > 0) changePage(Math.max(0, offset - 20)); }}
        >
          上一页
        </button>
        <span aria-label="版本列表页码">第 {offset / 20 + 1} 页</span>
        <button
          disabled={busy || loading || !more}
          onClick={() => { if (more) changePage(offset + 20); }}
        >
          下一页
        </button>
      </div>
    </section>
  );
}
