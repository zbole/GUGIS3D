from __future__ import annotations

from pathlib import Path


def convert_overture_parquet_to_gugis(input_path: Path, output_path: Path) -> None:
    raise NotImplementedError(
        "Map Overture buildings, places, and transportation tables to the GUGIS object model."
    )


if __name__ == "__main__":
    raise SystemExit("Import convert_overture_parquet_to_gugis from a pipeline script.")
