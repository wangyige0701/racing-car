# Car Concept — asset attribution

Model and textures: **Eric Chadwick, Darmstadt Graphics Group GmbH, © 2024**.

License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
The complete license is included in `CC-BY-4.0.txt`.

Source: [KhronosGroup/glTF-Sample-Assets — CarConcept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept).
Original GLB: https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb
Retrieved: 2026-11-13. Source SHA-256: `c272098089d78c5cd9fd9f24ff50ee8acf8d932c55f2d55fc10adb6c8998966b`.

The upstream asset derives from a CC0 concept vehicle by Unity Fan; see the included upstream `SOURCE.md` for authoring provenance.

Modifications for this project:

- Converted the source centre-steering layout into a left-hand-drive layout by moving the complete steering / dashboard / pedal assembly.
- Deduplicated and simplified geometry, removed unused material variants, and applied Meshopt compression. Preserved named animation nodes and PBR textures.
- Runtime changes: lime / charcoal paint, glass tuning, independent suspension / wheel / steering animations, brake-light emission, and a live instrument screen.
- Normalized model scale and wheel alignment to the game's chassis; camera anchors were adjusted to the left seat.

The resulting asset is `car.glb`; `asset.json` records its exact size, triangle count and checksum. Rebuild using `scripts/prepare-vehicle.mjs` from the verified original download. This is an adapted concept model, not a manufacturer-endorsed vehicle.

Khronos and 3D Commerce logos remain within the original model textures. They are trademarks of the Khronos Group, not project branding. Their use in the source model is governed by the included `Khronos-marks.txt`; no endorsement is implied.

Smoke textures and synthesized audio are created by this project's code and do not use third-party recordings.
