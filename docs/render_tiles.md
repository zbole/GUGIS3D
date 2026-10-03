# Read-only bounded render packages (v1)

The optional **轻量分块浏览（只读）** mode loads bounded building geometry by camera
viewport without requesting the complete semantic city archive. Choose it on the
initial city-selection page, or switch from the workspace toolbar. The existing
full editor remains a separate mode. A mode/city switch releases the previous
viewer; it never loads three city models together.

The [loaded-building inspector and loading controls](lightweight_city_exploration.md)
add local name/ID search, 25-row pages, explicit focus, source-placement details,
manual pause/resume and automatic pause while the page is hidden. Search reads
only currently resident tiles; it never requests a full-city substitute.

This path does **not** increase the editable CityDocument limits, claim whole-city
coverage, or replace the self-contained formal project. Original seeds, current
files, drafts, histories, IDs, OSM attribution and geometry remain unchanged.
Prebuilt packages are required; a missing package gives an explicit offline-build
instruction and retry, with no automatic full-city or synthetic fallback.

## Build explicitly, offline

From the repository root (use the local virtual-environment Python if applicable):

```sh
python data-pipeline/build_render_tiles.py backend/data/bristol.gugis.json --city bristol
python data-pipeline/build_render_tiles.py backend/data/cities/london.gugis.json --city london
python data-pipeline/build_render_tiles.py backend/data/cities/birmingham.gugis.json --city birmingham
```

For a saved project, pass its exact `current.gugis.json` path instead. `--output`
selects a separate cache root; the default is `.local/render-cache`. Input files
must be outside that root. The builder validates a single complete snapshot with
the existing CityDocument/CityArchive validation and hashes its **exact bytes**.
Sources above the existing 128 MiB input limit are refused before validation.
It never imports, packs back into, initializes or rewrites a formal city.

Options: `--tile-size 250` (metres, range 10–10000), `--max-buildings 256`,
`--max-primitives 12000`, `--max-bytes 2097152`, `--max-tiles 20000`.
Primitives count geometry instances, not triangles; per-solid triangle/vertex
limits remain those of the validated authoring format. Bytes and building counts
are independently enforced. A tile over any limit fails the **entire build** with
a diagnostic listing tile IDs, counts, bytes and exceeded limits. No geometry is
silently omitted, truncated or replaced with a proxy footprint. A single building
spanning too many cells also fails explicitly. Byte limits above 16 MiB are
unsupported by v1.

Every output package is:

```text
.local/render-cache/{allowlisted-city}/{full-source-sha256}/
  manifest.json
  tiles/x{signed-integer}_y{signed-integer}.json
.local/render-cache/{allowlisted-city}/active.json
```

Temporary output is fully verified before an atomic directory publication and
atomic active-pointer replacement. Old revision packages remain readable. The
source revision directory is immutable: rebuilding the same bytes with different
grid settings, limits, audit warnings or exporter semantics is refused; select a
new cache root rather than overwriting it. Identical rebuilds are idempotent.
Source filesystem metadata is held only in the active pointer for cheap freshness
checks, not in deterministic manifest/tile content. Build timestamps and local
absolute paths are excluded from packages.

## Geometry, transforms and coverage

For each asset, use **all existing nonempty overview primitives unchanged**. Only
an absent or empty overview falls back to **every real component**. Original
pooled `box`, `box-set`, and `mesh` prototypes, bindings, colors, dimensions,
vertices and triangle order are retained. Legacy City 1.0 mesh data also remain
exact meshes; no bounding-box shape conversion is introduced.

Each placement retains its original ID, asset ID, name, WGS84 longitude/latitude,
altitude and heading. Each fallback primitive retains its node ID, template ID,
category, local position and local rotation. Overview IDs are
`overview_{template_id}`, with zero position/rotation and a null node ID. As in
CityScene, category is `roof` for an overview key `roof`, otherwise `wall`.

Render world transform:

```text
ENU_WGS84(placement.longitude, placement.latitude, placement.altitude)
  * Rz(-placement.heading)
  * translation(primitive.position)
  * Rz(primitive.rotation_z)
```

Angles are degrees. Box primitives are centered on the local origin; box-set
bounds and mesh vertices are already in their authored local coordinates.
`parameters.kind` survives as the render asset's `kind`; coordinates already
include the model's authored dimensions, so clients must not rescale them again.

The grid uses a single WGS84 ECEF-to-ENU frame at the midpoint of placement
longitude/latitude extrema (zero altitude). Empty cities use the workspace center.
Geometric bounds transform **all actual solid vertices**, including box-set
corners, component translations, local rotation, building heading and altitude.
The resulting ENU extrema get a one-micrometre outward numerical allowance. Every
250 m XY grid cell intersecting a building's full envelope receives that complete
building. Spanning objects are duplicated deliberately; they are not assigned only
by placement center. Geographic bounds are conservative enclosing-sphere bounds,
not placement extents, query-window coverage or invented survey footprints.

