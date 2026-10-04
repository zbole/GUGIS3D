import { useEffect, useId, useRef } from "react";

export default function WorkspaceLeaveNotice({ destination, busy, onCancel, onConfirm }: {
  destination: "tiles" | "selection";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const title = useId(), description = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.activeElement;
    cancel.current?.focus();
    return () => { if (typeof HTMLElement !== "undefined" && previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <section className="workspace-leave-notice" role="alertdialog" aria-modal="false"
    aria-labelledby={title} aria-describedby={description}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
    <div><strong id={title}>{destination === "tiles" ? "切换至只读分块浏览？" : "返回城市选择？"}</strong>
      <p id={description}>已保存项目和独立草稿会保留；尚未生成的表单修改、未保存分析和当前视角不会保留。</p>
      {busy && <p role="status">当前操作尚未完成，请等待后再切换。</p>}</div>
    <div className="workspace-leave-actions">
      <button ref={cancel} type="button" onClick={onCancel}>留在当前工作区</button>
      <button type="button" disabled={busy} onClick={onConfirm}>{destination === "tiles" ? "确认切换浏览" : "确认返回城市选择"}</button>
    </div>
  </section>;
}
