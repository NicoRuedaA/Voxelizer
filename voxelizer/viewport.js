/* Pure camera geometry and controller helpers shared by the browser and Node tests. */
(function (root) {
  'use strict';

  const CAMERA_MODES = Object.freeze(['perspective', 'front', 'profile', 'top']);
  const DEFAULT_PERSPECTIVE_DIRECTION = Object.freeze([0.5, 0.46, 0.75]);

  function cameraMode(value) {
    if (!CAMERA_MODES.includes(value)) throw new RangeError(`Unsupported camera mode: ${value}`);
    return value;
  }

  function normalizeDimensions(dimensions) {
    if (!Array.isArray(dimensions) || dimensions.length !== 3) throw new TypeError('dimensions must be [width, height, depth]');
    return dimensions.map(value => {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) throw new RangeError('camera dimensions must be finite and positive');
      return number;
    });
  }

  function safeAspect(aspect) {
    const number = Number(aspect);
    if (!Number.isFinite(number) || number <= 0) throw new RangeError('camera aspect must be finite and positive');
    return number;
  }

  function vector(value, label) {
    if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) throw new TypeError(`${label} must expose finite x/y/z`);
    return [value.x, value.y, value.z];
  }

  function normalizeDirection(direction) {
    const values = Array.isArray(direction) && direction.length === 3 ? direction.map(Number) : [...DEFAULT_PERSPECTIVE_DIRECTION];
    const length = Math.hypot(values[0], values[1], values[2]);
    if (!Number.isFinite(length) || length <= 1e-9) return normalizeDirection(DEFAULT_PERSPECTIVE_DIRECTION);
    return values.map(value => value / length);
  }

  function boundingSphere(dimensions) {
    const [x, y, z] = normalizeDimensions(dimensions);
    return { center: [0, 0, 0], radius: Math.hypot(x, y, z) / 2 };
  }

  function perspectiveFitDistance(dimensions, fovDegrees, aspect, margin = 1.15) {
    const radius = boundingSphere(dimensions).radius;
    const vertical = Number(fovDegrees) * Math.PI / 180;
    if (!Number.isFinite(vertical) || vertical <= 0 || vertical >= Math.PI) throw new RangeError('perspective FOV must be between 0 and 180 degrees');
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * safeAspect(aspect));
    const limitingHalfFov = Math.min(vertical, horizontal) / 2;
    const safeMargin = Number.isFinite(margin) && margin >= 1 ? margin : 1.15;
    return radius * safeMargin / Math.sin(limitingHalfFov);
  }

  function cameraClipPlanes(position, target, dimensions, padding = 1.25) {
    const pos = Array.isArray(position) ? position : vector(position, 'camera position');
    const aim = Array.isArray(target) ? target : vector(target, 'camera target');
    const distance = Math.hypot(pos[0] - aim[0], pos[1] - aim[1], pos[2] - aim[2]);
    const radius = boundingSphere(dimensions).radius;
    const safePadding = Number.isFinite(padding) && padding >= 1 ? padding : 1.25;
    const paddedRadius = Math.max(1, radius * safePadding);
    const near = Math.max(0.01, distance - paddedRadius);
    const far = Math.max(near + 1, distance + paddedRadius);
    return { near, far };
  }

  function orthographicPose(mode, dimensions) {
    const selected = cameraMode(mode);
    if (selected === 'perspective') throw new RangeError('Perspective mode does not have an orthographic pose');
    const radius = boundingSphere(dimensions).radius;
    const distance = Math.max(2, radius * 2.5);
    if (selected === 'front') return { mode: selected, position: [0, 0, distance], up: [0, 1, 0], target: [0, 0, 0] };
    if (selected === 'profile') return { mode: selected, position: [-distance, 0, 0], up: [0, 1, 0], target: [0, 0, 0] };
    return { mode: selected, position: [0, distance, 0], up: [0, 0, -1], target: [0, 0, 0] };
  }

  function perspectivePose(dimensions, fovDegrees, aspect, direction) {
    const unit = normalizeDirection(direction);
    const distance = perspectiveFitDistance(dimensions, fovDegrees, aspect);
    return {
      mode: 'perspective',
      position: unit.map(value => value * distance),
      up: [0, 1, 0],
      target: [0, 0, 0],
    };
  }

  function orthographicFrustum(mode, dimensions, aspect, margin = 1.15) {
    const selected = cameraMode(mode);
    if (selected === 'perspective') throw new RangeError('Perspective mode does not have an orthographic frustum');
    const [x, y, z] = normalizeDimensions(dimensions);
    const ratio = safeAspect(aspect);
    const safeMargin = Number.isFinite(margin) && margin >= 1 ? margin : 1.15;
    let contentWidth = x, contentHeight = y;
    if (selected === 'profile') contentWidth = z;
    else if (selected === 'top') contentHeight = z;
    const halfHeight = Math.max(contentHeight / 2, contentWidth / (2 * ratio)) * safeMargin;
    const halfWidth = halfHeight * ratio;
    return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight };
  }

  function dimensionsMateriallyChanged(previous, next, relativeThreshold = 0.05) {
    const before = normalizeDimensions(previous), after = normalizeDimensions(next);
    return before.some((value, index) => Math.abs(after[index] - value) > Math.max(0.5, value * relativeThreshold));
  }

  function createCameraController(options) {
    const perspectiveCamera = options && options.perspectiveCamera;
    const orthographicCamera = options && options.orthographicCamera;
    const controls = options && options.controls;
    if (!perspectiveCamera || !orthographicCamera || !controls) throw new TypeError('camera controller requires both cameras and OrbitControls');
    let dimensions = normalizeDimensions(options.dimensions || [1, 1, 1]);
    let aspect = safeAspect(options.aspect || 1);
    let mode = 'perspective';
    let autoRotatePreference = options.autoRotate !== false;
    let activeCamera = perspectiveCamera;

    function applyPose(camera, pose) {
      camera.position.set(...pose.position);
      camera.up.set(...pose.up);
      controls.target.set(...pose.target);
      camera.lookAt(controls.target);
    }

    function updateClip(camera) {
      const clip = cameraClipPlanes(camera.position, controls.target, dimensions);
      camera.near = clip.near;
      camera.far = clip.far;
      return clip;
    }

    function fitPerspective(resetOrientation) {
      perspectiveCamera.aspect = aspect;
      let direction = DEFAULT_PERSPECTIVE_DIRECTION;
      if (!resetOrientation) {
        const position = vector(perspectiveCamera.position, 'perspective position');
        const target = vector(controls.target, 'camera target');
        direction = position.map((value, index) => value - target[index]);
      }
      const pose = perspectivePose(dimensions, perspectiveCamera.fov, aspect, direction);
      applyPose(perspectiveCamera, pose);
      updateClip(perspectiveCamera);
      perspectiveCamera.updateProjectionMatrix();
    }

    function fitOrthographic(resetZoom) {
      const pose = orthographicPose(mode, dimensions);
      applyPose(orthographicCamera, pose);
      Object.assign(orthographicCamera, orthographicFrustum(mode, dimensions, aspect));
      if (resetZoom) orthographicCamera.zoom = 1;
      updateClip(orthographicCamera);
      orthographicCamera.updateProjectionMatrix();
    }

    function applyControlPolicy() {
      const perspective = mode === 'perspective';
      activeCamera = perspective ? perspectiveCamera : orthographicCamera;
      controls.object = activeCamera;
      controls.enableRotate = perspective;
      controls.enablePan = perspective;
      controls.enableZoom = true;
      controls.autoRotate = perspective && autoRotatePreference;
    }

    function setMode(nextMode) {
      const selected = cameraMode(nextMode);
      if (selected === mode) return activeCamera;
      mode = selected;
      applyControlPolicy();
      if (mode === 'perspective') {
        perspectiveCamera.aspect = aspect;
        updateClip(perspectiveCamera);
        perspectiveCamera.updateProjectionMatrix();
      } else {
        fitOrthographic(true);
      }
      controls.update();
      return activeCamera;
    }

    function reset() {
      if (mode === 'perspective') {
        perspectiveCamera.zoom = 1;
        fitPerspective(true);
      } else {
        fitOrthographic(true);
      }
      controls.update();
      return activeCamera;
    }

    function resize(nextAspect) {
      aspect = safeAspect(nextAspect);
      perspectiveCamera.aspect = aspect;
      if (mode === 'perspective') fitPerspective(false);
      else fitOrthographic(false);
      controls.update();
    }

    function setDimensions(nextDimensions) {
      const normalized = normalizeDimensions(nextDimensions);
      const changed = dimensionsMateriallyChanged(dimensions, normalized);
      dimensions = normalized;
      if (mode === 'perspective') {
        if (changed) fitPerspective(true);
        else {
          updateClip(perspectiveCamera);
          perspectiveCamera.updateProjectionMatrix();
        }
      } else {
        fitOrthographic(false);
      }
      controls.update();
      return changed;
    }

    function setAutoRotate(enabled) {
      autoRotatePreference = !!enabled;
      controls.autoRotate = mode === 'perspective' && autoRotatePreference;
      return autoRotatePreference;
    }

    applyControlPolicy();
    reset();

    return {
      reset,
      resize,
      setAutoRotate,
      setDimensions,
      setMode,
      get activeCamera() { return activeCamera; },
      get aspect() { return aspect; },
      get autoRotatePreference() { return autoRotatePreference; },
      get dimensions() { return [...dimensions]; },
      get mode() { return mode; },
    };
  }

  root.VoxelViewport = {
    CAMERA_MODES,
    boundingSphere,
    cameraClipPlanes,
    cameraMode,
    createCameraController,
    dimensionsMateriallyChanged,
    normalizeDimensions,
    orthographicFrustum,
    orthographicPose,
    perspectiveFitDistance,
    perspectivePose,
  };
})(typeof window !== 'undefined' ? window : globalThis);
