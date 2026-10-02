# Data Pipeline

Current local city tools (run with the repository `.venv` Python):

- `generate_city.py --output city.gugis.json`: rebuild Bristol from retained local source data into City 1.1.
- `refine_city.py input.gugis.json output.gugis.json`: refine footprints, preserving the input; accepts City 1.0 / 1.1.
- `pack_city.py input.gugis.json output.gugis.json`: deduplicate shared geometry, verify a lossless roundtrip, then write City 1.1 to a separate file.
- `generate_building.py`: generate a self-contained Studio building file.

See `docs/city_shared_geometry.md` for archive details. The notes below describe the original MVP tools.

This folder contains lightweight scripts for creating or adapting open city data into the internal GUGIS JSON format used by the MVP.

Current scripts:

- `generate_sample_city.py`: deterministic synthetic Bristol-like sample data.
- `osm_to_gugis.py`: placeholder converter interface for OSM-derived footprints and roads.
- `overture_to_gugis.py`: placeholder converter interface for Overture Maps buildings and transportation data.

The MVP loads `backend/data/sample_gugis_objects.json` by default.
