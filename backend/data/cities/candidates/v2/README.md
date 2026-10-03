# Version 2 city candidates: review before replacement

These are **non-active candidate datasets**, generated offline from the exact
retained OpenStreetMap sources. They do not replace the existing seeds or any
user workspace. The application does not load this directory automatically.

| Candidate | Buildings / roads | Height tag / levels estimate / assumed | Omitted buildings |
|---|---:|---:|---:|
| London | 814 / 762 | 17 / 327 / 470 | 11 |
| Birmingham | 804 / 479 | 48 / 133 / 623 | 5 |

Valid LoD1 source heights in 0.1–1000 m are preserved, including The Octagon's
155 m source tag and London way 951721975's 0.5 m tag. These tags are not
independent survey evidence. Building parts, nonzero/unsupported base heights
or starting floors are explicitly omitted instead of rendered as ground-based
whole buildings. London also omits the same two complex footprints as the
original importer. Every omitted source way and reason is in the companion
`*-import.json` report. Missing height and floor tags still use a labelled
9.6 m display assumption. No terrain, facade or interior survey is provided.

Source SHA-256 (existing files two directories above):

- London: `5db34df2aa145ee5a5f5f4afc47e3b565d704c7d8f924d89d8a9341499ad942a`
- Birmingham: `6aa13a5ed45e46a1b78e26aecff41b3d0d265ce3ac8eaf6d9dd676321ea50731`

Candidate SHA-256:

- London: `c90ce92a672eb07e7fea5504132378c521d863b12e081b69cb8843b34f835933`
- Birmingham: `b139689a5423c4a950c2d761a9b2356d0fc03ed208b72eb7b4477090da036c7f`

OSM snapshot: `2026-10-03T04:31:51Z`. Query windows and actual imported extents
are in the reports. These remain central-district samples, not whole cities.

## Licence and review

© OpenStreetMap contributors. These derived databases are distributed under
the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Attribution: https://www.openstreetmap.org/copyright . Keep these notices and
the source/report provenance with redistributed candidate datasets.
The application code has a separate licence.

To review, import the appropriate candidate into that city's workspace as a
draft, inspect the omitted features and changed heights, then explicitly decide
whether to commit or discard the draft. Existing work should be exported or
otherwise recoverable before intentionally replacing a whole city. Merely
creating these candidate files does not apply them.

Rebuild to a new output directory from repository root:

```sh
PYTHONPATH=backend .venv/bin/python data-pipeline/import_city_samples.py \
  --city all --output-dir .local/rebuilt-city-candidates-v2
```

See [source validation](../../../../../docs/city_source_validation.md) for the
unchanged original-version warnings and the national coverage limitations.
