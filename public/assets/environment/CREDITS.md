# Environment assets

The shipped environmental models and surface textures are from [Poly Haven](https://polyhaven.com/), licensed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Poly Haven states that CC0 assets may be used, modified, and redistributed commercially without attribution. Attribution is retained here for traceability.

## Models

| Asset                | Authors                             | Source                                     |
| -------------------- | ----------------------------------- | ------------------------------------------ |
| `boulder_01`         | Rico Cilliers                       | https://polyhaven.com/a/boulder_01         |
| `pine_sapling_small` | Rico Cilliers, Rob Tuytel           | https://polyhaven.com/a/pine_sapling_small |
| `wild_rooibos_bush`  | James Ray Cock, Jenelle van Heerden | https://polyhaven.com/a/wild_rooibos_bush  |
| `street_lamp_01`     | Josh Dean                           | https://polyhaven.com/a/street_lamp_01     |

Each model is downloaded at 1K glTF resolution into the ignored `.asset-cache/environment/` directory, then reduced to `near` and `far` GLB variants with Meshopt and WebP textures. The committed `manifest.json` records output hashes, sizes and triangle counts. The original source files are never served by the application.

## Surface textures

| Material            | Authors / processing              | Source                                    |
| ------------------- | --------------------------------- | ----------------------------------------- |
| `asphalt_02`        | Rob Tuytel                        | https://polyhaven.com/a/asphalt_02        |
| `forest_ground_04`  | Rob Tuytel; Rico Cilliers         | https://polyhaven.com/a/forest_ground_04  |
| `concrete_wall_006` | Dario Barresi; Charlotte Baglioni | https://polyhaven.com/a/concrete_wall_006 |

Colour, OpenGL normal and packed roughness/ambient-occlusion maps are downloaded at 1K, converted to WebP at 1024² / 768² / 512² respectively and stored with `surface-manifest.json`. The runtime maps them to the asphalt, terrain and architectural materials respectively, using the packed map's roughness channel.

## Rebuilding

Run `pnpm assets:environment -- --download` with network access to download the exact files pinned in `sources.json` and `surface-sources.json`, verify their MD5 checksums, and rebuild the committed GLB and WebP files. With the source cache already present, run `pnpm assets:environment`. Output SHA-256 checksums are recorded in the two manifests. Ordinary production builds use the committed files and need no external asset service.

Only one specimen is retained from each model collection. Near / far versions use different simplification and texture resolution budgets. Rocks allow simplification across authored seams. Models are normalized by their original height for placement in metres. None of the source authors endorse this game. The architectural structures, pit building, guardrail geometry and placement code are authored within this project, not Poly Haven models.
