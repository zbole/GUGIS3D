# Shareable camera-view links

Read-only tile mode offers **复制当前视角链接**. It copies the app address with
an allowlisted city/group, tile mode and a versioned camera fragment. If clipboard
access is unavailable, a selectable field shows the same link for manual copying.
The action does not upload or distribute geometry, grant access, save a project,
change the browser history or continuously record camera movement.

The recipient needs the same app and a matching available render package. A
`localhost` link points to the recipient's own computer; it does not make the
sender's computer or data accessible.

## Exact scope

The fragment contains only:

- Format version 1
- One of the three existing workspace IDs
- The full SHA-256 revision of the verified source snapshot
- Camera longitude, latitude, height, heading, pitch and roll

Camera coordinates are in the fragment rather than the HTTP query. Generated
links retain the current origin/path and allowlisted city/group/mode fields only.
Unrelated query parameters and fragments are excluded, including source paths,
API addresses, search text, object names, selection and pause settings. URLs with
credentials or unsupported schemes are rejected. The absolute link and fragment
are bounded to 512 characters; the parser rejects unknown/duplicate fields,
percent-encoding tricks, unsupported versions and non-decimal/nonfinite values.

Longitude is limited to ±180°, latitude to ±85°, camera height to 2–100,000 m,
pitch to ±90°, and incoming heading/roll to ±360° before angle normalization.
Out-of-range input is rejected rather than silently clamped. Encoding rounds
height to 0.001 m and degree values to seven decimals for stable camera replay;
these are serialization limits, not claims of survey accuracy.

## Restoration and streaming

The scene cancels an existing camera flight and applies the accepted pose before
its first normal framing operation. Initial tile reads wait for the actual
restored window's ellipsoid viewport, avoiding an unrelated city-centre tile
burst. Later tile arrivals preserve that camera. A newer accepted history/hash
navigation cancels obsolete viewport reporting and restores the newer pose.
Both same-city and cross-city navigation are handled explicitly.

Default navigation is a distinct **target-centred** request derived from the
verified package footprint. Cesium computes the camera's offset/range using the
real viewport frustum, then the scene restores its world-coordinate transform.
The city target must not be used as the camera position while applying an oblique
view angle: that would point past the sample and can leave Bristol with no
intersecting tiles on landscape screens. Explicit bookmark poses remain exact
camera positions and are not converted into target requests.

Capture requires a finite ellipsoid footprint. A restored pose with no finite
footprint is not used to start automatic tile acquisition; the UI asks the
viewer to adjust or choose the current default view. The receiver computes its
own bounds because its viewport shape may differ. A saved bounding box is never
treated as an authoritative footprint or city boundary.

Manual and hidden-page pauses remain effective during restoration. Navigation
updates the desired camera without lifting pause or increasing the existing
tile/byte/cache/concurrency limits. City/mode/home transitions remove owned
camera fragments; rejected navigation during editor writes cannot retain an
incoming camera link.

## A view link is not historical data replay

The current API serves only the active manifest. The link's expected revision
must match that verified manifest. A mismatch shows the linked/current revisions
and requires an explicit **使用当前默认视角** choice. It does not retrieve an old
manifest, silently substitute a different snapshot or claim that old geometry
has been reopened.

## Verification

Codec, scene and component tests cover malformed links, sanitization, initial and
later restoration, stale requests, same-city Back/Forward/hash events, busy-editor
guards, mismatch/default behavior, selection-pin clearing, pause and clipboard
failure. Scene tests use real Cesium geometry with a GPU-free viewer double.
Actual browser/WebGL interaction remains a separate acceptance step.

Default-framing regressions additionally use real Cesium Camera projection/math
against the retained three-city manifest fixtures, for both loading profiles at
1040×500, 800×500, 1400×400 and 390×700. All 24 cases must intersect sample tiles,
select a nonempty budget-bounded set and aim the centre ray at the target. The
0.01 m test tolerance measures numerical camera/ellipsoid agreement, not survey
accuracy. Component tests derive their default footprints from the same real
camera math for ordinary entry, city switching and explicit default recovery.
