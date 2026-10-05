# Local city source samples

## Cambridge source added 2026-10-05

Cambridge is a partial centre/college district sample, not all-city coverage.
Query bounds `[0.106, 52.189, 0.147, 52.218]`; complete imported ways extend to
`[0.0956414, 52.1839678, 0.1543402, 52.2209898]`. There are 9,838 building ways
and 1,501 named non-area highway ways. Eight invalid-floor/elevated objects
are refused, with IDs and reasons in `cambridge-import.json`. Heights use
4 tags, 2,541 floor-derived estimates (3.2 m/floor), 7,293 assumptions (9.6 m).
These are LoD1 volumes, not surveyed heights or reconstructed facades/interiors.
Multipolygon relations and relation courtyards were not acquired.

`cambridge-source.json` records the original retained download and filtered
public extract; 530 unrelated contact/free-text tags were removed, preserving
IDs, geometry and modelling tags. Source and derived databases retain
© OpenStreetMap contributors attribution and [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Independent EA 2022 1 m DTM is audited and published separately; terrain is
absent from this OSM seed. The separate raster and native model are under
OGL v3.0, with © Environment Agency copyright and/or database right 2022.
All rights reserved. `shared/public-terrain-sources-v3.json` records source,
lossless pixels and native-query residuals; both earlier catalogues are retained.

## Oxford source added 2026-10-05

Oxford is a centre/northern-college sample, not full-city coverage. Query bounds
are `[-1.273, 51.741, -1.235, 51.768]`; complete imported ways extend to
`[-1.2779238, 51.7362408, -1.2284337, 51.7721437]`. The retained LoD1 dataset
contains 6,594 building ways and 1,123 non-area named highway ways. Ten objects
with unsupported part, elevated, underground or invalid-height semantics were
refused; `oxford-import.json` records each ID and reason. Heights are 11 source
height tags, 682 floor-derived estimates at 3.2 m/floor and 5,901 assumed 9.6 m.
Multipolygon relations, courtyards represented by relation holes, detailed
facades, interiors and terrain are not acquired by this whole-way workflow.
`oxford-source.json` binds the retained original and public filtered extract;
482 unrelated contact/free-text tags were removed without changing geometry or
IDs. Both the source extract and derived city database are distributed under
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), with
© OpenStreetMap contributors attribution. Independent EA 2022 1 m DTM is
now audited and published separately, outside this OSM city seed. It is under
OGL v3.0 and carries: © Environment Agency copyright and/or database right
2022. All rights reserved. Its source, retained pixels and native-preview
residuals are recorded in `shared/public-terrain-sources-v2.json`; the historical
six-source catalogue remains unchanged. This is partial coverage, not a claim
of surveyed building heights or an independent ground-accuracy certificate.

## Bath source added 2026-10-05

Bath is a partial centre/northern-slope sample, not whole-city coverage. The
query box is `[-2.377, 51.373, -2.347, 51.395]`; whole-way imported bounds are
`[-2.3829226, 51.370903, -2.3416261, 51.3998275]`. It contains 7,877 buildings
and 967 named non-area road ways. Three unclosed building ways were refused.
Heights: 2 height tags, 1,409 level-derived estimates, 6,466 defaults of 9.6 m.
`bath-source.json` binds the original download and public filtered extract;
970 unrelated tags were removed without changing object IDs or geometry.
The source extract and derived GUGIS database retain the ODbL 1.0 licence
and © OpenStreetMap contributors attribution described below. EA terrain is
separate and retains its own OGL v3.0 attribution, never an OSM height claim.

Current coverage notes are separate from the immutable `DATA_LICENSE.md`
included in the audited historical candidate bundles. Do not edit that historical
licence file or weaken its hash checks to add new cities.

