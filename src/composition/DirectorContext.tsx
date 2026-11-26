import React, { createContext, useContext } from 'react';
import * as THREE from 'three';
import type { SpatialRenderPass } from '../core/spatialStage';

export interface DirectorStageState {
  /** True when mounted inside a CoCraft clip/director context */
  active: boolean;
  /** Whether ThreeCanvas should automatically apply spherical camera overrides (false if component explicitly declares own cameraYaw) */
  applyCameraOverride: boolean;
  cameraYaw: number;
  cameraPitch: number;
  /** Canonical distance multiplier (0.35..3.0, default 1.0) */
  cameraDistance: number;
  cameraPanX: number;
  cameraPanY: number;
  /** Optional 35mm focal length override; undefined preserves component's native FOV */
  cameraLens?: number;
  renderPass: SpatialRenderPass;
  keyLightYaw?: number;
  keyLightTemp?: number;
  /** True only in interactive studio viewport (NEVER during offscreen GPU capture or MP4 export) */
  showStudioGuides?: boolean;
  selectedObjectId?: string | null;
}

export const DEFAULT_DIRECTOR_STAGE_STATE: DirectorStageState = {
  active: false,
  applyCameraOverride: false,
  cameraYaw: 0,
  cameraPitch: 0,
  cameraDistance: 1,
  cameraPanX: 0,
  cameraPanY: 0,
  cameraLens: undefined,
  renderPass: 'beauty',
  showStudioGuides: false,
  selectedObjectId: null,
};

export const DirectorStageContext = createContext<DirectorStageState>(DEFAULT_DIRECTOR_STAGE_STATE);

export function DirectorStageProvider({
  value,
  children,
}: {
  value: DirectorStageState;
  children: React.ReactNode;
}) {
  return <DirectorStageContext.Provider value={value}>{children}</DirectorStageContext.Provider>;
}

/**
 * React hook exposed via `cocraft/director` and `@remotion/three` for custom TSX 3D components
 * that want direct read access to the Director Studio's live camera, lens, lighting, and renderPass.
 */
export function useDirectorStage(): DirectorStageState {
  return useContext(DirectorStageContext);
}

/**
 * Shared ControlNet-convention linear camera-space Depth material:
 * White (1.0) = closest to camera, Black (0.0) = farthest from camera.
 */
export function createDepthPassMaterial(nearDepth = 1.6, farDepth = 12.5): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNear: { value: nearDepth },
      uFar: { value: farDepth },
    },
    vertexShader: /* glsl */ `
      varying float vViewZ;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNear;
      uniform float uFar;
      varying float vViewZ;
      void main() {
        float d = 1.0 - clamp((vViewZ - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(vec3(d), 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

/**
 * Creates the appropriate Three.js scene.overrideMaterial for non-beauty Director render passes.
 */
export function createPassOverrideMaterial(
  pass: SpatialRenderPass,
  nearDepth = 1.6,
  farDepth = 12.5,
): THREE.Material | null {
  if (pass === 'depth') return createDepthPassMaterial(nearDepth, farDepth);
  if (pass === 'normal') return new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  if (pass === 'clay') {
    return new THREE.MeshStandardMaterial({
      color: '#dde2ea',
      roughness: 0.88,
      metalness: 0.04,
    });
  }
  if (pass === 'wireframe') {
    return new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      wireframe: true,
    });
  }
  return null;
}
