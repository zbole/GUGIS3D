from __future__ import annotations

from pathlib import Path


def convert_osm_geojson_to_gugis(input_path: Path, output_path: Path) -> None:
    raise NotImplementedError(
        "Map OSM footprints, roads, and landuse polygons to GugisObject records before writing GUGIS JSON."
    )


if __name__ == "__main__":
    raise SystemExit("Import convert_osm_geojson_to_gugis from a pipeline script.")
