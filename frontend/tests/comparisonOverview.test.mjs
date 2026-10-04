import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { create, act } from "react-test-renderer";

const report = JSON.parse(await readFile(new URL("../../shared/terrain-comparison-overview.json", import.meta.url), "utf8"));
const cache = new URL("../node_modules/.cache/gugis-tests/", import.meta.url);
await mkdir(cache, { recursive: true });
const outfile = fileURLToPath(new URL("ComparisonOverview.mjs", cache));
await build({
  entryPoints: [fileURLToPath(new URL("../src/compare/ComparisonOverview.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile,
  loader: { ".css": "empty" },
});
const Overview = (await import(pathToFileURL(outfile).href)).default;
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");
const format = value => value.toFixed(3);

function fixture() {
  let renderer;
  act(() => { renderer = create(React.createElement(Overview)); });
  return {
    get root() { return renderer.root; },
    group: label => renderer.root.findByProps({ role: "group", "aria-label": label }),
    close: () => act(() => renderer.unmount()),
  };
}

test("the centimetre target uses the maximum parameter-domain bound, not sampled RMS", () => {
  const f = fixture();
  const target = report.variants.filter(v => v.maxRuledHeightErrorMetres * 100 <= 1)
    .sort((a, b) => a.multipatchFilesBytes - b.multipatchFilesBytes)[0];
  const resolutions = f.group("查看离散档位").findAllByType("button");
  assert.match(text(resolutions.find(button => button.props["aria-pressed"])), new RegExp(`${target.ruledSubdivisions}×${target.ruledSubdivisions}`));
  assert.match(text(f.root.findByProps({ className: "co-highlights" })), /0\.177 MB/);
  assert.match(text(f.root.findByProps({ className: "co-highlights" })), /11\.921 MB/);
  assert.match(text(f.root.findByProps({ className: "co-highlights" })), /98\.5%/);
  const four = report.variants.find(v => v.ruledSubdivisions === 4);
  assert.ok(four.queries.sampledRmsHeightErrorMetres * 100 < 1);
  assert.ok(four.maxRuledHeightErrorMetres * 100 > 1);
  act(() => resolutions.find(button => text(button).startsWith("4×4")).props.onClick());
  const status = f.root.findAll(node => typeof node.props.className === "string" && node.props.className.startsWith("co-target-status"))[0];
  assert.match(text(status), /未满足 1 cm 参数域界限/);
  assert.match(text(status), /1\.010 cm/);
  f.close();
});

test("every metric and every resolution displays the compact report's actual value", () => {
  const f = fixture();
  const metricButtons = f.group("对比总览指标").findAllByType("button");
  const metricCases = [
    ["文件体积", "MB", v => v.multipatchFilesBytes / 1e6],
    ["点高程 RMS", "cm", v => v.queries.sampledRmsHeightErrorMetres * 100],
    ["坡度 RMS", "°", v => v.queries.derivatives.slope.rmsDegrees],
    ["坡向 RMS", "°", v => v.queries.derivatives.aspect.rmsDegrees],
  ];
  for (const [name, unit, value] of metricCases) {
    act(() => metricButtons.find(button => text(button).startsWith(name)).props.onClick());
    const svg = f.root.findByProps({ className: "co-chart" });
    assert.match(text(svg.findByType("title")), new RegExp(name));
    const description = text(svg.findByType("desc"));
    for (const variant of report.variants) {
      const resolutions = f.group("查看离散档位").findAllByType("button");
      act(() => resolutions.find(button => text(button).startsWith(`${variant.ruledSubdivisions}×${variant.ruledSubdivisions}`)).props.onClick());
      const readout = text(f.root.findByProps({ className: "co-selected-value" }));
      assert.ok(readout.includes(`${format(value(variant))} ${unit}`), readout);
      assert.ok(description.includes(`${format(value(variant))} ${unit}`), description);
      assert.equal(resolutions.filter(button => button.props["aria-pressed"] === true).length, 1);
      assert.ok(resolutions.every(button => button.props.type === "button"));
    }
    assert.equal(metricButtons.filter(button => button.props["aria-pressed"] === true).length, 1);
    if (name !== "文件体积") assert.match(description, /差异基准 0，并不表示原生坡度或坡向为零/);
  }
  f.close();
});

test("the clickable SVG and native keyboard buttons update the same measured selection", () => {
  const f = fixture();
  const column = f.root.findAll(node => node.props.className === "co-chart-column")[0];
  act(() => column.props.onClick());
  const selected = f.group("查看离散档位").findAllByType("button").find(button => button.props["aria-pressed"]);
  assert.match(text(selected), /^1×1/);
  assert.match(text(f.root.findByProps({ className: "co-readout" })), /0\.599 MB/);
  assert.equal(f.root.findByProps({ className: "co-readout" }).props["aria-live"], "polite");
  assert.match(text(f.root), /本项目 ArcGIS 兼容 MultiPatch 参考读回/);
  assert.match(text(f.root), /非 ArcGIS 软件跑分/);
  assert.match(text(f.root), /合成地形/);
  assert.match(text(f.root), /未运行 ArcGIS Slope \/ Aspect/);
  assert.ok(text(f.root).includes(report.reportSha256.slice(0, 12)));
  f.close();
});

test("the full table keeps four distinct measured resolutions and follows the chart selection", () => {
  const f = fixture();
  const table = f.root.findByType("table");
  assert.equal(table.findByType("tbody").findAllByType("tr").length, report.variants.length);
  assert.match(text(table.findByType("caption")), /MultiPatch 参考读回/);
  act(() => f.group("查看离散档位").findAllByType("button").find(button => text(button).startsWith("4×4")).props.onClick());
  const selected = table.findByType("tbody").findAllByType("tr").find(row => row.props["aria-current"] === "true");
  assert.equal(text(selected.findByType("th")), "4×4 · 当前");
  const cells = selected.findAllByType("td").map(text);
  const four = report.variants.find(variant => variant.ruledSubdivisions === 4);
  assert.equal(cells[1], format(four.multipatchFilesBytes / 1e6));
  assert.equal(cells.at(-1), "未满足");
  assert.equal(f.group("下载四档对比结果").findAllByType("button").length, 2);
  assert.match(text(f.root), /下载文件保留原始数值/);
  f.close();
});
