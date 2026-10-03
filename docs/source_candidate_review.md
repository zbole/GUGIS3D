# Reviewing corrected source candidates

The original supplied London and Birmingham seeds are retained. The separate
version 2 candidates were generated from the same retained OSM snapshots and
are not active projects. A read-only comparison is useful even when a user's
current project contains edits, but it must always compare the **supplied seed**
with the **candidate**, not pretend to compare arbitrary current project content.

## What actually changed

- London: 823 → 814 buildings, with 762 roads in both versions. Retained object
  `osm951721975` changes from a modeled 9.6 m to its source tag's 0.5 m
- Birmingham: 809 → 804 buildings, with 479 roads in both versions. Retained
  object `osm1436375109` (The Octagon) changes from a modeled 9.6 m to its source
  tag's 155 m
- No building IDs are added. Retained placements, parameters and roads are
  unchanged. Changes in pooled geometry identifiers alone are not geometry
  changes; comparisons resolve the referenced geometry
- Nine London objects and five Birmingham objects are omitted because their
  building-part or elevated-base semantics are unsupported by this importer
- London's import receipt lists eleven total omissions. Two complex footprints
  were already absent from the original seed; they are not new removals
- Clearer missing-height assumption text affects 470 retained London objects
  and 623 retained Birmingham objects. This is a metadata change, not a claim
  that their geometry or height became measured

London `osm1149973649` also has a 0.5 m tag, but is an unsupported building part
and is omitted. It is not the retained low-height correction above. Each omitted
OSM way and its reason are recorded in the candidate's import receipt.

### Why the two pre-existing complex outlines stay omitted

The retained source identifies way `364313092` as Westminster Abbey and leaves
way `367642706` unnamed. Removing only repeated closure coordinates leaves
546 and 159 distinct source vertices. Read-only diagnostics found both rings
triangulatable without inventing points or simplifying their boundaries, within
the existing local projection/rounding convention.

Their full closed extrusions would require 1,092 vertices / 2,180 triangles and
318 vertices / 632 triangles respectively. Both exceed the existing per-mesh
format limits of 256 vertices / 512 triangles. Increasing only the converter's
120-point cap would therefore fail later validation, rather than recover valid
imports. The current redundant-point cleanup reduces the Abbey to 539 ring
points, which still exceeds those limits after extrusion.

This investigation created no candidate or render package and changed no format
limits. A future capacity change needs coordinated importer/schema/resource
budgets, exact-boundary and round-trip tests, and visual/resource acceptance.
The retained ways contain no holes, but the snapshot omits multipolygon
relations, so they do not establish whether the complete real buildings have
courtyards or other unrepresented parts. London v2 remains 814 buildings with
eleven recorded source omissions.

Both versions remain local district samples. Query rectangles and actual imported
extents are distinct, and neither establishes an authoritative city boundary or
complete coverage. No surveyed DEM is supplied. Heights obtained from source
tags are not independently measured by this application.

## Keep the user's project separate

The existing city import workflow stages an entire replacement document. A
candidate file is not a correction-only patch. Committing a whole-city candidate
can remove custom buildings, source-object edits, roads, terrain, function
features and saved analysis metadata absent from the candidate.

Review/download does not create a draft or activate a candidate. Any manual
whole-city import needs its own review in the existing draft workflow. Export or
otherwise retain a recoverable copy before intentionally replacing a project.
Stable OSM IDs alone do not prove that a current object remains unchanged; a safe
future merge would need explicit conflict detection against a known baseline.

The panel can compare an already-read city catalogue revision with the exact
baseline and candidate hashes. That is a relation to the catalogue entry, not an
atomic check of a live project or an assessment of unsaved edits. Missing or
untrustworthy revision information stays unknown. A different revision is not
classified as safe to replace.

## Distribution and integrity

The initial city-selection page has a collapsed review panel. Opening it makes
one bounded, read-only candidate-catalogue request for the chosen city. Closing
or switching cities cancels that request; stale replies cannot supply another
city's report or download links. Expanding the panel does not read a full city
model, initialize a workspace or change its draft/history. File downloads occur
only through explicit download links.

The source, original seed, candidate and import receipt are identified by exact
SHA-256 hashes. Downloads retain candidate bytes, import receipts, the comparison
and provenance/licence notices. All file choices are fixed supported city/version
entries; clients cannot specify server paths or remote source URLs. Corruption or
mismatched evidence fails closed instead of falling back to an unrelated file.

The catalogue and download routes are separate from editable workspace routes:
`GET /cities/{city_id}/source-candidates` and fixed version/hash/kind download
paths. Bristol has no registered candidate and returns an empty catalogue;
unknown IDs have no fallback. Summary reads are capped at 256 KiB in the client,
and exact response bytes must match the strong SHA-256 ETag before display.

Server reads check fixed paths, regular files, symlinks/reparse points, sizes,
descriptor identity and before/after metadata, then rehash the exact pinned
bytes. Strong hashes remain required even when metadata is unchanged. The ZIP
uses deterministic stored members, carries source/receipt/licence evidence and
does not retain expanded geometry in a server cache. The portable file checks
are implemented for Windows as well as POSIX; actual Windows acceptance has not
been performed in this cloud environment.

© OpenStreetMap contributors. Candidate databases are distributed under
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), with
[OpenStreetMap attribution](https://www.openstreetmap.org/copyright).
Keep the source/report provenance and licence notices with redistributed data.
The application code has its own licence.

See [source validation and limitations](city_source_validation.md) and the
[candidate README](../backend/data/cities/candidates/v2/README.md) for the source
snapshot, reproducible offline conversion and original retained-version warnings.
