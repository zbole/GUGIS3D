# Bristol source data and derived city database

`bristol-osm.json` contains © OpenStreetMap contributors data, licensed under the
[Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

This source copy omits phone, email, fax, mobile and `contact:*` tags, which are
not needed for the building and street geometry conversion. Source identifiers,
geometry, attribution and modelling tags are retained.

`bristol.gugis.json` is a derived city database distributed under the same ODbL 1.0 license.
Attribution information: https://www.openstreetmap.org/copyright .

The retained response was obtained from the public Overpass API using:

```text
[out:json][timeout:45];
(
 way["building"](51.4500,-2.6100,51.4587,-2.5930);
 way["highway"]["name"](51.4500,-2.6100,51.4587,-2.5930);
);
out tags geom;
```

The response records its source timestamp. The city generator chooses 600 convertible
building ways nearest the core centre, and retains three interpretive landmark models
and a separate twelve-house design example. It is not a complete Bristol survey.
Most building heights are inferred, no measured terrain is provided, and landmark
geometry is approximate. See `docs/city_format.md` for the conversion rules and sources.
