# UK city readiness registry

`GET /coverage/uk-cities` is a read-only readiness inventory. It does not import
buildings, create workspaces, register render routes, or certify city coverage.
The existing `/cities` catalogue and its Bristol, London and Birmingham
workspaces are unchanged.

## Membership and source

The checked-in `backend/data/uk-city-registry.json` records the 76 United Kingdom
entries on the Cabinet Office [List of cities (HTML)](https://www.gov.uk/government/publications/list-of-cities/list-of-cities-html):
55 England, 6 Northern Ireland, 8 Scotland and 7 Wales. The page was published
29 August 2022 and this snapshot was verified 3 October 2026. Crown Dependencies
and Overseas Territories are deliberately excluded. No boundary geometry is
included, and membership is not a statement about the completeness of any GIS
dataset.

Contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Source: Cabinet Office, *List of cities (HTML)*, © Crown copyright 2022.

The source warns that its Platinum Jubilee Civic Honours Competition approvals
may include awards not yet formally conferred at publication. This membership
snapshot does not independently verify conferral. Separately, source asterisks
indicate cities also awarded a Lord Mayoralty or Lord Provostship; these are
retained as `source_annotation`, not used as part of a city's name or as evidence
of a boundary.

Source spellings are retained in `source_name` and `display_name`, including
London, Westminster, Londonderry, Brighton & Hove, Kingston-upon-Hull,
Newcastle-upon-Tyne and Stoke on Trent. Convenience aliases are separate.
Identifiers are country-qualified, such as `uk-eng-bristol`, `uk-nir-bangor` and
`uk-wls-bangor`. The two Bangors are distinct. Names and aliases are not accepted
as identifiers by the registry helper.

## Response contract

The response schema is `gugis-uk-readiness-v1`, with:

- `summary.registered_cities`: number of national membership records, currently 76
- `summary.sample_workspaces`: number of configured legacy sample workspaces, 3
- `summary.available_sample_workspaces`: number of those sample archives with
  validated building data currently available; missing/invalid sources reduce
  this number, not the registered city count
- `summary.coverage_assessment`: always `not-assessed` in this implementation
- `source`: membership provenance, dates, licence, scope and conferral caveat
- `country_counts`: counts keyed by England, Northern Ireland, Scotland and Wales
- `samples`: separate, bounded read-only summaries of the three existing workspaces
- `cities`: registry identities plus separate sample, boundary, import and coverage states

Each `cities` entry contains the registry fields `id`, `source_name`,
`display_name`, `country`, `country_code`, `aliases` and `source_annotation`.
`country_code` is one of `ENG`, `NIR`, `SCT`, `WLS`.

The additional state fields are:

```json
{
  "sample": {
    "state": "none",
    "workspace_ids": [],
    "boundary_membership_verified": false
  },
  "boundary": {"state": "not-recorded", "receipt": null},
  "import": {"state": "not-imported", "scope": "full-boundary"},
  "coverage": {"state": "not-assessed"}
}
```

`sample.state` can instead be `available`, `missing`, `invalid` or `unavailable`
when a legacy workspace is associated by name. `missing` means no populated
sample is available, including a valid empty archive; `unavailable` means the
optional summary could not be read. Counts and revision are null for invalid or
unavailable archives because their contents are not established. Failures are
isolated per workspace.

Each root `samples` entry contains `workspace_id`, `display_name`, `status`,
`building_count`, `road_count`, `data_revision`, `related_city_id`,
`boundary_membership_verified` and `association_note`. Object counts describe
sample contents only. They are never counts within a verified city boundary.
The service uses the existing cached `workspace_entry` summaries and does not
call the current-project initializer or silently fall back from corrupt current
projects to seed data.

Bristol and Birmingham samples have name-based associations with their registry
records, without verified polygon membership. The legacy `london` workspace is
a Westminster / Whitehall sample and is associated with the Westminster record
with the same explicit warning. The official London record has no claimed
matching sample. A label, query rectangle, building extent or receipt does not
prove the sample lies inside any official boundary.

There is no percentage or completed flag. Three sample workspaces divided by 76
membership records is not a coverage measure. The `full-boundary` import scope
also means `not-imported` does not deny that sample buildings were previously
imported.

## Optional local boundary receipts

The conventional optional location is
`.local/coverage/boundaries/{country-qualified-city-id}.json`. Missing receipts
leave `boundary.state` at `not-recorded`. The API creates neither this directory
nor receipts. It considers only known registry identifiers, rejects symlink
receipts and symlinked parent directories, bounds each read, and uses `boundary_receipts.validate_receipt` for
schema, identity and integrity validation. File reads use no-follow directory
descriptors on supported platforms, reject non-regular files without waiting
on pipes, and fail closed when those safety primitives are unavailable. Missing
receipts still return `not-recorded` on those platforms. A present receipt on an
unsupported platform returns `validation-failed` with
`reason_code: unsupported-platform`, meaning it was not checked on that platform,
not that its geometry was found invalid. It does not follow source paths or
URLs from receipt metadata.

A valid receipt changes only `boundary.state` to `receipt-recorded`. Its public
summary is restricted to `schema`, `city_id`, `checksum_sha256`, `source_sha256`,
`geometry_sha256`, `validation_level`, `topology` and `city_boundary_authority`.
Arbitrary provenance metadata, local paths and geometry are not echoed. A
malformed, mismatched, oversized, non-regular or unreadable file produces
`validation-failed` for that city and does not break other records.

A receipt documents structure/integrity checks on an explicitly supplied local
GeoJSON. It retains `topology: not_checked` and
`city_boundary_authority: not_verified`. It is not authentication of a
publisher, independent boundary authority review, source freshness verification,
automatic activation, an import, or an assessment of building coverage.
`coverage.state` remains `not-assessed` even with a valid receipt. See the
[boundary preparation tooling documentation](city_boundary_receipts.md) for
the explicit local-only receipt workflow and its limitations.

Before nationwide coverage could be assessed, each city's appropriate boundary
needs an independently justified identity/definition and dated source, topology
checks, lawful building/height/terrain inputs, a reproducible bounded import,
and a defined completeness/quality assessment. The registry intentionally does
not fabricate those prerequisites or substitute rectangles for boundaries.

## Verification

From the repository root:

```sh
PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/tests -p 'test_uk_city_registry.py'
PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/tests
```

Focused tests cover membership, names/aliases/annotations, duplicate city names,
source exclusions and provenance, unchanged three-workspace routes, byte-for-byte
source preservation, no project initialization, sample failures, bounded receipt
failure isolation and non-coverage claims. Receipt checker tests use synthetic
polygons only, not actual city boundaries.