The retained `*-osm.json` files are OpenStreetMap extracts,
© OpenStreetMap contributors, distributed under the
[Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Any GUGIS city database derived from these extracts is distributed under the same
ODbL 1.0 licence. Application code is separate from this database licence.
Attribution information: https://www.openstreetmap.org/copyright .

The source files contain building ways and named highway ways intersecting the
query bounding boxes. They contain neither multipolygon relations nor measured
terrain. A way crossing the box edge is returned with its entire geometry, so
the query box and actual geometry extent are different. The import manifest
must report actual imported bounds and conversion omissions. These are central
district samples, **not complete city surveys**.

The following table describes historical initial requests, not the current expanded seeds. Current counts and exact bounds are recorded in each import manifest and the workspace catalogue.

| Historical source | Query box: west, south, east, north (WGS84 degrees) | Building ways | Non-area named highway ways | Source snapshot |
| --- | --- | ---: | ---: | --- |
| London: Westminster / Whitehall | -0.138, 51.496, -0.123, 51.508 | 825 | 762 | 2026-10-03T04:31:51Z |
| Birmingham: Civic centre / Jewellery Quarter | -1.914, 52.476, -1.901, 52.488 | 809 | 479 | 2026-10-03T04:31:51Z |

`*-source.json` records the exact query, download endpoint, source timestamp,
acquisition time, retained byte count, SHA-256, query bounds and attribution.
The two requests were successfully downloaded locally on 2026-10-03. Contact
phone, email, fax, mobile, `contact:*`, website and free-text note/description
tags are omitted; no OSM contributor usernames, user IDs or changeset metadata
were requested. Modelling tags, object IDs and geometry are retained.

## Reproduce a source request

Send the query in the corresponding source manifest to the public
[Overpass API](https://overpass-api.de/api/interpreter) as the URL-encoded POST
form field `data`. The current API may return a newer OSM snapshot; SHA-256
therefore identifies the checked-in source copy, not every future request.
The endpoint documentation and public instance usage guidance are available at
https://wiki.openstreetmap.org/wiki/Overpass_API .

London query:

```text
[out:json][timeout:90];
(
 way["building"](51.496,-0.138,51.508,-0.123);
 way["highway"]["name"](51.496,-0.138,51.508,-0.123);
);
out tags geom;
```

Birmingham query:

```text
[out:json][timeout:90];
(
 way["building"](52.476,-1.914,52.488,-1.901);
 way["highway"]["name"](52.476,-1.914,52.488,-1.901);
);
out tags geom;
```

## York source, 2026-10-05 local time

`york-source.json` records the successful bounded GET request to the public
Overpass server `https://gall.openstreetmap.de/api/interpreter`, announced by
the official Overpass status service. Original response SHA-256:
`d60ca4e924aa4e2a8eac5b62db8c8d0891c705dce331f08f3b63c439d23e9a3a`.
The checked-in public extract removes 348 unrelated contact and free-text tags;
IDs, modelling tags and geometry are retained. Public extract SHA-256:
`b17bfb5fb899acd19d2e2e9687a0e62f3f57d2202d8989afb85f0ee1d68231be`.
The preparation script fingerprint and both byte counts are in the manifest.

Query bounds are `[-1.1, 53.947, -1.066, 53.972]`; imported geometry bounds are
`[-1.1051514, 53.944665, -1.060182, 53.9763925]`. The importer retains 6,092
whole-building ways and 1,853 non-area named highway ways. Six building ways
with unsupported elevated/part semantics are omitted, with IDs and reasons in
`york-import.json`. Heights use 465 height tags, 2,357 floor-derived estimates
(3.2 m/floor), and 3,270 assumed values (9.6 m). These are LoD1 volumes, not
surveyed heights, detailed facades, interiors or terrain. All source and derived
York databases carry © OpenStreetMap contributors / ODbL 1.0 attribution.

## Liverpool central and waterfront sample

The independently acquired Liverpool OSM sample contains 3,401 converted
buildings and 1,419 non-area roads. Acquisition window is
[-3.006, 53.391, -2.969, 53.416]; complete intersecting ways are retained,
so this is a partial central district, not administrative or full-city coverage.
The original acquisition remains locally retained; the published extract removes
287 unrelated contact or free-text tags while keeping identifiers, geometry,
modelling attributes and © OpenStreetMap contributors / ODbL 1.0 attribution.
The 26 unsupported buildings are disclosed in liverpool-import.json and not
silently replaced with assumed ground-based geometry.

Height evidence comprises 46 height tags, 196 floor-derived estimates
(3.2 m/floor), and 3,159 assumed values (9.6 m). These are LoD1 volumes,
not surveyed heights, detailed facades, interiors or terrain. The city seed
contains no terrain. Independently acquired EA source data, if available,
remain unpublished until their separate native-model and raster audits pass.

## Sheffield central district sample

The independently acquired Sheffield OSM sample contains 4,324 converted
buildings and 2,407 non-area roads. The acquisition window is
[-1.494, 53.369, -1.451, 53.391]; complete intersecting ways are retained,
so coverage is a partial central district, not the administrative or whole city.
The original download remains locally retained. The public extract removes
401 unrelated contact or free-text tags, preserving object identifiers,
geometry, modelling tags and © OpenStreetMap contributors / ODbL 1.0 attribution.
Four unsupported buildings and their actual reasons are disclosed in
sheffield-import.json; unsupported heights or base levels are not grounded.

Height evidence comprises 61 height tags, 847 floor-derived estimates
(3.2 m/floor), and 3,416 assumed values (9.6 m). These LoD1 volumes are
not surveyed facades, interiors or verified building heights. The city seed
contains no terrain. Independent EA 2022 bare-earth rasters and native
previews are a separate dataset, attributed to the Environment Agency
and distributed under Open Government Licence v3.0.

## Wider data for future work

Geofabrik offers regional OSM PBF downloads for
[Greater London](https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html)
and [West Midlands](https://download.geofabrik.de/europe/united-kingdom/england/west-midlands.html).
Those regional downloads were not imported in this release. A complete city
workflow requires boundary filtering, relation support and partitioned loading;
switching this release's city workspace does not imply those requirements are
already met.
