# Voxelizer — Professional Voxel Generator

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL%202.0-orange.svg)](https://opensource.org/licenses/MPL-2.0)
[![Tests](https://img.shields.io/badge/tests-205%2F205%20passing-brightgreen)](tests/voxelizer.test.js)
[![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)](CHANGELOG.md)

An advanced, robust, and usefull for converting 2D pixel art into high-quality 3D voxel models. Designed for and by game developers.

![Voxelizer UI](https://github.com/NicoRuedaA/Voxelizer/blob/main/assets/image.webp)

## What is Voxelizer?

Voxelizer takes your 2D sprites and intelligently extrudes them into 3D voxel models for use directly in your projects. 

It goes beyond simple extrusion: Voxelizer incorporates advanced camera controls, robust error handling, and powerful mesh optimization, ensuring your creations look faithful to your designs. 

No generative AI. No hallucinations. Only mathematics and advanced algorithms.

## Features

- Single-image and multi-view voxel reconstruction
- Front, back, side and top reference views
- Greedy mesh optimization
- Palette editing and material configuration
- Perspective and orthographic previews
- VOX, OBJ/MTL, GLB and FBX export
- Web Worker processing with bounded memory budgets
- Automated regression tests

## How It Works


1.  **Alpha Thresholding**: First, the 2D image is converted into a binary mask based on the alpha (transparency) value of each pixel.
2.  **Volume Extrusion**: This mask is then extruded along the Z-axis to create the initial, dense cloud of voxels.
3.  **Greedy Meshing**: This is the secret sauce. The algorithm sweeps through the voxel cloud and merges adjacent faces into large, optimized polygons, dramatically reducing geometric complexity.
4.  **Camera Projection**: The 3D model is rendered to the screen using precise Model-View-Projection matrix transformations. The orthographic projection parameters are mathematically sound, providing a stable, true-to-design, what-you-see-is-what-you-get experience.
5.  **Quality Assured**: The entire core logic is backed by a suite of **205 regression tests**, ensuring every feature, from camera controls to memory budgeting, is stable and predictable.

## Quick Start

Zero setup required. Just clone the repository and open index.html directly in your browser.

##  Development

This project is developed using **Spec-Driven Development (SDD)** to ensure that every feature is well-planned, documented, and robustly implemented.

*   To run the test suite:
    ```bash
    npm test
    # or with detailed output:
    npm run test:spec
    ```
*   To run syntax checks on all scripts:
    ```bash
    npm run check
    ```

---

## Changelog

Voxelizer is actively maintained with strict TDD. For a detailed breakdown of all features, technical architecture changes, and patch notes, see [CHANGELOG.md](CHANGELOG.md) or check the [GitHub Releases](https://github.com/NicoRuedaA/Voxelizer/releases) page.

**Current Release: v0.5.0** — Major overhaul of the core engine focusing on stability, predictability, and professional-grade camera controls. Includes full orthographic camera suite, pre-flight VOX export memory budgeting, and advanced multi-view inference.
