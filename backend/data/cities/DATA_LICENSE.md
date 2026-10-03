# Local city source samples

`london-osm.json` and `birmingham-osm.json` are retained OpenStreetMap extracts,
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

| Source | Query box: west, south, east, north (WGS84 degrees) | Building ways | Non-area named highway ways | Source snapshot |
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

## Wider data for future work

Geofabrik offers regional OSM PBF downloads for
[Greater London](https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html)
and [West Midlands](https://download.geofabrik.de/europe/united-kingdom/england/west-midlands.html).
Those regional downloads were not imported in this release. A complete city
workflow requires boundary filtering, relation support and partitioned loading;
switching this release's city workspace does not imply those requirements are
already met.
