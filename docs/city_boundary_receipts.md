# Offline city-boundary receipts

`data-pipeline/validate_city_boundary.py` records bounded integrity and structural
checks of a **local, explicitly supplied** GeoJSON boundary and provenance JSON.
It makes no downloads, creates no city workspace, and imports no city models.
No real boundary files or receipts are shipped by this change. All geometric
fixtures in its tests are synthetic and do not represent Bristol or another city.

A successful receipt means only `integrity_and_structure`. Every receipt states:

- `topology: not_checked`
- `city_boundary_authority: not_verified`
- `coverage: not_assessed`

The repository currently has rasterio, pyproj and pyshp, but does not declare
Shapely. This checker uses only the Python standard library and the UK registry;
it does not install or assume a topology engine. It does **not** check
self-intersections, ring orientation, hole containment, overlaps, polygon area,
valid administrative geography, or whether a named city lies inside the geometry.
For example, a closed bow-tie or three distinct collinear vertices can pass the
structural checks. A checksum proves neither geography nor publisher identity.

Boundary definitions differ. A city's administrative area, built-up area and
settlement footprint need not coincide. The operator must explicitly name the
chosen definition and preserve its source provenance. Recording that claim does
not independently verify it or make a city ready for full-coverage ingestion.

## Explicit local inputs

The source must be a UTF-8 GeoJSON `Feature`, or a `FeatureCollection` containing
**exactly one** `Feature`. Raw geometry, multiple features, null geometry and
non-Polygon/MultiPolygon geometry are rejected. Feature `properties` must be an
object or `null`. Identity must match the metadata selector exactly, including
string versus integer type; the checker does not infer an identity from a name.

Coordinates must be two-element, finite, non-boolean longitude/latitude arrays,
with longitude in [-180, 180] and latitude in [-90, 90]. Every polygon needs an
exterior ring. Every ring needs at least four positions, explicit closure and at
least three distinct positions. Interior rings and MultiPolygon parts are kept in
their supplied order in the selected geometry hash. Nothing is repaired,
reoriented, dissolved, reprojected, clipped or replaced by a bounding box.

Metadata must declare `EPSG:4326` or `OGC:CRS84`, together with `lon-lat` coordinate
order. An absent GeoJSON `crs` member is permitted. If a `crs` is supplied at the
collection, feature or geometry level, it must be a named CRS matching the
metadata. Recognized aliases are `urn:ogc:def:crs:EPSG::4326` and
`urn:ogc:def:crs:OGC:1.3:CRS84`. A conflicting, null, linked or unsupported CRS is
rejected. This explicit longitude/latitude contract does not implement EPSG's
formal latitude/longitude axis order and does not silently switch coordinates.

An illustrative **synthetic metadata template**, not a real boundary record:

```json
{
  "city_id": "uk-eng-bristol",
  "boundary_definition": {
    "kind": "other",
    "name": "Synthetic demonstration only; not a city boundary"
  },
  "publisher": "Synthetic fixture, no real publisher",
  "dataset_title": "Synthetic structure demonstration",
  "dataset_version": "test-1",
  "effective_date": "2026-01-01",
  "feature_identifier": {"type": "feature-id", "value": "synthetic"},
  "source_url": "https://example.invalid/synthetic-boundary",
  "retrieval_date": "2026-01-02",
  "license_url": "https://example.invalid/synthetic-license",
  "attribution": "Synthetic demonstration only",
  "declared_crs": "EPSG:4326",
  "coordinate_order": "lon-lat",
  "expected_source_sha256": "REPLACE_WITH_64_LOWERCASE_HEXADECIMAL_CHARACTERS"
}
```

All displayed fields are required; unknown metadata fields are rejected. For real
inputs replace every illustrative value with the supplied source's actual
provenance. `city_id` must exist in the separate UK membership registry, and
`--city-id` must match it. `boundary_definition.kind` is one of `administrative`,
`built-up`, `settlement`, `other`; every kind also needs a nonempty `name`.

Dates are valid ISO calendar dates, `YYYY-MM-DD`. Publisher, title, version and
attribution must be nonempty bounded text. Source and license URLs must use
HTTP(S), have a hostname, and contain no URL username/password credentials.
The tool records URLs but never fetches them; neither URL availability nor license
rights are verified. Do not include secrets in provenance URLs or other fields.

Feature identity is selected using either:

```json
{"type": "feature-id", "value": "the-exact-GeoJSON-id"}
```

or an explicitly named, case-sensitive, top-level property (no dotted-path inference):

```json
{"type": "property", "key": "GSS_CODE", "value": "the-exact-property-value"}
```

Values are nonempty strings or integers in the interoperable ±(2^53−1) range.
Booleans and floats are not identifiers. The expected source digest must be
obtained and deliberately recorded by the operator before validation. It binds
the **raw file bytes**, including whitespace; it is not independently trusted
provenance. `sha256sum /path/to/boundary.geojson` can compute a local digest.

