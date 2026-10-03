import { createHash } from "node:crypto";
export function candidateFixture(city = "london") {
  const revision = (city === "london" ? "a" : "b").repeat(64);
  const download = kind => {
    const sha256 = kind === "archive" ? revision : (kind === "report" ? "e" : "f").repeat(64);
    return { url: `/cities/${city}/source-candidates/v2/downloads/${sha256}/${kind}`, sha256,
      byte_length: 1234, filename: `${city}-v2-${kind}.${kind === "provenance" ? "zip" : "json"}`,
      media_type: kind === "provenance" ? "application/zip" : "application/json" };
  };
  return { format: "gugis-source-candidates", schema_version: 1, city_id: city,
    comparison_basis: "original-seed-vs-non-active-candidate", candidates: [{ version: "v2", status: "non-active",
      baseline: { revision: "c".repeat(64), building_count: 4, road_count: 5, height_policy: { "height-tag": 1, "levels-derived": 1, assumed: 2 } },
      candidate: { revision, building_count: 3, road_count: 5, height_policy: { "height-tag": 1, "levels-derived": 1, assumed: 1 } },
      source: { sha256: "d".repeat(64), snapshot: "2026-10-03T04:31:51Z", licence: "ODbL 1.0",
        licence_url: "https://opendatacommons.org/licenses/odbl/1-0/", attribution: "© OpenStreetMap contributors",
        attribution_url: "https://www.openstreetmap.org/copyright", coverage_label: `${city} fixture sample`,
        query_bbox_wgs84: [-1, 51, 0, 52], actual_data_bbox_wgs84: [-1.1, 50.9, .1, 52.1], scope: "sample-area" },
      changes: { height_corrections: [{ osm_way: 111, name: `${city} fixture building`, baseline_height_m: 9.6, candidate_height_m: city === "london" ? .5 : 155 }],
        removed_buildings: [{ osm_way: 222, reason: "Unsupported building part" }], preexisting_omissions: [{ osm_way: 333, reason: "Complex footprint already omitted" }],
        added_osm_ways: [], unchanged: { placements: true, parameters: true, roads: true }, assumed_height_wording_changes: 1 },
      limitations: ["Fixture evidence only; no surveyed terrain"],
      downloads: Object.fromEntries(["provenance", "archive", "report"].map(kind => [kind, download(kind)])) }] };
}
export function candidateResponse(value, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  const hash = createHash("sha256").update(bytes).digest("hex");
  return new Response(bytes, { headers: { etag: `"${hash}"`, ...headers } });
}
