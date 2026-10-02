import { Component, type ErrorInfo, type ReactNode } from "react";
import "./AppErrorBoundary.css";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string;
}

/** Keep a failed render or lazy import recoverable without reloading in a loop. */
export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      componentStack: "",
    };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    const technicalReason = [error.stack || error.message, componentStack]
      .filter(Boolean)
      .join("\n");

    return (
      <main className="app-recovery">
        <section className="app-recovery-panel" role="alert" aria-labelledby="app-recovery-title">
          <p className="app-recovery-brand">GUGIS3D</p>
          <h1 id="app-recovery-title">页面暂时无法显示</h1>
          <p className="app-recovery-description">
            页面加载或显示遇到了问题。可以刷新页面重新打开项目。
          </p>
          <p className="app-recovery-data-note">
            刷新不会删除服务端已保存的城市项目和独立草稿。
            浏览器中尚未生成预览的表单参数可能需要重新输入。
          </p>
          <div className="app-recovery-actions">
            <button className="app-recovery-refresh" type="button" onClick={() => window.location.reload()}>
              刷新页面
            </button>
            <a href="/">返回城市工作台</a>
            <a href="/compare">打开证据对比</a>
          </div>
          <details className="app-recovery-details">
            <summary>查看技术原因</summary>
            <pre>{technicalReason}</pre>
          </details>
        </section>
      </main>
    );
  }
}
