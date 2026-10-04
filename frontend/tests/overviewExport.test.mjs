import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { overviewExport } from "../src/compare/overviewExport.ts";

const report = JSON.parse(await readFile(new URL("../../shared/terrain-comparison-overview.json", import.meta.url), "utf8"));
const rows = csv => csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n")
  .map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"')));

test("CSV retains all four actual measurements, exact numeric precision, units and the maximum-bound target", () => {
  const file = overviewExport(report, { metric: "slope", resolution: 4 }, "csv");
  assert.ok(file.content.startsWith("\uFEFF"), "Excel can recognise the Chinese UTF-8 headers");
  assert.match(file.filename, new RegExp(`${report.reportSha256.slice(0, 12)}\\.csv$`));
  const [header, ...data] = rows(file.content);
  assert.equal(data.length, 4);
  assert.ok(data.every(row => row.length === header.length));
  const values = data.map(row => Object.fromEntries(header.map((key, index) => [key, row[index]])));
  for (const variant of report.variants) {
    const row = values.find(row => row["离散档位"] === `${variant.ruledSubdivisions}×${variant.ruledSubdivisions}`);
    assert.equal(Number(row["GUGIS原生文件(bytes)"]), variant.gugisTerrainBytes);
    assert.equal(Number(row["MultiPatch五文件(bytes)"]), variant.multipatchFilesBytes);
    assert.equal(Number(row["采样高程RMS差(m)"]), variant.queries.sampledRmsHeightErrorMetres);
    assert.equal(Number(row["最大高程差界限(m)"]), variant.maxRuledHeightErrorMetres);
    assert.equal(Number(row["坡向RMS差(deg)"]), variant.queries.derivatives.aspect.rmsDegrees);
    assert.equal(Number(row["坡向有效匹配点数"]), variant.queries.derivatives.aspectMatchedCount);
    assert.equal(row["当前选择档位"], variant.ruledSubdivisions === 4 ? "是" : "否");
    assert.equal(row["来源城市SHA256"], report.cityRevision);
    assert.equal(row["报告SHA256"], report.reportSha256);
    assert.equal(row["ArcGIS软件运行实测"], "未测量");
    assert.match(row["地形来源"], /合成演示地形/);
  }
  assert.equal(values.find(row => row["离散档位"] === "4×4")["满足1cm参数域界限"], "否", "RMS below 1cm does not prove the maximum target");
  assert.equal(values.find(row => row["离散档位"] === "8×8")["满足1cm参数域界限"], "是");
});

test("JSON exports the unchanged saved report and current display context without inventing an ArcGIS run", () => {
  const original = JSON.stringify(report);
  const file = overviewExport(report, { metric: "height", resolution: 2 }, "json");
  const exported = JSON.parse(file.content);
  assert.deepEqual(exported.sourceReport, report);
  assert.deepEqual(exported.view, { metric: "height", resolution: 2 });
  assert.equal(exported.scope.arcgisRuntime, "not-measured");
  assert.match(exported.scope.coverage, /非全城覆盖/);
  assert.match(exported.scope.targetPolicy, /不是 RMS/);
  assert.equal(JSON.stringify(report), original, "export does not mutate evidence");
});

test("unmeasured resolutions cannot be exported as a measured selection", () => {
  assert.throws(() => overviewExport(report, { metric: "storage", resolution: 16 }, "csv"), /不在已测报告/);
  assert.throws(() => overviewExport(report, { metric: "storage", resolution: NaN }, "json"), /不在已测报告/);
});
