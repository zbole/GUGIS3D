import type { ComparisonSuite } from "./comparisonModel";

export async function loadComparisonSuite(url: string, expected: { reportSha256: string; bundleId: string; cityRevision: string }, signal: AbortSignal): Promise<ComparisonSuite> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`实验数据加载失败（HTTP ${response.status}）。`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 4 * 1024 * 1024) throw new Error("实验数据超出页面加载上限。");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== expected.reportSha256) throw new Error("实验数据校验不一致，请刷新页面获取完整版本。");
  const suite = JSON.parse(new TextDecoder().decode(buffer));
  if (suite.schema !== "gugis-terrain-comparison-suite-v1" || suite.cityRevision !== expected.cityRevision || suite.bundleId !== expected.bundleId)
    throw new Error("实验数据与页面摘要不属于同一个实验。");
  return suite;
}
