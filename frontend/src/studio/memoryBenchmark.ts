import seedReport from "../../../shared/city-memory-benchmark.json" with { type: "json" };
import localReport from "../../../shared/current-city-memory-benchmark.json" with { type: "json" };

export function memoryComparison(revision: string) {
  const report = revision === seedReport.file_sha256 ? seedReport : localReport;
  const shared = report.measurements.shared.median_bytes;
  const wire = report.measurements.wire.median_bytes;
  const mesh = report.measurements.mesh.median_bytes;
  const sample = report.measurements.shared.samples[0];
  return {
    matches: revision === report.file_sha256,
    shared,
    wire,
    saved: wire - shared,
    saving: 100 * (1 - shared / wire),
    buildings: sample.instances,
    components: sample.component_instances,
    runs: report.runs,
    rows: [
      { label: "共享几何与模板实例", bytes: shared, saving: null },
      {
        label: "独立顶点＋边（线框）",
        bytes: wire,
        saving: 100 * (1 - shared / wire),
      },
      {
        label: "独立顶点＋三角面（实体网格）",
        bytes: mesh,
        saving: 100 * (1 - shared / mesh),
      },
    ],
  };
}

export const memoryMB = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