## Invocation and file safety

Run from the repository root in an environment providing Python's POSIX
directory-descriptor and `O_NOFOLLOW` support (tested on Linux):

```sh
python data-pipeline/validate_city_boundary.py \
  --city-id uk-eng-bristol \
  --input /path/to/explicit-boundary.geojson \
  --metadata /path/to/explicit-provenance.json \
  --output /path/to/existing-output-directory/uk-eng-bristol.json
```

Every argument is required. The source, metadata and output must be distinct
files, without hard-link aliases. The output must end in `.json`; its parent
directory must already exist. The CLI does not initialize directories or
workspaces. An operator who wants the read-only readiness API to discover the
receipt can deliberately create `.local/coverage/boundaries/`, then choose
`.local/coverage/boundaries/uk-eng-bristol.json` as the explicit output.

Inputs, output and every ancestor directory are opened without following
symlinks. Paths containing `..` and non-regular inputs such as FIFOs are rejected.
Secure file operations fail closed on platforms without the necessary nofollow
and directory-descriptor primitives. This version does not offer a weaker native
Windows fallback; byte-only receipt validation is platform-independent.

The writer refuses repository `backend/data/` and `database/` outputs. Under this
repository's `.local/`, only files directly inside `coverage/boundaries/` are
allowed; city/current/draft/history/cache locations cannot be output targets.
The source files remain in place and are never modified. Existing output bytes
are preserved: an identical file is an idempotent success, while different bytes
cause an error. Publishing uses a temporary file in the existing output directory,
flush/fsync and an atomic **no-replacement hard link**, with temporary-file cleanup.
A filesystem that does not support that operation fails rather than falling back
to destructive replacement. The output contains no wall-clock creation timestamp
or absolute source paths. No network requests or dependency installs occur.

## Bounds and deterministic format

- GeoJSON input: at most 16 MiB
- Metadata input and canonical metadata: at most 64 KiB
- Receipt read: at most 128 KiB
- At most 200,000 coordinate positions, counting closing points and all holes/parts
- At most 10,000 rings, including exterior and interior rings across all parts
- JSON nesting: at most 32 arrays/objects, checked before recursive decoding
- Duplicate object keys, invalid UTF-8, non-finite numbers and invalid JSON: rejected

Schema `boundary-receipt/v1` contains exactly:

- `schema`, `city_id`, and the validated `metadata`
- `source`: raw input `sha256` and `bytes`
- `geometry`: `type`, selected geometry `sha256`, `polygon_count`, `ring_count`,
  `coordinate_count`, and computed `extrema` in [west, south, east, north] order
- `checker`: `version: 1.0.0`, `validation_level: integrity_and_structure`
- The three explicit non-claim flags listed above
- `checksum_sha256`: SHA-256 of the canonical receipt without this checksum field

Canonical encoding is Python JSON with sorted object keys, compact separators,
ASCII escaping and disallowed NaN/Infinity. This is the versioned encoding for
this checker, **not** RFC 8785 JCS. Output adds one LF after canonical bytes. Array
order and parsed number representation are retained (for example `0` and `0.0`
can hash differently); GeoJSON object-key order does not affect the geometry hash.
The selected geometry hash covers only `{type, coordinates}` and includes every
ring. Source `bbox` and other foreign members are never substituted for coordinates;
they remain covered by the raw file hash but do not change selected geometry
hashing. Computed extrema are simple coordinate minima/maxima, not a tested
coverage envelope, including for shapes crossing the antimeridian.

## Read-only receipt consumer

`app.services.boundary_receipts.validate_receipt(content, expected_city_id)` takes
bounded UTF-8 bytes or a string and returns the checked record, or raises
`ValueError`. It validates duplicate-free JSON, schema, exact fields, checker
version, registry identity, required provenance, count/extrema bounds, matching
recorded source hash, checksum and the fixed non-claim flags. It does not read the
original source, recompute geometry, verify source availability or authenticate
its publisher. A self-checksum is not a signature: someone able to edit a receipt
can also recompute its checksum.

The companion `read_bounded_file(path, limit)` supplies no-symlink bounded local
file reading. It raises `UnsupportedPlatformError` (a `ValueError` subclass)
when secure filesystem primitives are unavailable; consumers can distinguish
that platform limitation from a rejected receipt. `MAX_RECEIPT_BYTES` is public
for the readiness router. A valid
receipt may be displayed as **receipt-recorded** only, never complete, authoritative,
topologically validated, or full-city coverage-ready. Unknown or unsupported
versions/flags and altered receipts are rejected rather than promoted.

Tests: `PYTHONPATH=backend python -m unittest discover -s backend/tests -p test_boundary_receipts.py -v`.
They cover synthetic Polygon/MultiPolygon holes, limits, identity, CRS, provenance,
determinism, tampering, explicit non-claims, symlinks, protected paths, atomic
publication failure/races and CLI idempotency without creating real city data.