De-duplicate residency by `(city_id, revision, instance.id)` and keep a reference
count if multiple resident tiles refer to the same building. Primitive identity
within that building is `primitive.id`. Evict a building only when its final tile
reference is removed. A tile's `cell_bounds_enu` is its index cell; `bounds_enu` and
`bounds_wgs84` enclose the complete included objects and can cross cell boundaries.

## Manifest contract

`GET /cities/{city_id}/render/manifest` returns the manifest object directly:

- `format: "gugis-render-package-v1"`
- `city_id`, `name`, `revision`, `source_sha256`, `source_byte_length`
- `grid: {tile_size_m, origin_wgs84:[longitude,latitude,altitude], coordinate_system:"ECEF_ENU"}`
- `bounds_enu: [minX,minY,minZ,maxX,maxY,maxZ] | null`
- `bounds_wgs84: [west,south,east,north] | null`, `bounds_policy`
- `counts`: unique `buildings`, `assets`, `primitives`, `overview_buildings`,
  `full_fallback_buildings`, `tiles`, duplicate-inclusive
  `tile_building_references`, `tile_primitive_references`, `tile_bytes`, `source_roads`
- `limits: {max_buildings,max_primitives,max_bytes,max_tiles}`
- `quality_policy`, `layers`, `dedupe_identity`, `primitive_identity`
- `quality_warnings_source_revision`, `quality_warnings`: audit findings only
  applicable to the exact source SHA (or an explicit unavailable-audit warning)
- `attribution: {source,license,license_url,metadata}`: allowlisted provenance metadata,
  including height assumptions, source links and known omissions; unrelated saved
  analysis or user notes are not copied
- `tiles`: `{id,grid:[ix,iy],cell_bounds_enu:[x0,y0,x1,y1],bounds_enu,bounds_wgs84,
  building_count,primitive_count,byte_length,sha256,url}` entries
- `package_sha256`: SHA256 of canonical UTF-8 manifest JSON excluding this field

Canonical JSON uses sorted keys, no whitespace, non-ASCII UTF-8. Every tile hash
covers its exact response bytes. The active pointer holds the manifest's exact
byte hash separately. Empty packages have no tiles, zero counts and null bounds.

## Tile contract

`GET /cities/{city_id}/render/{revision}/tiles/{tile_id}` returns:

```json
{
  "format": "gugis-render-tile-v1",
  "city_id": "bristol",
  "revision": "<64 lowercase hexadecimal characters>",
  "tile_id": "x0_y-1",
  "geometry_library": {
    "original_geometry_id": {"kind": "box"}
  },
  "assets": {
    "original_asset_id": {
      "quality": "full-fallback",
      "kind": "urban",
      "primitives": [{
        "id": "original_node_id",
        "node_id": "original_node_id",
        "template_id": "original_template_id",
        "category": "wall",
        "geometry": "original_geometry_id",
        "color": "#c9b6a3",
        "size": [10, 4, 3],
        "position": [0, 0, 1.5],
        "rotation_z": 0
      }]
    }
  },
  "instances": [{
    "id": "original_instance_id", "asset": "original_asset_id", "name": "Building",
    "longitude": -2.603, "latitude": 51.454, "altitude": 0, "heading": 0
  }]
}
```

`size` is present only for unit-box bindings. Box-set geometry is
`{kind:"box-set",bounds:[[xmin,ymin,zmin,xmax,ymax,zmax],...]}` using the existing
shared box topology; meshes are `{kind:"mesh",vertices,triangles}`. Geometry and
asset dictionaries include only the entries referenced by this tile. This is a
render-only subset, **not** an importable/editable CityArchive.

`layers` explicitly says buildings included; roads, terrain, function features and
semantics not included. Clients must show these missing layers rather than imply
complete city coverage. `counts.source_roads` is provenance, not rendered roads.
Snapshots with terrain draping enabled are rejected because silently ignoring
terrain offsets would change building transforms. Undraped environmental content
can exist in the source but is not exported. No DEM or height accuracy is implied.

## HTTP behavior and validation

The endpoints never auto-build, read/parse/hash a complete source city, initialize
workspaces or create directories. Unknown cities, malformed full revision hashes,
unsafe/non-manifest tile IDs, symlinks, oversized files and hash failures are
rejected. IDs are allowlisted cities and strict hash/grid names, never user paths.
Cache responses are checked against bounded manifests and content digests.

A missing manifest returns 404 with `detail.code=render_package_unavailable`.
Missing/corrupt package or tile responses use `render_package_invalid`,
`render_tile_unavailable` or `render_tile_invalid` as appropriate. No fallback to
another city or a newly generated synthetic city occurs.

The manifest uses `Cache-Control: no-cache`; tiles use
`Cache-Control: private, max-age=31536000, immutable`, since local projects may be
private. Both expose strong ETags and honor conditional GET (including weak GET
validators). `X-Render-Revision` is the full source hash.
`X-Render-Freshness: current` means the formal file, or the seed when no formal file
exists, has exactly the offline source's filesystem identity/size/timestamps.
Otherwise freshness is `unknown`. Stat changes alone do not prove different
content; the endpoint does not claim stale or current by guessing or by comparing
unrelated global caches. A client already holding a verified formal revision can
compare it with `manifest.revision` itself.

