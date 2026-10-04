import type { CityWorkspace } from "./cityWorkspaces";

/** An audit of a seed revision is not an audit of later edits or an unsaved draft. */
export default function CitySourceWarnings({ workspace, revision, draft = false, defaultExpanded = true }: {
  workspace: CityWorkspace; revision: string; draft?: boolean; defaultExpanded?: boolean;
}) {
  if (draft || !revision || workspace.data_revision !== revision || !workspace.quality_warnings?.length) return null;
  return <details className="city-source-warning" open={defaultExpanded}>
    <summary>当前数据版本存在已知精度问题 · {workspace.quality_warnings.length} 项</summary>
    {workspace.quality_warnings.map(warning => <p key={warning.code}>{warning.message}</p>)}
    <small>现有项目未被自动替换。查看来源、修正或导入新版本前，请保留当前数据与历史。</small>
  </details>;
}
