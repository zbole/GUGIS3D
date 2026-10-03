import { readFileSync } from "node:fs";
// Membership uses the retained source list. Sample counts are synthetic unit-test
// values only, not evidence of a new imported or covered dataset.
const registry = JSON.parse(readFileSync(new URL("../../../backend/data/uk-city-registry.json", import.meta.url), "utf8"));
export function readinessFixture() {
  const samples = [["bristol", "uk-eng-bristol"], ["london", "uk-eng-westminster"], ["birmingham", "uk-eng-birmingham"]]
    .map(([workspace_id, related_city_id]) => ({ workspace_id, related_city_id, display_name: `${workspace_id} test sample`,
      status: "available", building_count: 100, road_count: 20, data_revision: "a".repeat(64),
      boundary_membership_verified: false, association_note: "Test association; polygon membership is not verified" }));
  return { schema: "gugis-uk-readiness-v1", source: structuredClone(registry.source), country_counts: { ...registry.country_counts },
    summary: { registered_cities: 76, sample_workspaces: 3, available_sample_workspaces: 3, coverage_assessment: "not-assessed" }, samples,
    cities: registry.cities.map(city => { const sample = samples.find(s => s.related_city_id === city.id); return { ...structuredClone(city),
      sample: { state: sample ? sample.status : "none", workspace_ids: sample ? [sample.workspace_id] : [], boundary_membership_verified: false },
      boundary: { state: "not-recorded", receipt: null }, import: { scope: "full-boundary", state: "not-imported" }, coverage: { state: "not-assessed" } }; }) };
}
