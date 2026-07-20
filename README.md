# Voxelizer v0.5 — Professional 2D to 3D Voxel Converter

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-91%2F91%20passing-brightgreen)](tests/voxelizer.test.js)
[![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)](CHANGELOG.md)

An advanced, robust, and predictable tool for converting 2D pixel art into high-quality 3D voxel models, designed for artists and game developers.

![Voxelizer UI](https://i.imgur.com/gKzB5qL.png)

## ✨ What is Voxelizer?

Voxelizer takes your 2D sprites and intelligently extrudes them into 3D voxel models suitable for use in games, art, and prototyping. It goes beyond simple extrusion by incorporating advanced camera controls, robust error handling, and powerful mesh optimization, ensuring your creations look great from every angle without performance bottlenecks.

This version represents a significant leap in stability and professional-grade features over the original proof-of-concept.

## 🚀 Features

*   **Full Orthographic Camera Suite**: Flawless `Front`, `Profile`, and `Top` views with corrected camera frustums that prevent model clipping, even on extreme dimensions (e.g., 1x1x256).
*   **Advanced Depth Control**: An intelligent "Match Profile" depth policy that provides more intuitive and predictable results when working with side-view references.
*   **Robust Processing Engine**: The voxelization engine is protected against common failure modes. A bounded worker fallback prevents UI freezes on large models, and pre-flight budget checks on VOX exports prevent memory-related crashes.
*   **High-Performance Greedy Meshing**: Drastically reduces the final polygon count (often by >80%) by merging adjacent, co-planar faces into single, large polygons, ensuring excellent performance in any game engine.
*   **Palette Quantization & Control**: Intelligently derives a color palette from your source image and allows you to set a maximum color count for full artistic control.
*   **Standard Export Formats**: Exports to industry-standard `.vox` for Magicavoxel and `.obj + .mtl` for universal compatibility with engines like Unity, Unreal, and Godot.

## 🛠️ How It Works: Under the Hood

Voxelizer follows a sophisticated pipeline to ensure high-quality results:

1.  **Alpha Thresholding**: First, the 2D image is converted into a binary mask based on the alpha (transparency) value of each pixel.
2.  **Volume Extrusion**: This mask is then extruded along the Z-axis to create the initial, dense cloud of voxels.
3.  **Greedy Meshing**: This is the secret sauce. The algorithm sweeps through the voxel cloud and merges adjacent faces into large, optimized polygons, dramatically reducing geometric complexity.
4.  **Camera Projection**: The 3D model is rendered to the screen using precise **Model-View-Projection** matrix transformations. Our remediation work ensures the orthographic projection parameters are mathematically sound, providing a stable, what-you-see-is-what-you-get experience.
5.  **Quality Assured**: The entire core logic is backed by a suite of **91 regression tests**, ensuring every feature, from camera controls to memory budgeting, is stable and predictable.

## 👨‍💻 Development

This project is developed using **Spec-Driven Development (SDD)** to ensure that every feature is well-planned, documented, and robustly implemented.

*   To run the test suite:
    ```bash
    node --test --test-reporter=spec tests/voxelizer.test.js
    ```
*   To run syntax checks on all scripts:
    ```bash
    for file in voxelizer/*.js; do node --check "$file"; done
    ```

---

## 📜 Changelog

### `v0.5.0` - Orthographic & Robustness Remediation (Current)

This release marks a major overhaul of the core engine, focusing on stability, predictability, and professional-grade camera controls. All changes were implemented via a strict Test-Driven Development (TDD) cycle.

#### ✨ Added

*   **Full Orthographic Camera Suite**: Introduced `Front`, `Profile`, and `Top` camera modes with mathematically correct frustum clipping, completely eliminating model cutoff issues.
*   **Advanced "Match Profile" Depth Policy**: Provides more intuitive and accurate depth results when a side-view reference is used for profile matching.
*   **Bounded Worker Fallback**: The UI will no longer freeze if the voxelization worker process fails. Large jobs that would cause instability are now safely rejected.
*   **Pre-flight VOX Export Budgeting**: The application now checks memory requirements *before* allocating memory for a VOX export, preventing crashes on large models.
*   **Comprehensive Regression Test Suite**: A suite of **91 passing tests** has been established to lock in the behavior of all core features and prevent future regressions.

#### ⚙️ Changed

*   Updated UI documentation (`README.md`, `PLAN_GENERACION_3D.md`) to reflect the new camera controls and depth policies.
*   The internal camera controller logic was refactored to support seamless switching between perspective and orthographic modes without losing user preferences (e.g., auto-rotate).

### `v0.4.0` - Initial Public Version

*   Core functionality: 2D image to 3D model via extrusion.
*   Features: Greedy Meshing, palette quantization, and OBJ/VOX export.