## Retained-seed measurement (2026-10-03)

These are local offline size measurements, **not** GPU/FPS, network, full-city or
ArcGIS performance results. Boundary duplicates are included in the tile totals.

| Retained seed | Buildings | Source bytes | Tiles | Total tile bytes | Largest tile |
|---|---:|---:|---:|---:|---:|
| Bristol | 615 | 33,185,716 | 15 | 3,948,584 | 814,612 |
| London | 823 | 1,951,713 | 32 | 1,454,325 | 131,604 |
| Birmingham | 809 | 1,715,239 | 31 | 1,211,223 | 108,951 |

Bristol uses 600 authored overviews and 15 complete fallback buildings (10,435
unique render primitives). London/Birmingham retain all 823/809 original LoD1
component solids as fallback. Their original known seed quality problems are
preserved and disclosed, not silently fixed by an exporter. New non-active v2
candidate datasets are separate inputs and have different full revisions.

Verification:

```sh
cd backend
python -m unittest discover -s tests -p test_render_tiles.py -v
```

Tests cover all three primitive kinds, original IDs/colors/bindings, empty and
missing overview fallback, local/placement transforms, spanning-boundary inclusion,
legacy input, deterministic bytes, immutable settings, every overflow limit,
source preservation, source audit/layer warnings, malformed IDs/path traversal,
missing caches, conditional reads, old revisions, hashes and symlink rejection.


## Browser viewport loader

`CityTilePreview` and `RenderTileStream` form an isolated, read-only session:

- Camera movement/resize is debounced; conservatively intersect WGS84 tile envelopes with the visible rectangle, then prioritise nearby tiles
- A horizon/missing rectangle considers all candidates but still respects the same request and residency budgets
- Maximum 8 active tiles / 8 MiB source bytes, 16 cached tiles / 16 MiB source bytes, 3 concurrent requests
- Byte totals are encoded source-payload budgets, not measurements or hard bounds of decoded JS objects or GPU memory
- Keep one tile containing the selected building within these limits; release the pin on city/revision reset or deselection
- Abort superseded requests; epoch checks also reject stale completions when a transport delivers after cancellation
- LRU eviction releases offscreen parsed tiles; tile failures remain visibly incomplete until an explicit retry succeeds
- Validate exact manifest response bytes against the strong SHA-256 ETag, and each tile against its declared byte length, SHA-256, city/revision/ID and geometry references
- Never reserialize parsed numbers to verify Python-produced hashes: JSON `250.0` and JavaScript `250` are semantically equal but have different bytes
- Stream decoded response bytes with a hard length limit; compressed transport length is not mistaken for the uncompressed tile byte count
- Merge duplicate boundary references by original IDs; reject conflicting geometry/asset/placement identities across tiles
- Adapt into the distinct in-memory `gugis-render-scene` format, not an editable CityDocument. No save, draft, import or export API is passed to this viewer

The scene shows loaded/total buildings, active/target tiles, budget-delayed tiles,
failures and absent layers. The surrounding header labels full-project catalogue
counts separately from the loaded render snapshot. Rechecking the manifest does
not claim that a changed formal project has automatically rebuilt its cache.
Known quality warnings come from the exact render-source revision.

The direct preview has its own scene/canvas sizing styles; users need not visit
the full editor first. Normal tile arrivals update geometry without recreating
the Cesium Viewer or resetting its camera. The optional view uses only the
existing overview/full-fallback representations, with the shared GPU residency
budgets, and never implies that missing roads or terrain were loaded.

### Reproduce real-package protocol checks

Build the three offline packages above, then run:

```sh
node frontend/scripts/verify-render-streaming.mjs
```

An optional first argument selects another cache root. This check feeds actual
Python-produced package bytes through a fetch double, validates their ETags,
hashes, queue limits, unique instances, projection and selected-building pin.
It is not a browser, real-network timing or GPU/FPS measurement.

The centre-prioritised eight-tile test on retained seeds produced:

| Seed | Initially loaded buildings | Tiles | Source bytes | Full source archive bytes |
|---|---:|---:|---:|---:|
| Bristol | 508 / 615 | 8 | 3,322,946 | 33,185,716 |
| London | 309 / 823 | 8 | 488,629 | 1,951,713 |
| Birmingham | 322 / 809 | 8 | 459,211 | 1,715,239 |

All three runs made zero full-city requests, stayed at no more than three
concurrent requests, retained the selected building after an offscreen pan, and
preserved exact-revision quality warnings. Actual browser viewports choose their
own nearby/intersecting tiles, so these counts are reproducible protocol-fixture
results, not universal first-screen counts.

Frontend tests cover bytes/hash failures, cancellation/stale requests, cache
caps/eviction, retry, cross-city isolation, duplicate/conflicting identities,
read-only projection, direct-entry styles, mode navigation and camera lifecycle.
Production build and Worker checks are separate. Real browser/WebGL acceptance
of this new mode remains outstanding; previous Windows screenshots describe the
baseline editor, not this streaming view.
