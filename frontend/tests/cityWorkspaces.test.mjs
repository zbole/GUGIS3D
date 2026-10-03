import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/city-workspaces.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/cityWorkspaces.ts", import.meta.url))], bundle: true,
  platform: "node", format: "esm", packages: "external", outfile,
  define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' } });
const { cityIdFromSearch, cityWorkspaceUrl, cityWorkspaceHref, cityCenter, cityCoverageCoordinates, heightPolicyLabel, citySourceLicense, selectedCitiesFromSearch, selectedCityFromSearch, citySessionUrl } = await import(pathToFileURL(outfile).href);

test("city URLs survive workspace navigation while unknown city ids fall back to Bristol", () => {
  assert.equal(cityIdFromSearch("?city=london&workspace=environment"), "london");
  assert.equal(cityIdFromSearch("?city=birmingham"), "birmingham");
  assert.equal(cityIdFromSearch("?city=../../other"), "bristol");
  assert.equal(cityWorkspaceUrl("http://localhost/?workspace=analysis&city=london#profile", "birmingham"), "http://localhost/?workspace=analysis&city=birmingham#profile");
  assert.equal(cityWorkspaceUrl("http://localhost/?city=london&workspace=city", "bristol"), "http://localhost/?workspace=city");
  assert.equal(cityWorkspaceHref("london", "/compare#terrain-lab"), "/compare?city=london#terrain-lab");
});

test("city centers and empty-workspace placement never fall back to Bristol for London or Birmingham", () => {
  assert.deepEqual(cityCenter({ id: "london", query_bbox_wgs84: [-0.138, 51.496, -0.123, 51.508] }), { longitude: -0.1305, latitude: 51.502 });
  assert.deepEqual(cityCenter({ id: "birmingham", center_wgs84: [-1.9075, 52.482] }), { longitude: -1.9075, latitude: 52.482 });
  assert.notEqual(cityCenter({ id: "london" }).longitude, cityCenter({ id: "bristol" }).longitude);
});

test("coverage labels distinguish actual polygon extents from Bristol placement anchors", () => {
  assert.match(cityCoverageCoordinates({ actual_data_bbox_wgs84: [-0.14, 51.49, -0.12, 51.51] }), /已导入要素范围/);
  assert.match(cityCoverageCoordinates({ building_extent_wgs84: [-2.62, 51.44, -2.58, 51.47] }), /建筑位置范围/);
  assert.equal(cityCoverageCoordinates({ query_bbox_wgs84: [-0.14, 51.49, -0.12, 51.51] }), null, "a download query must not be presented as actual loaded coverage");
});

test("height-policy counts become readable labels without claiming measured heights", () => {
  const label = heightPolicyLabel('{"height-tag":17,"levels-derived":334,"assumed":472}');
  assert.match(label, /17 栋采用 OSM 高度标签.*334 栋按楼层数 × 3.2 m 估算.*472 栋假定 9.6 m.*未独立核验/);
  assert.doesNotMatch(label, /height-tag|levels-derived|assumed/);
  for (const invalid of ['{"height-tag":-1,"levels-derived":3,"assumed":4}', '{"height-tag":null}', '{broken'])
    assert.match(heightPolicyLabel(invalid), /未整体测量核验/);
  assert.equal(heightPolicyLabel("由用户提供的建筑高程"), "由用户提供的建筑高程");
});

test("OSM attribution links to its licence page rather than its POST-only download endpoint", () => {
  const source = citySourceLicense({ source: "© OpenStreetMap contributors", source_url: "https://overpass-api.de/api/interpreter", license: "ODbL 1.0" });
  assert.equal(source.url, "https://www.openstreetmap.org/copyright");
  assert.match(source.label, /© OpenStreetMap contributors.*ODbL 1.0/);
  assert.equal(citySourceLicense({}), null);
});


test("entry choices reject unknown IDs, deduplicate multi-selection and preserve old deep links", () => {
  assert.deepEqual(selectedCitiesFromSearch(""), []);
  assert.deepEqual(selectedCitiesFromSearch("?city=unknown"), []);
  assert.deepEqual(selectedCitiesFromSearch("?cities=london,london,birmingham,../other"), ["london", "birmingham"]);
  assert.deepEqual(selectedCitiesFromSearch("?city=london"), ["bristol", "london", "birmingham"]);
  assert.deepEqual(selectedCitiesFromSearch("?workspace=analysis"), ["bristol", "london", "birmingham"]);
  assert.equal(selectedCityFromSearch("?city=bristol", ["london", "birmingham"]), "london");
  const url = new URL(citySessionUrl("http://localhost/?workspace=analysis&foo=bar", ["bristol"], "bristol"));
  assert.equal(url.searchParams.get("city"), "bristol");
  assert.equal(url.searchParams.get("cities"), "bristol");
  assert.equal(url.searchParams.get("workspace"), "analysis");
  const home = new URL(citySessionUrl(url.href, [], null));
  assert.equal(home.search, "?foo=bar");
});


test("imported provenance URLs cannot execute scripts or carry embedded credentials", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/source", "//example.test/source", "https://name:secret@example.test", "invalid"])
    assert.equal(citySourceLicense({ source: "User data", source_url: url }), null);
  assert.equal(citySourceLicense({ source_url: "https://example.test/source" }).url, "https://example.test/source");
});
