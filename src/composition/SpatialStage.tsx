import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { SPZLoader } from 'three/examples/jsm/loaders/SPZLoader.js';
import { SPLATLoader } from 'three/examples/jsm/loaders/SPLATLoader.js';
import { KSPLATLoader } from 'three/examples/jsm/loaders/KSPLATLoader.js';
import { GaussianSplatPLYLoader } from 'three/examples/jsm/loaders/GaussianSplatPLYLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  computeActorPathState,
  computeParallaxLayerLayout,
  computeSpatialCameraPose,
  isSplatAssetPath,
  kelvinToHex,
  type SpatialActorAction,
  type SpatialActorPath,
  type SpatialBlockingPose,
  type SpatialCameraBookmark,
  type SpatialDeviceType,
  type SpatialEnvironmentPreset,
  type SpatialLookPreset,
  type SpatialParticles3D,
  type SpatialRenderPass,
  type SpatialStageObject,
} from '../core/spatialStage';
import { createDepthPassMaterial } from './DirectorContext';
import { buildProceduralScene, type LightingPreset } from './ThreeStage';

export type ResolvedSpatialStageObject = SpatialStageObject & { assetUrl?: string };

export interface SpatialStageProps {
  title?: string;
  subtitle?: string;
  sceneType?: string;
  lightingPreset?: string;
  keyLightYaw?: number;
  keyLightTemp?: number;
  lookPreset?: string;
  renderPass?: string;
  cameraPreset?: string;
  cameraLens?: number;
  cameraYaw?: number;
  cameraPitch?: number;
  cameraDistance?: number;
  cameraPanX?: number;
  cameraPanY?: number;
  explode?: number;
  speed?: number;
  animateExplode?: boolean;
  particles3D?: string;
  depthStrength?: number;
  depthSpread?: number;
  dofStrength?: number;
  bloomStrength?: number;
  animationIndex?: number;
  blockingPose?: string;
  actorAction?: string;
  actorPath?: string;
  environmentPreset?: string;
  actorStartX?: number;
  actorStartZ?: number;
  actorEndX?: number;
  actorEndZ?: number;
  durationSec?: number;
  deviceType?: string;
  showHud?: boolean;
  focusLabel?: string;
  accent?: string;
  secondary?: string;
  surface?: string;
  /** Optional single .glb/.gltf or .spz/.splat/.ksplat/.ply asset URL */
  modelUrl?: string;
  /** Original file name or path for format dispatch (.spz/.splat/.ply vs .glb/.gltf) */
  modelFilename?: string;
  /** Optional 1..4 2D layer image URLs for 2.5D parallax mode */
  layerUrls?: string[];
  /** Optional screen texture URL for 3D device-showcase mode */
  screenUrl?: string;
  /** Composable multi-object 3D scene graph (actors, props, 2D standees, GLBs, lights) */
  stageObjects?: ResolvedSpatialStageObject[];
  /** Saved camera bookmarks (visualized as frustums when studioInteractive && showCameraPath) */
  cameraBookmarks?: SpatialCameraBookmark[];
  /** Interactive studio preview only (enables raycast picking & gizmos; NEVER set in capture/export) */
  studioInteractive?: boolean;
  selectedObjectId?: string | null;
  showCameraPath?: boolean;
  frame?: number;
  fps?: number;
  width?: number;
  height?: number;
  /** Set true only for standalone UI preview thumbnails rendered outside Remotion Player/Renderer */
  standalone?: boolean;
}

interface ExplodablePart {
  obj: THREE.Object3D;
  basePos: THREE.Vector3;
  explodeDir: THREE.Vector3;
  spinSpeed?: number;
  spinAxis?: 'x' | 'y' | 'z';
}

interface ParticleSystemHandle {
  points: THREE.Points;
  basePositions: Float32Array;
  velocities: Float32Array;
  kind: SpatialParticles3D;
}

interface WebGL2SplatHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  centers: Float32Array;
  colors: Float32Array;
  scales: Float32Array;
  count: number;
  sortIndices: Int32Array;
  depths: Float32Array;
  sortedCenters: Float32Array;
  sortedColors: Float32Array;
  sortedScales: Float32Array;
  centerAttr: THREE.InstancedBufferAttribute;
  colorAttr: THREE.InstancedBufferAttribute;
  scaleAttr: THREE.InstancedBufferAttribute;
  lastCamDir: THREE.Vector3;
}

let pendingSpatialLoads = 0;
function bumpSpatialLoading(delta: number) {
  pendingSpatialLoads = Math.max(0, pendingSpatialLoads + delta);
  if (typeof document !== 'undefined' && document.documentElement) {
    if (pendingSpatialLoads > 0) document.documentElement.dataset.spatialLoading = '1';
    else delete document.documentElement.dataset.spatialLoading;
  }
}

function safeDelayRender(label: string, isStandalone: boolean): number | null {
  if (isStandalone) return null;
  bumpSpatialLoading(1);
  try {
    return delayRender(label);
  } catch {
    return -1;
  }
}

function safeContinueRender(handle: number | null) {
  if (handle === null) return;
  bumpSpatialLoading(-1);
  if (handle < 0) return;
  try {
    continueRender(handle);
  } catch {}
}

function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function disposeMaterial(mat: THREE.Material) {
  const rec = mat as unknown as Record<string, unknown>;
  for (const key of [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'emissiveMap',
    'aoMap',
    'alphaMap',
    'envMap',
  ]) {
    const tex = rec[key];
    if (tex && typeof (tex as THREE.Texture).dispose === 'function') {
      (tex as THREE.Texture).dispose();
    }
  }
  mat.dispose();
}

function disposeObject3D(root: THREE.Object3D, skipTextures?: Set<THREE.Texture>) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      mesh.geometry.dispose();
    }
    const mat = mesh.material;
    const freeMat = (m: THREE.Material) => {
      if (skipTextures?.size) {
        const rec = m as unknown as Record<string, unknown>;
        for (const key of ['map', 'emissiveMap', 'alphaMap']) {
          const tex = rec[key] as THREE.Texture | undefined;
          if (tex && skipTextures.has(tex)) rec[key] = null;
        }
      }
      disposeMaterial(m);
    };
    if (Array.isArray(mat)) {
      for (const m of mat) if (m) freeMat(m);
    } else if (mat) {
      freeMat(mat);
    }
  });
}

function attachPbrEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  lightingPreset: LightingPreset = 'studio',
  lookPreset: SpatialLookPreset = 'cinema',
): () => void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  const envBoost =
    lookPreset === 'clean-studio'
      ? 1.28
      : lookPreset === 'noir-dramatic'
        ? 0.48
        : lookPreset === 'anime-npr'
          ? 0.82
          : lightingPreset === 'dramatic'
            ? 0.55
            : lightingPreset === 'soft'
              ? 1.22
              : 0.96;
  if ('environmentIntensity' in scene) {
    (scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity = envBoost;
  }
  renderer.toneMappingExposure =
    lookPreset === 'clean-studio'
      ? 1.24
      : lookPreset === 'noir-dramatic'
        ? 1.02
        : lookPreset === 'anime-npr'
          ? 1.15
          : 1.16;
  return () => {
    scene.environment = null;
    envRT.dispose();
    envScene.dispose();
    pmrem.dispose();
  };
}

function renderPassToInt(pass: SpatialRenderPass): number {
  if (pass === 'clay') return 1;
  if (pass === 'depth') return 2;
  if (pass === 'normal') return 3;
  if (pass === 'wireframe') return 4;
  return 0;
}

/**
 * Custom GLSL 2.5D Depth-Relief shader for single or layered 2D artwork:
 * - Displaces mesh vertices smoothly in Z using luminance + radial hero depth weighting (¥0 local 2.5D!)
 * - Supports beauty, anime-npr (edge cel contrast), clay, ControlNet depth, normal, and wireframe passes!
 */
function createParallax25DMaterial(
  texture: THREE.Texture,
  opts: {
    depthStrength: number;
    renderPass: SpatialRenderPass;
    lookPreset: SpatialLookPreset;
    transparent: boolean;
    nearDepth?: number;
    farDepth?: number;
  },
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uDepthStrength: { value: opts.depthStrength },
      uPass: { value: renderPassToInt(opts.renderPass) },
      uAnimeNpr: { value: opts.lookPreset === 'anime-npr' ? 1.0 : 0.0 },
      uNear: { value: opts.nearDepth ?? 1.8 },
      uFar: { value: opts.farDepth ?? 10.5 },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uDepthStrength;
      varying vec2 vUv;
      varying float vViewZ;
      varying vec3 vViewNormal;
      varying float vRelief;

      float estimateRelief(vec2 uv) {
        vec4 s = texture2D(uMap, uv);
        float luma = dot(s.rgb, vec3(0.299, 0.587, 0.114));
        vec2 centered = (uv - vec2(0.5, 0.46)) * vec2(1.15, 1.25);
        float radial = clamp(1.0 - dot(centered, centered), 0.0, 1.0);
        float groundTilt = smoothstep(0.95, 0.08, uv.y) * 0.25;
        return (luma * 0.48 + radial * 0.42 + groundTilt) * s.a;
      }

      void main() {
        vUv = uv;
        float eps = 0.014;
        float r0 = estimateRelief(uv);
        float rR = estimateRelief(clamp(uv + vec2(eps, 0.0), 0.0, 1.0));
        float rL = estimateRelief(clamp(uv - vec2(eps, 0.0), 0.0, 1.0));
        float rU = estimateRelief(clamp(uv + vec2(0.0, eps), 0.0, 1.0));
        float rD = estimateRelief(clamp(uv - vec2(0.0, eps), 0.0, 1.0));
        float rBlur = (r0 * 2.0 + rR + rL + rU + rD) / 6.0;
        vRelief = rBlur;

        // Analytic tangent-space normal from finite differences (pure GLSL ES 1.00, zero derivatives extensions!)
        float scaleZ = uDepthStrength * 0.85;
        vec3 localNormal = normalize(vec3((rL - rR) * scaleZ * 8.0, (rD - rU) * scaleZ * 8.0, 1.0));
        vViewNormal = normalize(normalMatrix * localNormal);

        vec3 displaced = position;
        displaced.z += (rBlur - 0.35) * scaleZ;
        vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform int uPass;
      uniform float uAnimeNpr;
      uniform float uNear;
      uniform float uFar;
      varying vec2 vUv;
      varying float vViewZ;
      varying vec3 vViewNormal;
      varying float vRelief;

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.04) discard;

        if (uPass == 2) {
          float d = 1.0 - clamp((vViewZ - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
          gl_FragColor = vec4(vec3(d), tex.a);
          return;
        }
        if (uPass == 3) {
          vec3 n = normalize(vViewNormal);
          gl_FragColor = vec4(n * 0.5 + 0.5, tex.a);
          return;
        }
        if (uPass == 1) {
          vec3 n = normalize(vViewNormal);
          float ndl = max(0.30, dot(n, normalize(vec3(0.45, 0.72, 0.65))));
          vec3 clay = vec3(0.84, 0.86, 0.90) * ndl;
          gl_FragColor = vec4(clay, tex.a);
          return;
        }
        if (uPass == 4) {
          vec2 cell = abs(fract(vUv * vec2(24.0, 14.0)) - 0.5);
          float line = 1.0 - smoothstep(0.42, 0.48, min(cell.x, cell.y));
          vec3 col = mix(vec3(0.06, 0.09, 0.14), vec3(0.22, 0.82, 0.98), line);
          gl_FragColor = vec4(col, tex.a);
          return;
        }

        vec3 color = tex.rgb;
        if (uAnimeNpr > 0.5) {
          float px = 0.0024;
          float c0 = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
          float cx = dot(texture2D(uMap, clamp(vUv + vec2(px, 0.0), 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
          float cy = dot(texture2D(uMap, clamp(vUv + vec2(0.0, px), 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114));
          float edge = smoothstep(0.09, 0.24, abs(c0 - cx) + abs(c0 - cy));
          color = mix(color * 1.06, vec3(0.05, 0.06, 0.09), edge * 0.72);
        }
        float rim = smoothstep(0.55, 0.95, vRelief) * 0.06;
        color += vec3(rim);
        gl_FragColor = vec4(color, tex.a);
      }
    `,
    transparent: opts.transparent,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

/**
 * Creates a procedural anime/cinema 3-layer 2.5D diorama texture set when no custom 2D images are bound yet,
 * so newly dropped Spatial Stage nodes look immediately compelling instead of blank.
 */
function buildProceduralParallaxDiorama(
  accentHex: string,
  secondaryHex: string,
  isLight: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const accent = new THREE.Color(accentHex || '#3b82f6');
  const secondary = new THREE.Color(secondaryHex || '#14b8a6');

  // Layer 0 (Far Background z = -2.2): Atmospheric twilight skyline & moon halo
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 768;
  skyCanvas.height = 432;
  const sctx = skyCanvas.getContext('2d');
  if (sctx) {
    const grad = sctx.createLinearGradient(0, 0, 0, 432);
    if (isLight) {
      grad.addColorStop(0, '#dbeafe');
      grad.addColorStop(0.55, '#eff6ff');
      grad.addColorStop(1, '#cbd5e1');
    } else {
      grad.addColorStop(0, '#070c18');
      grad.addColorStop(0.55, '#111d36');
      grad.addColorStop(1, '#1d2d4e');
    }
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 768, 432);
    // Moon / dramatic light orb
    const rad = sctx.createRadialGradient(540, 128, 12, 540, 128, 170);
    rad.addColorStop(0, isLight ? 'rgba(255,255,255,0.95)' : 'rgba(224,242,254,0.92)');
    rad.addColorStop(0.32, `${accentHex || '#3b82f6'}66`);
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = rad;
    sctx.fillRect(340, 0, 420, 320);
    // Distant skyline silhouettes
    sctx.fillStyle = isLight ? '#94a3b8' : '#0b1324';
    const heights = [120, 185, 95, 220, 145, 260, 130, 175, 210, 110, 195, 140];
    heights.forEach((bh, i) => {
      sctx.fillRect(i * 66, 432 - bh, 58, bh);
    });
  }
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8.2, 4.6),
    new THREE.MeshBasicMaterial({ map: skyTex }),
  );
  skyMesh.position.set(0, 0.15, -2.2);
  group.add(skyMesh);

  // Layer 1 (Midground z = -0.55): Architectural clocktower arch & illuminated ribs
  const midGroup = new THREE.Group();
  midGroup.position.set(0, -0.35, -0.55);
  const towerMat = new THREE.MeshStandardMaterial({
    color: isLight ? '#475569' : '#152036',
    metalness: 0.45,
    roughness: 0.5,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  const secGlowMat = new THREE.MeshStandardMaterial({
    color: secondary,
    emissive: secondary,
    emissiveIntensity: 1.15,
    roughness: 0.25,
  });
  for (const xPos of [-2.15, 2.15]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 3.6, 0.42), towerMat);
    pillar.position.set(xPos, 0.35, 0);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    midGroup.add(pillar);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 0.08), secGlowMat);
    strip.position.set(xPos + (xPos < 0 ? 0.22 : -0.22), 0.35, 0.22);
    midGroup.add(strip);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.065, 20, 64), glowMat);
  ring.position.set(0, 0.72, -0.2);
  midGroup.add(ring);
  const floorDeck = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.18, 3.8), towerMat);
  floorDeck.position.set(0, -1.25, 0.4);
  floorDeck.receiveShadow = true;
  midGroup.add(floorDeck);
  group.add(midGroup);

  // Layer 2 (Foreground Subject z = 0.65): Stylized hero silhouette standing on edge
  const hero = buildDirectorMannequin(accent, secondary, 'hero');
  hero.root.position.set(0, -1.5, 0.65);
  hero.root.scale.setScalar(0.95);
  group.add(hero.root);

  return group;
}

interface MannequinRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headPivot: THREE.Group;
  armLPivot: THREE.Group;
  armRPivot: THREE.Group;
  legLPivot: THREE.Group;
  legRPivot: THREE.Group;
  baseX: number;
  baseY: number;
  baseZ: number;
  baseYaw: number;
}

/**
 * Builds an articulated studio Director Mannequin with shoulder/hip/neck joint pivots
 * so both Human directors and Coding Agents can choreograph real walking, running,
 * confronting, waving, and turning performances in 3D space!
 */
function buildDirectorMannequin(
  accent: THREE.Color,
  secondary: THREE.Color,
  role: 'hero' | 'rival',
): MannequinRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: role === 'hero' ? '#dde6f2' : '#9aa7bc',
    roughness: 0.56,
    metalness: 0.2,
  });
  const jointMat = new THREE.MeshStandardMaterial({
    color: role === 'hero' ? accent : secondary,
    emissive: role === 'hero' ? accent : secondary,
    emissiveIntensity: 0.32,
    roughness: 0.3,
    metalness: 0.45,
  });

  // Articulated Hip-Pivoted Legs
  const makeLeg = (sx: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 0.78, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.6, 8, 16), bodyMat);
    leg.position.set(0, -0.36, 0);
    leg.castShadow = true;
    leg.receiveShadow = true;
    pivot.add(leg);
    bodyGroup.add(pivot);
    return pivot;
  };
  const legLPivot = makeLeg(-0.14);
  const legRPivot = makeLeg(0.14);

  // Pelvis & Torso
  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.2, 20), jointMat);
  pelvis.position.set(0, 0.82, 0);
  pelvis.castShadow = true;
  bodyGroup.add(pelvis);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.17, 0.56, 24), bodyMat);
  torso.position.set(0, 1.2, 0);
  torso.castShadow = true;
  torso.receiveShadow = true;
  bodyGroup.add(torso);

  // Articulated Shoulder-Pivoted Arms
  const makeArm = (sx: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 1.42, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.48, 8, 16), bodyMat);
    arm.position.set(0, -0.25, 0.02);
    arm.castShadow = true;
    pivot.rotation.z = sx < 0 ? 0.12 : -0.12;
    pivot.add(arm);
    bodyGroup.add(pivot);
    return pivot;
  };
  const armLPivot = makeArm(-0.31);
  const armRPivot = makeArm(0.31);

  // Articulated Head + Directional Visor (unambiguously conveys gaze for reverse-angle framing!)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.54, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 24), bodyMat);
  head.position.set(0, 0.14, 0);
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.075, 0.12), jointMat);
  visor.position.set(0, 0.15, 0.12);
  headPivot.add(head, visor);
  bodyGroup.add(headPivot);

  // Ground stand ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.34, 32),
    new THREE.MeshBasicMaterial({ color: role === 'hero' ? accent : secondary, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  root.add(ring);

  return {
    root,
    bodyGroup,
    headPivot,
    armLPivot,
    armRPivot,
    legLPivot,
    legRPivot,
    baseX: 0,
    baseY: -1.2,
    baseZ: 0,
    baseYaw: 0,
  };
}

function animateDirectorMannequin(
  rig: MannequinRig,
  time: number,
  action: SpatialActorAction,
  speed: number,
) {
  const t = Math.max(0, time) * Math.max(0.2, speed);
  // Reset joints to neutral before applying deterministic pose
  rig.bodyGroup.position.y = 0;
  rig.bodyGroup.rotation.set(0, 0, 0);
  rig.headPivot.rotation.set(0, 0, 0);
  rig.armLPivot.rotation.set(0, 0, 0.12);
  rig.armRPivot.rotation.set(0, 0, -0.12);
  rig.legLPivot.rotation.set(0, 0, 0);
  rig.legRPivot.rotation.set(0, 0, 0);

  if (action === 'walk') {
    const ph = t * 5.2;
    const swing = Math.sin(ph) * 0.56;
    rig.legLPivot.rotation.x = swing;
    rig.legRPivot.rotation.x = -swing;
    rig.armLPivot.rotation.x = -swing * 0.8;
    rig.armRPivot.rotation.x = swing * 0.8;
    rig.bodyGroup.position.y = Math.abs(Math.cos(ph)) * 0.045;
    rig.bodyGroup.rotation.x = 0.06;
    rig.headPivot.rotation.y = Math.sin(t * 1.1) * 0.12;
  } else if (action === 'run') {
    const ph = t * 9.5;
    const swing = Math.sin(ph) * 0.92;
    rig.legLPivot.rotation.x = swing;
    rig.legRPivot.rotation.x = -swing;
    rig.armLPivot.rotation.x = -swing * 1.05 - 0.25;
    rig.armRPivot.rotation.x = swing * 1.05 - 0.25;
    rig.bodyGroup.position.y = Math.abs(Math.cos(ph)) * 0.095;
    rig.bodyGroup.rotation.x = 0.24;
  } else if (action === 'confront') {
    const pulse = Math.sin(t * 2.4);
    rig.bodyGroup.position.y = pulse * 0.018;
    rig.bodyGroup.rotation.y = -0.14 + pulse * 0.05;
    rig.armRPivot.rotation.x = -1.28 + Math.sin(t * 3.2) * 0.14;
    rig.armRPivot.rotation.z = -0.22;
    rig.armLPivot.rotation.x = -0.35;
    rig.armLPivot.rotation.z = 0.28;
    rig.legLPivot.rotation.x = 0.18;
    rig.legRPivot.rotation.x = -0.22;
    rig.headPivot.rotation.y = 0.12;
  } else if (action === 'wave') {
    rig.bodyGroup.position.y = Math.sin(t * 2.1) * 0.02;
    rig.armRPivot.rotation.z = -2.45 + Math.sin(t * 7.5) * 0.34;
    rig.armRPivot.rotation.x = -0.18;
    rig.headPivot.rotation.z = Math.sin(t * 3.5) * 0.08;
  } else if (action === 'turn') {
    const u = Math.min(1, t / 2.2);
    const eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    rig.bodyGroup.rotation.y = -Math.PI * 0.85 * (1 - eased);
    rig.headPivot.rotation.y = Math.sin(eased * Math.PI) * 0.35;
    rig.armLPivot.rotation.z = 0.18;
    rig.armRPivot.rotation.z = -0.18;
  } else {
    // 'idle': natural cinematic breathing + subtle gaze scan
    rig.bodyGroup.position.y = Math.sin(t * 1.8) * 0.016;
    rig.headPivot.rotation.y = Math.sin(t * 0.9) * 0.2;
    rig.armLPivot.rotation.z = 0.12 + Math.sin(t * 1.8) * 0.03;
    rig.armRPivot.rotation.z = -0.12 - Math.sin(t * 1.8) * 0.03;
  }
}

/**
 * Director 3D Whitebox & Choreographed Environment Stage:
 * Supports 5 environments + articulated hero/rival performances + 3D floor walk-path choreography.
 */
function buildPrevisBlockingScene(
  pose: SpatialBlockingPose,
  envPreset: SpatialEnvironmentPreset,
  actorPath: SpatialActorPath,
  renderPass: SpatialRenderPass,
  accentHex: string,
  secondaryHex: string,
  isLight: boolean,
  customStart?: [number, number],
  customEnd?: [number, number],
): { group: THREE.Group; heroRig: MannequinRig; rivalRig: MannequinRig | null } {
  const group = new THREE.Group();
  const accent = new THREE.Color(accentHex || '#3b82f6');
  const secondary = new THREE.Color(secondaryHex || '#14b8a6');

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.MeshStandardMaterial({
      color: isLight ? '#e2e8f0' : envPreset === 'neon-alley' ? '#090e1c' : '#0f172a',
      roughness: envPreset === 'neon-alley' || envPreset === 'open-horizon' ? 0.38 : 0.8,
      metalness: envPreset === 'neon-alley' ? 0.32 : 0.1,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  floor.receiveShadow = true;
  group.add(floor);

  const grid = new THREE.GridHelper(
    18,
    36,
    accent,
    new THREE.Color(isLight ? '#94a3b8' : '#1e293b'),
  );
  grid.position.y = -1.19;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = envPreset === 'open-horizon' ? 0.14 : isLight ? 0.4 : 0.26;
  group.add(grid);

  const archMat = new THREE.MeshStandardMaterial({
    color: isLight ? '#cbd5e1' : '#1e293b',
    roughness: 0.7,
    metalness: 0.18,
  });
  const darkArchMat = new THREE.MeshStandardMaterial({
    color: isLight ? '#94a3b8' : '#111827',
    roughness: 0.78,
    metalness: 0.12,
  });
  const accentGlowMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  const secGlowMat = new THREE.MeshStandardMaterial({
    color: secondary,
    emissive: secondary,
    emissiveIntensity: 1.35,
    roughness: 0.2,
  });

  // Build selected 3D environment architecture
  if (envPreset === 'rooftop-night') {
    // Parapet wall + distant glowing city skyline towers + rooftop vent unit
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.75, 0.35), archMat);
    parapet.position.set(0, -0.82, -3.2);
    parapet.castShadow = true;
    parapet.receiveShadow = true;
    group.add(parapet);
    const leftEdge = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.75, 7.6), archMat);
    leftEdge.position.set(-4.6, -0.82, 0.4);
    leftEdge.castShadow = true;
    group.add(leftEdge);
    const beaconStrip = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.05, 0.08), accentGlowMat);
    beaconStrip.position.set(0, -0.42, -3.02);
    group.add(beaconStrip);
    const towerSpecs = [
      [-4.8, 3.8, -6.8, 1.4],
      [-2.4, 5.2, -7.8, 1.6],
      [0.6, 4.4, -7.2, 1.5],
      [3.4, 6.0, -8.2, 1.8],
      [5.8, 3.5, -6.6, 1.4],
    ];
    for (const [tx, th, tz, tw] of towerSpecs) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(tw, th, tw), darkArchMat);
      tower.position.set(tx, -1.2 + th / 2 - 0.8, tz);
      group.add(tower);
      const topBar = new THREE.Mesh(new THREE.BoxGeometry(tw * 0.72, 0.08, 0.1), secGlowMat);
      topBar.position.set(tx, -1.2 + th - 1.0, tz + tw / 2 + 0.04);
      group.add(topBar);
    }
  } else if (envPreset === 'neon-alley') {
    // Narrow framing alley walls on left & right + vertical cyan/amber neon signage bars
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.65, 4.6, 9.5), darkArchMat);
      wall.position.set(side * 2.85, 1.1, -1.2);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
      for (const z of [-3.6, -1.4, 0.8]) {
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 1.45, 0.45),
          side < 0 ? accentGlowMat : secGlowMat,
        );
        sign.position.set(side * 2.48, 0.95, z);
        group.add(sign);
      }
    }
    const backArch = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.55, 0.6), archMat);
    backArch.position.set(0, 2.85, -4.6);
    group.add(backArch);
  } else if (envPreset === 'cyber-corridor') {
    // Repeating architectural perspective ribs & glowing ceiling light gates
    for (const z of [-4.2, -2.6, -1.0, 0.6, 2.2]) {
      const colL = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.4, 0.32), archMat);
      colL.position.set(-2.65, 0.5, z);
      colL.castShadow = true;
      const colR = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.4, 0.32), archMat);
      colR.position.set(2.65, 0.5, z);
      colR.castShadow = true;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.24, 0.28), archMat);
      beam.position.set(0, 2.2, z);
      const lightBar = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.05, 0.08), accentGlowMat);
      lightBar.position.set(0, 2.04, z);
      group.add(colL, colR, beam, lightBar);
    }
  } else if (envPreset === 'open-horizon') {
    // Minimal grand backlight monolith + floating horizon ring
    const monolith = new THREE.Mesh(new THREE.BoxGeometry(7.2, 3.6, 0.35), darkArchMat);
    monolith.position.set(0, 0.6, -5.2);
    monolith.castShadow = true;
    const haloRing = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.055, 16, 64), accentGlowMat);
    haloRing.position.set(0, 1.0, -4.8);
    group.add(monolith, haloRing);
  } else {
    // 'studio-grid' classic architectural blocking stage
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 5.2), archMat);
    leftWall.position.set(-3.2, 0.4, -1.6);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    const backMonolith = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.4, 0.45), archMat);
    backMonolith.position.set(0.4, 0.0, -3.6);
    backMonolith.castShadow = true;
    backMonolith.receiveShadow = true;
    const rimBeam = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 0.12), accentGlowMat);
    rimBeam.position.set(0.4, 1.24, -3.35);
    group.add(leftWall, backMonolith, rimBeam);
  }

  const heroRig = buildDirectorMannequin(accent, secondary, 'hero');
  let rivalRig: MannequinRig | null = buildDirectorMannequin(accent, secondary, 'rival');

  if (pose === 'dialogue') {
    heroRig.baseX = -0.78;
    heroRig.baseZ = 0.42;
    heroRig.baseYaw = Math.PI * 0.42;
    rivalRig.baseX = 0.82;
    rivalRig.baseZ = -0.28;
    rivalRig.baseYaw = -Math.PI * 0.58;
  } else if (pose === 'action-dash') {
    heroRig.baseX = -0.25;
    heroRig.baseZ = 0.65;
    heroRig.baseYaw = 0.16;
    rivalRig.baseX = 1.15;
    rivalRig.baseZ = -1.65;
    rivalRig.baseYaw = -0.35;
  } else if (pose === 'hero-solo') {
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, 0.35, 36), archMat);
    plinth.position.set(0, -1.02, 0);
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    group.add(plinth);
    heroRig.baseX = 0;
    heroRig.baseY = actorPath === 'hold' ? -0.85 : -1.2;
    heroRig.baseZ = 0;
    heroRig.baseYaw = 0.1;
    rivalRig = null;
  } else {
    heroRig.baseX = -1.15;
    heroRig.baseZ = 0.95;
    heroRig.baseYaw = Math.PI * 0.68;
    rivalRig.baseX = 1.18;
    rivalRig.baseZ = -1.05;
    rivalRig.baseYaw = -Math.PI * 0.32;
  }

  heroRig.root.position.set(heroRig.baseX, heroRig.baseY, heroRig.baseZ);
  heroRig.root.rotation.y = heroRig.baseYaw;
  heroRig.root.userData.stageObjectId = '__hero__';
  group.add(heroRig.root);
  if (rivalRig) {
    rivalRig.root.position.set(rivalRig.baseX, rivalRig.baseY, rivalRig.baseZ);
    rivalRig.root.rotation.y = rivalRig.baseYaw;
    rivalRig.root.userData.stageObjectId = '__rival__';
    group.add(rivalRig.root);
  }

  // Subtle floor blocking path line in beauty mode when actor moves along a path (hidden in depth/normal!)
  if (renderPass === 'beauty' && (actorPath !== 'hold' || (customStart && customEnd))) {
    const samplePts: THREE.Vector3[] = [];
    for (let s = 0; s <= 20; s++) {
      const st = computeActorPathState({
        path: actorPath,
        time: (s / 20) * 4,
        durationSec: 4,
        baseX: heroRig.baseX,
        baseZ: heroRig.baseZ,
        baseYaw: heroRig.baseYaw,
        customStart,
        customEnd,
        rivalPos: rivalRig ? [rivalRig.baseX, rivalRig.baseZ] : undefined,
      });
      samplePts.push(new THREE.Vector3(st.x, -1.17, st.z));
    }
    const lineGeom = new THREE.BufferGeometry().setFromPoints(samplePts);
    const lineMat = new THREE.LineBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.52,
    });
    group.add(new THREE.Line(lineGeom, lineMat));
  }

  return { group, heroRig, rivalRig };
}

/**
 * 3D Anodized Hardware Showcase with live screen texture slot (phone / laptop / cinema-display).
 */
function buildDeviceShowcaseScene(
  deviceType: SpatialDeviceType,
  screenTexture: THREE.Texture | null,
  accentHex: string,
  secondaryHex: string,
  isLight: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const accent = new THREE.Color(accentHex || '#3b82f6');
  const secondary = new THREE.Color(secondaryHex || '#14b8a6');

  const bodyMat = new THREE.MeshStandardMaterial({
    color: isLight ? '#d1d5db' : '#1f2937',
    metalness: 0.88,
    roughness: 0.22,
  });
  const bezelMat = new THREE.MeshStandardMaterial({
    color: '#090d16',
    metalness: 0.35,
    roughness: 0.16,
  });

  // Procedural fallback screen when user has not bound a custom image/recording yet
  let activeScreenTex = screenTexture;
  if (!activeScreenTex) {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = deviceType === 'phone' ? 1138 : 400;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, '#0f172a');
      g.addColorStop(0.55, '#1e293b');
      g.addColorStop(1, '#090d16');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      const orb = ctx.createRadialGradient(c.width * 0.65, c.height * 0.3, 18, c.width * 0.65, c.height * 0.3, c.width * 0.55);
      orb.addColorStop(0, `${accentHex || '#3b82f6'}cc`);
      orb.addColorStop(0.55, `${secondaryHex || '#14b8a6'}44`);
      orb.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = orb;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 44px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('CoCraft Spatial', 48, c.height * 0.48);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 22px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('绑定任意图片或录屏画面直贴 3D 屏幕', 48, c.height * 0.48 + 46);
    }
    activeScreenTex = new THREE.CanvasTexture(c);
    activeScreenTex.colorSpace = THREE.SRGBColorSpace;
  }

  const screenMat = new THREE.MeshStandardMaterial({
    map: activeScreenTex,
    emissive: new THREE.Color('#ffffff'),
    emissiveMap: activeScreenTex,
    emissiveIntensity: 0.72,
    roughness: 0.14,
    metalness: 0.05,
  });

  if (deviceType === 'laptop') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.11, 2.25), bodyMat);
    base.position.set(0, -0.78, 0.42);
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const keyboard = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.02, 1.15), bezelMat);
    keyboard.position.set(0, -0.72, 0.12);
    group.add(keyboard);

    const lidGroup = new THREE.Group();
    lidGroup.position.set(0, -0.72, -0.68);
    lidGroup.rotation.x = -0.18;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.15, 0.08), bodyMat);
    lid.position.set(0, 1.08, 0);
    lid.castShadow = true;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.16, 1.92), screenMat);
    screen.position.set(0, 1.09, 0.048);
    lidGroup.add(lid, screen);
    group.add(lidGroup);
  } else if (deviceType === 'cinema-display') {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.1, 2.4, 0.12), bodyMat);
    panel.position.set(0, 0.25, 0);
    panel.castShadow = true;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.86, 2.18), screenMat);
    screen.position.set(0, 0.25, 0.068);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.95, 0.08), bodyMat);
    neck.position.set(0, -1.12, -0.12);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 0.72), bodyMat);
    foot.position.set(0, -1.56, 0.05);
    group.add(panel, screen, neck, foot);
  } else {
    // Sleek Titanium Smartphone
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.68, 3.18, 0.16), bodyMat);
    chassis.castShadow = true;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.56, 3.04, 0.17), bezelMat);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.46, 2.92), screenMat);
    screen.position.set(0, 0, 0.09);
    const island = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.01), bezelMat);
    island.position.set(0, 1.32, 0.096);
    group.add(chassis, bezel, screen, island);
  }

  // Luminous studio podium ring
  const floorRing = new THREE.Mesh(
    new THREE.RingGeometry(1.85, 1.94, 64),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: isLight ? 0.28 : 0.38,
      side: THREE.DoubleSide,
    }),
  );
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = -1.68;
  group.add(floorRing);

  return group;
}

/**
 * Deterministic 3D volumetric particle field (dust / rain / snow / embers) in world space
 * so particles naturally travel IN FRONT OF and BEHIND 2.5D/3D objects!
 */
function buildVolumetricParticles(
  kind: SpatialParticles3D,
  accentHex: string,
  secondaryHex: string,
): ParticleSystemHandle | null {
  if (kind === 'none') return null;
  const count = kind === 'rain' ? 280 : kind === 'snow' ? 220 : 180;
  const basePositions = new Float32Array(count * 3);
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const bx = (hash01(i * 3.1 + 1) - 0.5) * 11.5;
    const by = (hash01(i * 5.7 + 2) - 0.5) * 6.4;
    const bz = (hash01(i * 7.3 + 3) - 0.45) * 6.2;
    basePositions[i * 3] = bx;
    basePositions[i * 3 + 1] = by;
    basePositions[i * 3 + 2] = bz;
    positions[i * 3] = bx;
    positions[i * 3 + 1] = by;
    positions[i * 3 + 2] = bz;

    if (kind === 'rain') {
      velocities[i * 3] = -0.55;
      velocities[i * 3 + 1] = -(4.8 + hash01(i * 11.1) * 2.4);
      velocities[i * 3 + 2] = 0;
    } else if (kind === 'snow') {
      velocities[i * 3] = (hash01(i * 9.3) - 0.5) * 0.45;
      velocities[i * 3 + 1] = -(0.65 + hash01(i * 13.7) * 0.55);
      velocities[i * 3 + 2] = (hash01(i * 17.9) - 0.5) * 0.25;
    } else if (kind === 'embers') {
      velocities[i * 3] = (hash01(i * 8.1) - 0.5) * 0.45;
      velocities[i * 3 + 1] = 0.75 + hash01(i * 12.3) * 0.9;
      velocities[i * 3 + 2] = (hash01(i * 15.1) - 0.5) * 0.35;
    } else {
      // 'dust'
      velocities[i * 3] = (hash01(i * 4.9) - 0.5) * 0.18;
      velocities[i * 3 + 1] = 0.08 + hash01(i * 6.7) * 0.16;
      velocities[i * 3 + 2] = (hash01(i * 8.3) - 0.5) * 0.12;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const color =
    kind === 'embers'
      ? '#fb923c'
      : kind === 'rain'
        ? '#bae6fd'
        : kind === 'snow'
          ? '#f8fafc'
          : secondaryHex || accentHex || '#93c5fd';

  const mat = new THREE.PointsMaterial({
    color,
    size: kind === 'rain' ? 0.075 : kind === 'snow' ? 0.095 : kind === 'embers' ? 0.09 : 0.065,
    transparent: true,
    opacity: kind === 'rain' ? 0.72 : kind === 'embers' ? 0.85 : 0.65,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geom, mat);
  return { points, basePositions, velocities, kind };
}

function updateVolumetricParticles(handle: ParticleSystemHandle | null, time: number) {
  if (!handle) return;
  const posAttr = handle.points.geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const count = arr.length / 3;
  const spanX = 11.5;
  const spanY = 6.4;
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const sway =
      handle.kind === 'snow' || handle.kind === 'dust' || handle.kind === 'embers'
        ? Math.sin(time * 1.4 + i * 0.7) * 0.28
        : 0;
    let nx = handle.basePositions[i3] + handle.velocities[i3] * time + sway;
    let ny = handle.basePositions[i3 + 1] + handle.velocities[i3 + 1] * time;
    const nz = handle.basePositions[i3 + 2] + handle.velocities[i3 + 2] * time;

    nx = ((((nx + spanX / 2) % spanX) + spanX) % spanX) - spanX / 2;
    ny = ((((ny + spanY / 2) % spanY) + spanY) % spanY) - spanY / 2;
    arr[i3] = nx;
    arr[i3 + 1] = ny;
    arr[i3 + 2] = nz;
  }
  posAttr.needsUpdate = true;
}

/**
 * Synchronous WebGL2 deterministic 3D Gaussian Splat renderer built directly on top of
 * Three.js 0.187's official SPZLoader / SPLATLoader / KSPLATLoader / GaussianSplatPLYLoader BufferGeometry!
 * Works in both live Chromium WebGL2 and headless Remotion renderMedia without async WebGPU init races.
 */
function buildWebGL2GaussianSplatMesh(
  splatGeom: THREE.BufferGeometry,
  renderPass: SpatialRenderPass,
): WebGL2SplatHandle | null {
  const posAttr = splatGeom.getAttribute('position');
  if (!posAttr || posAttr.count === 0) return null;
  const colAttr = splatGeom.getAttribute('color');
  const covAttr = splatGeom.getAttribute('covariance');

  const maxSplats = 160_000;
  const stride = Math.max(1, Math.ceil(posAttr.count / maxSplats));
  const count = Math.ceil(posAttr.count / stride);

  const centers = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const scales = new Float32Array(count);

  const box = new THREE.Box3();
  const tmpV = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const srcIdx = i * stride;
    tmpV.set(posAttr.getX(srcIdx), posAttr.getY(srcIdx), posAttr.getZ(srcIdx));
    box.expandByPoint(tmpV);
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const normScale = 4.2 / maxDim;

  for (let i = 0; i < count; i++) {
    const srcIdx = i * stride;
    centers[i * 3] = (posAttr.getX(srcIdx) - center.x) * normScale;
    centers[i * 3 + 1] = (posAttr.getY(srcIdx) - center.y) * normScale;
    centers[i * 3 + 2] = (posAttr.getZ(srcIdx) - center.z) * normScale;

    if (colAttr) {
      const normalized = colAttr.normalized;
      const div = normalized ? 1 : colAttr.array instanceof Uint8Array || colAttr.array instanceof Uint8ClampedArray ? 255 : 1;
      colors[i * 4] = colAttr.getX(srcIdx) / div;
      colors[i * 4 + 1] = colAttr.getY(srcIdx) / div;
      colors[i * 4 + 2] = colAttr.getZ(srcIdx) / div;
      colors[i * 4 + 3] = colAttr.itemSize >= 4 ? colAttr.getW(srcIdx) / div : 0.92;
    } else {
      colors[i * 4] = 0.72;
      colors[i * 4 + 1] = 0.84;
      colors[i * 4 + 2] = 0.98;
      colors[i * 4 + 3] = 0.9;
    }

    if (covAttr && covAttr.itemSize >= 6) {
      // Trace of covariance matrix estimates isotropic splat radius
      const c00 = Math.abs(covAttr.array[srcIdx * 6] || 0);
      const c11 = Math.abs(covAttr.array[srcIdx * 6 + 3] || 0);
      const c22 = Math.abs(covAttr.array[srcIdx * 6 + 5] || 0);
      const rad = Math.sqrt((c00 + c11 + c22) / 3) * normScale * 1.12;
      scales[i] = Math.max(0.016, Math.min(0.24, Number.isFinite(rad) ? rad : 0.048));
    } else {
      scales[i] = Math.max(0.022, Math.min(0.14, 0.065 * Math.sqrt(stride)));
    }
  }

  const baseQuad = new THREE.PlaneGeometry(2, 2);
  const instGeom = new THREE.InstancedBufferGeometry();
  instGeom.index = baseQuad.index;
  instGeom.attributes.position = baseQuad.attributes.position;
  instGeom.attributes.uv = baseQuad.attributes.uv;
  baseQuad.dispose();

  const sortedCenters = new Float32Array(centers);
  const sortedColors = new Float32Array(colors);
  const sortedScales = new Float32Array(scales);
  const centerAttr = new THREE.InstancedBufferAttribute(sortedCenters, 3);
  const colorAttr = new THREE.InstancedBufferAttribute(sortedColors, 4);
  const scaleAttr = new THREE.InstancedBufferAttribute(sortedScales, 1);
  instGeom.setAttribute('aCenter', centerAttr);
  instGeom.setAttribute('aColor', colorAttr);
  instGeom.setAttribute('aScale', scaleAttr);
  instGeom.instanceCount = count;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPass: { value: renderPassToInt(renderPass) },
      uNear: { value: 1.5 },
      uFar: { value: 12.0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec4 aColor;
      attribute float aScale;
      varying vec2 vLocal;
      varying vec4 vColor;
      varying float vViewZ;
      void main() {
        vLocal = position.xy;
        vColor = aColor;
        vec4 mvCenter = modelViewMatrix * vec4(aCenter, 1.0);
        mvCenter.xy += position.xy * aScale;
        vViewZ = -mvCenter.z;
        gl_Position = projectionMatrix * mvCenter;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform int uPass;
      uniform float uNear;
      uniform float uFar;
      varying vec2 vLocal;
      varying vec4 vColor;
      varying float vViewZ;
      void main() {
        float r2 = dot(vLocal, vLocal);
        if (r2 > 1.0) discard;
        float g = exp(-r2 * 2.8);
        float alpha = clamp(vColor.a * g, 0.0, 1.0);
        if (alpha < 0.02) discard;
        if (uPass == 2) {
          float d = 1.0 - clamp((vViewZ - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
          gl_FragColor = vec4(vec3(d), alpha);
          return;
        }
        if (uPass == 1) {
          gl_FragColor = vec4(vec3(0.84, 0.86, 0.90), alpha);
          return;
        }
        gl_FragColor = vec4(vColor.rgb, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(instGeom, material);
  mesh.frustumCulled = false;

  const sortIndices = new Int32Array(count);
  for (let i = 0; i < count; i++) sortIndices[i] = i;

  return {
    mesh,
    material,
    centers,
    colors,
    scales,
    count,
    sortIndices,
    depths: new Float32Array(count),
    sortedCenters,
    sortedColors,
    sortedScales,
    centerAttr,
    colorAttr,
    scaleAttr,
    lastCamDir: new THREE.Vector3(0, 0, 0),
  };
}

function sortWebGL2SplatsBackToFront(handle: WebGL2SplatHandle | null, camera: THREE.PerspectiveCamera) {
  if (!handle) return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  if (handle.lastCamDir.lengthSq() > 0 && dir.dot(handle.lastCamDir) > 0.9994) return;
  handle.lastCamDir.copy(dir);

  const { count, centers, depths, sortIndices } = handle;
  const dx = dir.x;
  const dy = dir.y;
  const dz = dir.z;
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    depths[i] = centers[i3] * dx + centers[i3 + 1] * dy + centers[i3 + 2] * dz;
    sortIndices[i] = i;
  }
  // Back-to-front along camera forward direction (largest dot first)
  sortIndices.sort((a, b) => depths[b] - depths[a]);

  for (let i = 0; i < count; i++) {
    const src = sortIndices[i];
    handle.sortedCenters[i * 3] = centers[src * 3];
    handle.sortedCenters[i * 3 + 1] = centers[src * 3 + 1];
    handle.sortedCenters[i * 3 + 2] = centers[src * 3 + 2];
    handle.sortedColors[i * 4] = handle.colors[src * 4];
    handle.sortedColors[i * 4 + 1] = handle.colors[src * 4 + 1];
    handle.sortedColors[i * 4 + 2] = handle.colors[src * 4 + 2];
    handle.sortedColors[i * 4 + 3] = handle.colors[src * 4 + 3];
    handle.sortedScales[i] = handle.scales[src];
  }
  handle.centerAttr.needsUpdate = true;
  handle.colorAttr.needsUpdate = true;
  handle.scaleAttr.needsUpdate = true;
}

const STAGE_FLOOR_Y = -1.2;

function buildStageObjectsGroup(
  objects: ResolvedSpatialStageObject[],
  opts: {
    accent: string;
    secondary: string;
    renderPass: SpatialRenderPass;
    studioInteractive: boolean;
    objTextures: Record<string, THREE.Texture>;
    objGlbs: Record<string, THREE.Group>;
  },
): {
  group: THREE.Group;
  extraActors: Array<{ obj: ResolvedSpatialStageObject; rig: MannequinRig }>;
  selectableRoots: Map<string, THREE.Object3D>;
} {
  const group = new THREE.Group();
  const extraActors: Array<{ obj: ResolvedSpatialStageObject; rig: MannequinRig }> = [];
  const selectableRoots = new Map<string, THREE.Object3D>();
  const accentCol = new THREE.Color(opts.accent || '#3b82f6');
  const secCol = new THREE.Color(opts.secondary || '#14b8a6');

  for (const obj of objects) {
    const px = Number.isFinite(obj.position?.[0]) ? obj.position[0] : 0;
    const py = Number.isFinite(obj.position?.[1]) ? obj.position[1] : 0;
    const pz = Number.isFinite(obj.position?.[2]) ? obj.position[2] : 0;
    const rotY = ((Number.isFinite(obj.rotationY) ? obj.rotationY : 0) * Math.PI) / 180;
    const scl = Math.max(0.2, Math.min(4, Number.isFinite(obj.scale) ? obj.scale : 1));
    const col = new THREE.Color(obj.color || '#64748b');

    if (obj.kind === 'actor') {
      const rig = buildDirectorMannequin(col, secCol, 'hero');
      rig.baseX = px;
      rig.baseY = STAGE_FLOOR_Y + py;
      rig.baseZ = pz;
      rig.baseYaw = rotY;
      rig.root.position.set(px, STAGE_FLOOR_Y + py, pz);
      rig.root.rotation.y = rotY;
      rig.root.scale.setScalar(scl);
      rig.root.userData.stageObjectId = obj.id;
      group.add(rig.root);
      extraActors.push({ obj, rig });
      selectableRoots.set(obj.id, rig.root);

      // Subtle floor walk-path line in beauty pass when actor has an endPosition
      if (opts.renderPass === 'beauty' && obj.endPosition) {
        const [ex, ey, ez] = obj.endPosition;
        if (Math.hypot(ex - px, ez - pz) > 0.08) {
          const pts = [
            new THREE.Vector3(px, STAGE_FLOOR_Y + py + 0.03, pz),
            new THREE.Vector3(ex, STAGE_FLOOR_Y + (ey || 0) + 0.03, ez),
          ];
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.65 }),
          );
          group.add(line);
          const endDot = new THREE.Mesh(
            new THREE.RingGeometry(0.12, 0.2, 24),
            new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.72 }),
          );
          endDot.rotation.x = -Math.PI / 2;
          endDot.position.set(ex, STAGE_FLOOR_Y + (ey || 0) + 0.03, ez);
          group.add(endDot);
        }
      }
      continue;
    }

    const holder = new THREE.Group();
    holder.userData.stageObjectId = obj.id;
    holder.position.set(px, STAGE_FLOOR_Y + py, pz);
    holder.rotation.y = rotY;
    holder.scale.setScalar(scl);

    if (obj.kind === 'prop-box') {
      const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.62, metalness: 0.14 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), mat);
      mesh.position.y = 0.475;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder.add(mesh);
    } else if (obj.kind === 'prop-pillar') {
      const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.56, metalness: 0.18 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 2.3, 20), mat);
      shaft.position.y = 1.15;
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.16, 0.74), mat);
      cap.position.y = 2.34;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.18, 0.78), mat);
      base.position.y = 0.09;
      holder.add(shaft, cap, base);
    } else if (obj.kind === 'prop-arch') {
      const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.65, metalness: 0.16 });
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.38, 2.45, 0.45), mat);
      left.position.set(-1.05, 1.225, 0);
      left.castShadow = true;
      left.receiveShadow = true;
      const right = new THREE.Mesh(new THREE.BoxGeometry(0.38, 2.45, 0.45), mat);
      right.position.set(1.05, 1.225, 0);
      right.castShadow = true;
      right.receiveShadow = true;
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.36, 0.52), mat);
      top.position.set(0, 2.58, 0);
      top.castShadow = true;
      holder.add(left, right, top);
    } else if (obj.kind === 'card-25d') {
      const tex = obj.assetUrl ? opts.objTextures[obj.assetUrl] : undefined;
      const img = tex?.image as { width?: number; height?: number } | undefined;
      const aspect = img?.width && img?.height ? Math.max(0.45, Math.min(2.4, img.width / img.height)) : 0.82;
      const cardH = 1.95;
      const cardW = cardH * aspect;
      const mat = tex
        ? new THREE.MeshStandardMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.08,
            roughness: 0.42,
            metalness: 0.05,
            side: THREE.DoubleSide,
          })
        : new THREE.MeshStandardMaterial({
            color: col,
            roughness: 0.5,
            metalness: 0.1,
            side: THREE.DoubleSide,
          });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(cardW, cardH), mat);
      plane.position.y = cardH * 0.5 + 0.02;
      plane.castShadow = true;
      plane.receiveShadow = true;
      const standBase = new THREE.Mesh(
        new THREE.BoxGeometry(cardW * 0.72, 0.06, 0.32),
        new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.5, metalness: 0.5 }),
      );
      standBase.position.y = 0.03;
      holder.add(plane, standBase);
    } else if (obj.kind === 'glb') {
      const loaded = obj.assetUrl ? opts.objGlbs[obj.assetUrl] : undefined;
      if (loaded) {
        const cloneModel = loaded.clone(true);
        holder.add(cloneModel);
      } else {
        const placeholder = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.55, 1),
          new THREE.MeshStandardMaterial({ color: accentCol, roughness: 0.35, metalness: 0.45 }),
        );
        placeholder.position.y = 0.65;
        placeholder.castShadow = true;
        holder.add(placeholder);
      }
    } else if (obj.kind === 'light') {
      const tempHex = kelvinToHex(obj.temperature ?? 3800);
      const pt = new THREE.PointLight(tempHex, Math.max(0.2, Number(obj.intensity ?? 2.6)), 18, 1.5);
      pt.position.set(0, 0, 0);
      holder.add(pt);
      // Studio light gizmo visible ONLY in interactive studio beauty mode (never in captures/exports!)
      if (opts.studioInteractive && opts.renderPass === 'beauty') {
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 16, 16),
          new THREE.MeshBasicMaterial({ color: tempHex }),
        );
        const halo = new THREE.Mesh(
          new THREE.RingGeometry(0.22, 0.27, 24),
          new THREE.MeshBasicMaterial({ color: tempHex, side: THREE.DoubleSide, transparent: true, opacity: 0.75 }),
        );
        halo.rotation.x = -Math.PI / 2;
        const dropLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, -(py || 0), 0),
          ]),
          new THREE.LineBasicMaterial({ color: tempHex, transparent: true, opacity: 0.4 }),
        );
        holder.add(bulb, halo, dropLine);
      }
    }

    group.add(holder);
    selectableRoots.set(obj.id, holder);
  }

  return { group, extraActors, selectableRoots };
}

function buildSelectionGizmo(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.61, 40),
    new THREE.MeshBasicMaterial({ color: '#38bdf8', side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  const xLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(0.95, 0.06, 0)]),
    new THREE.LineBasicMaterial({ color: '#f87171' }),
  );
  const zLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(0, 0.06, 0.95)]),
    new THREE.LineBasicMaterial({ color: '#60a5fa' }),
  );
  g.add(ring, xLine, zLine);
  g.visible = false;
  return g;
}

function buildCameraPathGuides(
  bookmarks: SpatialCameraBookmark[],
  isPortrait: boolean,
  is25D: boolean,
): THREE.Group {
  const g = new THREE.Group();
  const camPoints: THREE.Vector3[] = [];
  for (const bm of bookmarks) {
    const pose = computeSpatialCameraPose({
      preset: bm.cameraPreset,
      time: 0,
      speed: 1,
      isPortrait,
      is25D,
      lensMm: bm.cameraLens,
      yaw: bm.cameraYaw,
      pitch: bm.cameraPitch,
      distance: bm.cameraDistance,
      panX: bm.cameraPanX ?? 0,
      panY: bm.cameraPanY ?? 0,
    });
    const pos = new THREE.Vector3(pose.position[0], pose.position[1], pose.position[2]);
    const tgt = new THREE.Vector3(pose.target[0], pose.target[1], pose.target[2]);
    camPoints.push(pos);

    const marker = new THREE.Group();
    marker.position.copy(pos);
    marker.lookAt(tgt);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.16, 0.3),
      new THREE.MeshBasicMaterial({ color: '#facc15', wireframe: true }),
    );
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.42, 4),
      new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true, transparent: true, opacity: 0.72 }),
    );
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 0.34;
    marker.add(body, cone);
    g.add(marker);
  }
  if (camPoints.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(camPoints);
    const spline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(36)),
      new THREE.LineBasicMaterial({ color: '#facc15', transparent: true, opacity: 0.62 }),
    );
    g.add(spline);
  }
  return g;
}

function SpatialStageBody({
  title = '统一空间摄影棚',
  subtitle = 'SPATIAL STAGE',
  sceneType = 'parallax-25d',
  lightingPreset = 'studio',
  keyLightYaw = 38,
  keyLightTemp = 5600,
  lookPreset = 'cinema',
  renderPass = 'beauty',
  cameraPreset = 'dolly-in',
  cameraLens = 35,
  cameraYaw = 0,
  cameraPitch = 0,
  cameraDistance = 1,
  cameraPanX = 0,
  cameraPanY = 0,
  explode = 0,
  speed = 1,
  animateExplode = false,
  particles3D = 'none',
  depthStrength = 0.65,
  depthSpread = 1.0,
  dofStrength = 18,
  bloomStrength = 22,
  animationIndex = 0,
  blockingPose = 'standoff',
  actorAction = 'walk',
  actorPath = 'approach',
  environmentPreset = 'rooftop-night',
  actorStartX,
  actorStartZ,
  actorEndX,
  actorEndZ,
  durationSec = 4,
  deviceType = 'phone',
  showHud = false,
  focusLabel = '',
  accent = '#3b82f6',
  secondary = '#14b8a6',
  surface = 'dark',
  modelUrl,
  modelFilename,
  layerUrls,
  screenUrl,
  stageObjects = [],
  cameraBookmarks,
  studioInteractive = false,
  selectedObjectId = null,
  showCameraPath = false,
  frame,
  fps,
  width,
  height,
  isStandalone,
}: Required<Pick<SpatialStageProps, 'frame' | 'fps' | 'width' | 'height'>> &
  SpatialStageProps & { isStandalone: boolean }) {
  const resolvedLighting: LightingPreset =
    lightingPreset === 'dramatic' || lightingPreset === 'soft' ? lightingPreset : 'studio';
  const resolvedLook: SpatialLookPreset =
    lookPreset === 'anime-npr' || lookPreset === 'noir-dramatic' || lookPreset === 'clean-studio'
      ? lookPreset
      : 'cinema';
  const resolvedPass: SpatialRenderPass =
    renderPass === 'clay' ||
    renderPass === 'depth' ||
    renderPass === 'normal' ||
    renderPass === 'wireframe'
      ? renderPass
      : 'beauty';
  const resolvedParticles: SpatialParticles3D =
    particles3D === 'dust' ||
    particles3D === 'rain' ||
    particles3D === 'snow' ||
    particles3D === 'embers'
      ? particles3D
      : 'none';
  const resolvedPose: SpatialBlockingPose =
    blockingPose === 'dialogue' || blockingPose === 'action-dash' || blockingPose === 'hero-solo'
      ? blockingPose
      : 'standoff';
  const resolvedActorAction: SpatialActorAction =
    actorAction === 'idle' ||
    actorAction === 'walk' ||
    actorAction === 'run' ||
    actorAction === 'confront' ||
    actorAction === 'wave' ||
    actorAction === 'turn'
      ? actorAction
      : 'walk';
  const resolvedActorPath: SpatialActorPath =
    actorPath === 'hold' ||
    actorPath === 'approach' ||
    actorPath === 'cross-left-right' ||
    actorPath === 'cross-right-left' ||
    actorPath === 'circle-rival' ||
    actorPath === 'retreat'
      ? actorPath
      : 'hold';
  const resolvedEnv: SpatialEnvironmentPreset =
    environmentPreset === 'rooftop-night' ||
    environmentPreset === 'neon-alley' ||
    environmentPreset === 'cyber-corridor' ||
    environmentPreset === 'open-horizon'
      ? environmentPreset
      : 'studio-grid';
  const resolvedDevice: SpatialDeviceType =
    deviceType === 'laptop' || deviceType === 'cinema-display' ? deviceType : 'phone';
  const customStart: [number, number] | undefined =
    actorStartX !== undefined && actorStartZ !== undefined ? [actorStartX, actorStartZ] : undefined;
  const customEnd: [number, number] | undefined =
    actorEndX !== undefined && actorEndZ !== undefined ? [actorEndX, actorEndZ] : undefined;

  const isLight = surface === 'light' || resolvedLook === 'clean-studio';
  const isPortrait = height > width;
  const isSmallStaticThumb = width <= 420 && height <= 300;
  const isSplatModel = Boolean(modelUrl && isSplatAssetPath(modelFilename || modelUrl));
  const is25D = !modelUrl && sceneType === 'parallax-25d';
  const t = frame / Math.max(1, fps);

  // Smooth explosion envelope
  const targetExplode = Math.max(0, Math.min(1.5, Number(explode ?? 0)));
  const easeRamp = Math.min(1, Math.max(0, (t - 0.25) / 1.4));
  const smoothRamp = 1 - Math.pow(1 - easeRamp, 3);
  const currentExplode = animateExplode ? targetExplode * smoothRamp : targetExplode;

  // 1. Load GLB/GLTF OR SPZ/SPLAT/PLY 3D asset
  const [loadedGltf, setLoadedGltf] = useState<{
    root: THREE.Group;
    animations: THREE.AnimationClip[];
  } | null>(null);
  const [loadedSplatGeom, setLoadedSplatGeom] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    if (!modelUrl) {
      setLoadedGltf(null);
      setLoadedSplatGeom(null);
      return;
    }
    const handle = safeDelayRender(`Loading 3D spatial asset: ${modelUrl}`, isStandalone);
    let cancelled = false;
    let gltfRootRef: THREE.Group | null = null;
    let splatGeomRef: THREE.BufferGeometry | null = null;

    if (isSplatModel) {
      const lower = (modelFilename || modelUrl).toLowerCase();
      const loader = lower.endsWith('.spz')
        ? new SPZLoader()
        : lower.endsWith('.ksplat')
          ? new KSPLATLoader()
          : lower.endsWith('.ply')
            ? new GaussianSplatPLYLoader()
            : new SPLATLoader();
      loader.load(
        modelUrl,
        (geom) => {
          if (cancelled) {
            geom.dispose();
            return;
          }
          splatGeomRef = geom;
          setLoadedGltf(null);
          setLoadedSplatGeom(geom);
          safeContinueRender(handle);
        },
        undefined,
        () => {
          if (!cancelled) {
            setLoadedSplatGeom(null);
            safeContinueRender(handle);
          }
        },
      );
    } else {
      const loader = new GLTFLoader();
      const draco = new DRACOLoader();
      loader.setDRACOLoader(draco);
      loader.load(
        modelUrl,
        (gltf) => {
          if (cancelled) {
            disposeObject3D(gltf.scene);
            draco.dispose();
            return;
          }
          const root = gltf.scene.clone(true);
          disposeObject3D(gltf.scene);
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 0.001);
          const normScale = 3.2 / maxDim;
          root.position.sub(center);
          root.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          const wrapper = new THREE.Group();
          wrapper.scale.setScalar(normScale);
          wrapper.add(root);
          gltfRootRef = wrapper;
          setLoadedSplatGeom(null);
          setLoadedGltf({ root: wrapper, animations: gltf.animations || [] });
          draco.dispose();
          safeContinueRender(handle);
        },
        undefined,
        () => {
          draco.dispose();
          if (!cancelled) {
            setLoadedGltf(null);
            safeContinueRender(handle);
          }
        },
      );
    }

    return () => {
      cancelled = true;
      if (gltfRootRef) disposeObject3D(gltfRootRef);
      if (splatGeomRef) splatGeomRef.dispose();
      safeContinueRender(handle);
    };
  }, [modelUrl, modelFilename, isSplatModel, isStandalone]);

  // 2. Load 2.5D Layer Textures (1..4 images)
  const layerKey = useMemo(() => (layerUrls || []).filter(Boolean).join('|'), [layerUrls]);
  const [layerTextures, setLayerTextures] = useState<THREE.Texture[]>([]);

  useEffect(() => {
    const urls = (layerUrls || []).filter(Boolean).slice(0, 4);
    if (!urls.length || !is25D) {
      setLayerTextures([]);
      return;
    }
    const handle = safeDelayRender(`Loading 2.5D layers (${urls.length})`, isStandalone);
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const loaded: (THREE.Texture | null)[] = new Array(urls.length).fill(null);
    let remaining = urls.length;

    const finishOne = () => {
      remaining -= 1;
      if (remaining <= 0 && !cancelled) {
        setLayerTextures(loaded.filter((t): t is THREE.Texture => Boolean(t)));
        safeContinueRender(handle);
      }
    };

    urls.forEach((url, idx) => {
      loader.load(
        url,
        (tex) => {
          if (cancelled) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.generateMipmaps = false;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
          loaded[idx] = tex;
          finishOne();
        },
        undefined,
        () => finishOne(),
      );
    });

    return () => {
      cancelled = true;
      loaded.forEach((tex) => tex?.dispose());
      safeContinueRender(handle);
    };
  }, [layerKey, is25D, isStandalone]);

  // 3. Load optional Device Showcase screen texture
  const [screenTexture, setScreenTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!screenUrl || sceneType !== 'device-showcase') {
      setScreenTexture(null);
      return;
    }
    const handle = safeDelayRender(`Loading 3D device screen: ${screenUrl}`, isStandalone);
    let cancelled = false;
    let texRef: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      screenUrl,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        texRef = tex;
        setScreenTexture(tex);
        safeContinueRender(handle);
      },
      undefined,
      () => {
        if (!cancelled) {
          setScreenTexture(null);
          safeContinueRender(handle);
        }
      },
    );
    return () => {
      cancelled = true;
      texRef?.dispose();
      safeContinueRender(handle);
    };
  }, [screenUrl, sceneType, isStandalone]);

  // 4. Async load textures & GLBs referenced by composable `stageObjects`
  const objTexUrlsKey = useMemo(
    () =>
      (stageObjects || [])
        .filter((o) => o.kind === 'card-25d' && o.assetUrl)
        .map((o) => String(o.assetUrl))
        .sort()
        .join('|'),
    [stageObjects],
  );
  const objGlbUrlsKey = useMemo(
    () =>
      (stageObjects || [])
        .filter((o) => o.kind === 'glb' && o.assetUrl)
        .map((o) => String(o.assetUrl))
        .sort()
        .join('|'),
    [stageObjects],
  );
  const [objTextures, setObjTextures] = useState<Record<string, THREE.Texture>>({});
  const [objGlbs, setObjGlbs] = useState<Record<string, THREE.Group>>({});

  useEffect(() => {
    const urls = objTexUrlsKey ? objTexUrlsKey.split('|').filter(Boolean) : [];
    if (!urls.length) {
      setObjTextures({});
      return;
    }
    const handle = safeDelayRender(`Loading stage card textures (${urls.length})`, isStandalone);
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const loaded: Record<string, THREE.Texture> = {};
    let remaining = urls.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0 && !cancelled) {
        setObjTextures(loaded);
        safeContinueRender(handle);
      }
    };
    for (const url of urls) {
      loader.load(
        url,
        (tex) => {
          if (cancelled) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          loaded[url] = tex;
          done();
        },
        undefined,
        () => done(),
      );
    }
    return () => {
      cancelled = true;
      Object.values(loaded).forEach((t) => t.dispose());
      safeContinueRender(handle);
    };
  }, [objTexUrlsKey, isStandalone]);

  useEffect(() => {
    const urls = objGlbUrlsKey ? objGlbUrlsKey.split('|').filter(Boolean) : [];
    if (!urls.length) {
      setObjGlbs({});
      return;
    }
    const handle = safeDelayRender(`Loading stage GLB props (${urls.length})`, isStandalone);
    let cancelled = false;
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    loader.setDRACOLoader(draco);
    const loaded: Record<string, THREE.Group> = {};
    let remaining = urls.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0 && !cancelled) {
        setObjGlbs(loaded);
        draco.dispose();
        safeContinueRender(handle);
      }
    };
    for (const url of urls) {
      loader.load(
        url,
        (gltf) => {
          if (cancelled) {
            disposeObject3D(gltf.scene);
            return;
          }
          const root = gltf.scene.clone(true);
          disposeObject3D(gltf.scene);
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 0.001);
          const normScale = 1.65 / maxDim;
          root.position.set(-center.x, -box.min.y, -center.z);
          root.traverse((c) => {
            if ((c as THREE.Mesh).isMesh) {
              c.castShadow = true;
              c.receiveShadow = true;
            }
          });
          const wrapper = new THREE.Group();
          wrapper.scale.setScalar(normScale);
          wrapper.add(root);
          loaded[url] = wrapper;
          done();
        },
        undefined,
        () => done(),
      );
    }
    return () => {
      cancelled = true;
      draco.dispose();
      Object.values(loaded).forEach((g) => disposeObject3D(g));
      safeContinueRender(handle);
    };
  }, [objGlbUrlsKey, isStandalone]);

  // WebGL Renderer + Scene + Optional EffectComposer lifecycle
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [staticThumbUrl, setStaticThumbUrl] = useState<string | null>(null);
  const rigRef = useRef<{
    parts: ExplodablePart[];
    packets: THREE.Mesh[];
    mixer: THREE.AnimationMixer | null;
    animAction: THREE.AnimationAction | null;
    particles: ParticleSystemHandle | null;
    splatHandle: WebGL2SplatHandle | null;
    parallaxMats: THREE.ShaderMaterial[];
    heroRig: MannequinRig | null;
    rivalRig: MannequinRig | null;
    extraActors: Array<{ obj: ResolvedSpatialStageObject; rig: MannequinRig }>;
    selectableRoots: Map<string, THREE.Object3D>;
    selectionGizmo: THREE.Group | null;
  }>({
    parts: [],
    packets: [],
    mixer: null,
    animAction: null,
    particles: null,
    splatHandle: null,
    parallaxMats: [],
    heroRig: null,
    rivalRig: null,
    extraActors: [],
    selectableRoots: new Map(),
    selectionGizmo: null,
  });

  const stageObjectsSig = useMemo(() => JSON.stringify(stageObjects || []), [stageObjects]);
  const bookmarksSig = useMemo(() => JSON.stringify(cameraBookmarks || []), [cameraBookmarks]);

  const buildSceneInto = React.useCallback(
    (scene: THREE.Scene) => {
      const isDramatic = resolvedLighting === 'dramatic' || resolvedLook === 'noir-dramatic';
      const isSoft = resolvedLighting === 'soft' || resolvedLook === 'clean-studio';

      const amb = new THREE.AmbientLight('#dbeafe', isDramatic ? 0.34 : isSoft ? 1.15 : 0.62);
      const keyColor = kelvinToHex(Number(keyLightTemp ?? 5600));
      const keyYawRad = ((Number(keyLightYaw ?? 38)) * Math.PI) / 180;
      const keyRadius = isDramatic ? 8.6 : 8.2;
      const key = new THREE.DirectionalLight(keyColor, isDramatic ? 3.2 : isSoft ? 2.0 : 2.5);
      key.position.set(Math.sin(keyYawRad) * keyRadius, 8.5, Math.cos(keyYawRad) * keyRadius);
      key.castShadow = true;
      key.shadow.mapSize.width = 512;
      key.shadow.mapSize.height = 512;
      key.shadow.bias = -0.0005;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 26;
      const d = 6.5;
      key.shadow.camera.left = -d;
      key.shadow.camera.right = d;
      key.shadow.camera.top = d;
      key.shadow.camera.bottom = -d;

      const rim = new THREE.DirectionalLight(accent || '#3b82f6', isDramatic ? 2.8 : isSoft ? 0.95 : 1.75);
      rim.position.set(-Math.sin(keyYawRad) * 6.5, 3.8, -Math.cos(keyYawRad) * 6.5);
      const fill = new THREE.PointLight(secondary || '#14b8a6', isDramatic ? 1.15 : 1.55, 22);
      fill.position.set(0, -2.8, 4.5);
      scene.add(amb, key, rim, fill);

      // Subtle atmospheric depth fog in beauty pass only (never pollute depth/normal maps!)
      if (resolvedPass === 'beauty' && !is25D) {
        scene.fog = new THREE.FogExp2(isLight ? '#e9eef5' : '#090e1a', isDramatic ? 0.045 : 0.028);
      } else {
        scene.fog = null;
      }

      const nextRig: typeof rigRef.current = {
        parts: [],
        packets: [],
        mixer: null,
        animAction: null,
        particles: null,
        splatHandle: null,
        parallaxMats: [],
        heroRig: null,
        rivalRig: null,
        extraActors: [],
        selectableRoots: new Map(),
        selectionGizmo: null,
      };

      if (loadedSplatGeom) {
        const splatHandle = buildWebGL2GaussianSplatMesh(loadedSplatGeom, resolvedPass);
        if (splatHandle) {
          scene.add(splatHandle.mesh);
          nextRig.splatHandle = splatHandle;
        }
      } else if (loadedGltf) {
        const cloneRoot = loadedGltf.root.clone(true);
        scene.add(cloneRoot);
        cloneRoot.updateWorldMatrix(true, true);

        // Bind deterministic AnimationMixer if GLB carries skeletal/keyframe animations
        if (loadedGltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(cloneRoot);
          const idx = Math.abs(Math.round(Number(animationIndex ?? 0))) % loadedGltf.animations.length;
          const action = mixer.clipAction(loadedGltf.animations[idx]);
          action.play();
          nextRig.mixer = mixer;
          nextRig.animAction = action;
        }

        // Prepare radial explosion parts for GLB meshes
        const glbParts: ExplodablePart[] = [];
        const overallBox = new THREE.Box3().setFromObject(cloneRoot);
        const center = overallBox.getCenter(new THREE.Vector3());
        const invNormScale = 1 / Math.max(0.0001, cloneRoot.scale.x);
        cloneRoot.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const worldPos = new THREE.Vector3();
            child.getWorldPosition(worldPos);
            const dir = worldPos.sub(center);
            if (dir.lengthSq() < 0.001) dir.set(0, 0.5, 0);
            else dir.normalize().multiplyScalar(1.4);
            dir.multiplyScalar(invNormScale);
            glbParts.push({ obj: child, basePos: child.position.clone(), explodeDir: dir });
          }
        });
        nextRig.parts = glbParts;
      } else if (sceneType === 'parallax-25d') {
        if (layerTextures.length > 0) {
          const layout = computeParallaxLayerLayout(layerTextures.length, Number(depthSpread ?? 1.0));
          const safeDepth = Math.max(0, Math.min(1.5, Number(depthStrength ?? 0.65)));
          layerTextures.forEach((tex, i) => {
            const slot = layout[i] || { z: 0, scale: 1 };
            const img = tex.image as { width?: number; height?: number } | undefined;
            const imgAspect = img?.width && img?.height ? img.width / img.height : 16 / 9;
            const planeH = 3.18;
            const planeW = Math.max(1.8, Math.min(6.4, planeH * imgAspect));
            const geom = new THREE.PlaneGeometry(planeW, planeH, 64, 42);
            const mat = createParallax25DMaterial(tex, {
              depthStrength: layerTextures.length === 1 ? safeDepth : safeDepth * 0.42,
              renderPass: resolvedPass,
              lookPreset: resolvedLook,
              transparent: layerTextures.length > 1 || i > 0,
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(0, 0, slot.z);
            mesh.scale.setScalar(slot.scale);
            scene.add(mesh);
            nextRig.parallaxMats.push(mat);
          });
        } else {
          scene.add(buildProceduralParallaxDiorama(accent, secondary, isLight));
        }
      } else if (sceneType === 'previs-blocking') {
        const previs = buildPrevisBlockingScene(
          resolvedPose,
          resolvedEnv,
          resolvedActorPath,
          resolvedPass,
          accent,
          secondary,
          isLight,
          customStart,
          customEnd,
        );
        scene.add(previs.group);
        nextRig.heroRig = previs.heroRig;
        nextRig.rivalRig = previs.rivalRig;
      } else if (sceneType === 'device-showcase') {
        scene.add(buildDeviceShowcaseScene(resolvedDevice, screenTexture, accent, secondary, isLight));
      } else {
        // Legacy teardown-3d procedural rigs (turbine / chip-stack / factory-flow)
        const grid = new THREE.GridHelper(
          14,
          28,
          new THREE.Color(accent || '#3b82f6'),
          new THREE.Color(isLight ? '#cbd5e1' : '#1e293b'),
        );
        grid.position.y = -1.65;
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = isLight ? 0.34 : 0.24;
        scene.add(grid);

        const built = buildProceduralScene(sceneType, accent, secondary);
        built.group.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        scene.add(built.group);
        nextRig.parts = built.parts;
        nextRig.packets = built.packets;
      }

      if (nextRig.heroRig) nextRig.selectableRoots.set('__hero__', nextRig.heroRig.root);
      if (nextRig.rivalRig) nextRig.selectableRoots.set('__rival__', nextRig.rivalRig.root);

      // Mount composable multi-object 3D scene graph (`stageObjects`)
      if (stageObjects && stageObjects.length > 0) {
        const composed = buildStageObjectsGroup(stageObjects, {
          accent,
          secondary,
          renderPass: resolvedPass,
          studioInteractive,
          objTextures,
          objGlbs,
        });
        scene.add(composed.group);
        nextRig.extraActors = composed.extraActors;
        composed.selectableRoots.forEach((root, id) => nextRig.selectableRoots.set(id, root));
      }

      // Studio-only visual helpers (selection gizmo & 3D camera path frustums) — NEVER rendered in GPU capture/export!
      if (studioInteractive && resolvedPass === 'beauty') {
        const gizmo = buildSelectionGizmo();
        scene.add(gizmo);
        nextRig.selectionGizmo = gizmo;
        if (showCameraPath && cameraBookmarks && cameraBookmarks.length > 0) {
          scene.add(buildCameraPathGuides(cameraBookmarks, isPortrait, is25D));
        }
      }

      // Apply multi-pass material overrides for standard mesh scenes (depth / normal / clay / wireframe)
      const usesCustomShaderOnly =
        Boolean(nextRig.splatHandle) || nextRig.parallaxMats.length > 0;
      if (resolvedPass !== 'beauty' && !usesCustomShaderOnly) {
        if (resolvedPass === 'depth') {
          scene.overrideMaterial = createDepthPassMaterial(1.6, 12.2);
        } else if (resolvedPass === 'normal') {
          scene.overrideMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
        } else if (resolvedPass === 'clay') {
          scene.overrideMaterial = new THREE.MeshStandardMaterial({
            color: '#dde2ea',
            roughness: 0.88,
            metalness: 0.04,
          });
        } else if (resolvedPass === 'wireframe') {
          scene.overrideMaterial = new THREE.MeshBasicMaterial({
            color: '#38bdf8',
            wireframe: true,
          });
        }
      } else {
        scene.overrideMaterial = null;
      }

      // Attach deterministic 3D volumetric particles in beauty pass
      if (resolvedPass === 'beauty' && resolvedParticles !== 'none') {
        const particles = buildVolumetricParticles(resolvedParticles, accent, secondary);
        if (particles) {
          scene.add(particles.points);
          nextRig.particles = particles;
        }
      }

      rigRef.current = nextRig;
    },
    [
      resolvedLighting,
      keyLightYaw,
      keyLightTemp,
      resolvedLook,
      resolvedPass,
      resolvedParticles,
      resolvedPose,
      resolvedEnv,
      resolvedActorPath,
      resolvedDevice,
      actorStartX,
      actorStartZ,
      actorEndX,
      actorEndZ,
      sceneType,
      accent,
      secondary,
      isLight,
      is25D,
      isPortrait,
      loadedGltf,
      loadedSplatGeom,
      layerTextures,
      screenTexture,
      depthStrength,
      depthSpread,
      animationIndex,
      stageObjectsSig,
      bookmarksSig,
      objTextures,
      objGlbs,
      studioInteractive,
      showCameraPath,
    ],
  );

  const applyFrameState = React.useCallback(
    (camera: THREE.PerspectiveCamera, timeSec: number) => {
      const pose = computeSpatialCameraPose({
        preset: cameraPreset,
        time: timeSec,
        speed: Number(speed ?? 1),
        isPortrait,
        is25D,
        lensMm: Number(cameraLens ?? 35),
        yaw: Number(cameraYaw ?? 0),
        pitch: Number(cameraPitch ?? 0),
        distance: Number(cameraDistance ?? 1),
        panX: Number(cameraPanX ?? 0),
        panY: Number(cameraPanY ?? 0),
      });
      camera.fov = pose.fov;
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      camera.updateProjectionMatrix();

      // Advance deterministic GLB skeletal animation
      if (rigRef.current.mixer) {
        rigRef.current.mixer.setTime(Math.max(0, timeSec * Math.max(0, Number(speed ?? 1))));
      }

      // Advance choreographed 3D Director Mannequin walk path + articulated performance
      if (rigRef.current.heroRig) {
        const hero = rigRef.current.heroRig;
        const rival = rigRef.current.rivalRig;
        const pathState = computeActorPathState({
          path: resolvedActorPath,
          time: timeSec,
          durationSec,
          baseX: hero.baseX,
          baseZ: hero.baseZ,
          baseYaw: hero.baseYaw,
          speed: Number(speed ?? 1),
          customStart,
          customEnd,
          rivalPos: rival ? [rival.baseX, rival.baseZ] : undefined,
        });
        hero.root.position.set(pathState.x, hero.baseY, pathState.z);
        hero.root.rotation.y = pathState.facingYaw;
        animateDirectorMannequin(hero, timeSec, resolvedActorAction, Number(speed ?? 1));
        if (rival) {
          // Rival subtly tracks the hero and holds reactive idle/confront posture
          rival.root.rotation.y = Math.atan2(pathState.x - rival.baseX, pathState.z - rival.baseZ);
          animateDirectorMannequin(
            rival,
            timeSec + 0.4,
            resolvedActorAction === 'confront' ? 'confront' : 'idle',
            Number(speed ?? 1),
          );
        }
      }

      // Advance composable scene-graph extra actors along their start -> end blocking paths
      for (const item of rigRef.current.extraActors) {
        const { obj, rig } = item;
        const startX = obj.position?.[0] ?? 0;
        const startZ = obj.position?.[2] ?? 0;
        const endPos = obj.endPosition;
        const hasWalk = Boolean(endPos && Math.hypot(endPos[0] - startX, endPos[2] - startZ) > 0.06);
        const st = computeActorPathState({
          path: 'hold',
          time: timeSec,
          durationSec,
          baseX: startX,
          baseZ: startZ,
          baseYaw: rig.baseYaw,
          speed: Number(speed ?? 1),
          customStart: hasWalk ? [startX, startZ] : undefined,
          customEnd: hasWalk && endPos ? [endPos[0], endPos[2]] : undefined,
        });
        rig.root.position.set(st.x, rig.baseY, st.z);
        rig.root.rotation.y = hasWalk ? st.facingYaw : rig.baseYaw;
        animateDirectorMannequin(rig, timeSec, (obj.action || 'walk') as SpatialActorAction, Number(speed ?? 1));
      }

      // Sync interactive 3D selection gizmo onto currently selected object
      if (rigRef.current.selectionGizmo) {
        const selObj = selectedObjectId ? rigRef.current.selectableRoots.get(selectedObjectId) : undefined;
        if (selObj) {
          rigRef.current.selectionGizmo.visible = true;
          rigRef.current.selectionGizmo.position.set(selObj.position.x, STAGE_FLOOR_Y, selObj.position.z);
        } else {
          rigRef.current.selectionGizmo.visible = false;
        }
      }

      // Advance radial explosion & part rotation
      for (const p of rigRef.current.parts) {
        p.obj.position.copy(p.basePos).addScaledVector(p.explodeDir, currentExplode);
        if (p.spinSpeed) {
          const angle = timeSec * p.spinSpeed * Number(speed ?? 1);
          if (p.spinAxis === 'x') p.obj.rotation.x = angle;
          else if (p.spinAxis === 'z') p.obj.rotation.z = angle;
          else p.obj.rotation.y = angle;
        }
      }

      // Advance factory packets
      rigRef.current.packets.forEach((pkt, idx) => {
        const travel = ((idx * 0.72 + timeSec * 1.5 * Number(speed ?? 1)) % 5.6) - 2.8;
        pkt.position.x = travel;
      });

      // Advance 3D volumetric particles
      updateVolumetricParticles(rigRef.current.particles, timeSec * Math.max(0.2, Number(speed ?? 1)));

      // Sort 3DGS splats deterministically for exact alpha compositing
      sortWebGL2SplatsBackToFront(rigRef.current.splatHandle, camera);
    },
    [
      cameraPreset,
      cameraLens,
      cameraYaw,
      cameraPitch,
      cameraDistance,
      cameraPanX,
      cameraPanY,
      speed,
      isPortrait,
      is25D,
      currentExplode,
      resolvedActorAction,
      resolvedActorPath,
      durationSec,
      actorStartX,
      actorStartZ,
      actorEndX,
      actorEndZ,
      selectedObjectId,
    ],
  );

  // Small card thumbnail path: render one snapshot & immediately release WebGL context
  useLayoutEffect(() => {
    if (!isSmallStaticThumb) {
      setStaticThumbUrl(null);
      return;
    }
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: offscreen,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      return;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping =
      resolvedPass === 'beauty' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;

    const scene = new THREE.Scene();
    const disposeEnv = attachPbrEnvironment(renderer, scene, resolvedLighting, resolvedLook);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 120);
    buildSceneInto(scene);
    applyFrameState(camera, t);
    renderer.render(scene, camera);
    try {
      setStaticThumbUrl(offscreen.toDataURL('image/png'));
    } catch {}
    const keepTex = new Set<THREE.Texture>(layerTextures);
    if (screenTexture) keepTex.add(screenTexture);
    Object.values(objTextures).forEach((tx) => keepTex.add(tx));
    if (scene.overrideMaterial) {
      disposeMaterial(scene.overrideMaterial);
      scene.overrideMaterial = null;
    }
    disposeObject3D(scene, keepTex);
    disposeEnv();
    renderer.dispose();
    renderer.forceContextLoss();
  }, [
    isSmallStaticThumb,
    width,
    height,
    t,
    resolvedLighting,
    resolvedLook,
    resolvedPass,
    buildSceneInto,
    applyFrameState,
    layerTextures,
    screenTexture,
  ]);

  // Full stage WebGL + optional EffectComposer Bloom pipeline
  // Full stage WebGLRenderer lifecycle: create ONCE per mounted canvas so async asset loads & prop edits
  // NEVER call forceContextLoss() on the same live <canvas> element!
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const ctxRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    composer: EffectComposer | null;
    disposeEnv: () => void;
  } | null>(null);

  useLayoutEffect(() => {
    if (isSmallStaticThumb) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      return;
    }
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    return () => {
      rendererRef.current = null;
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [isSmallStaticThumb]);

  useLayoutEffect(() => {
    if (isSmallStaticThumb) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setSize(width, height, false);
    renderer.toneMapping =
      resolvedPass === 'beauty' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;

    const scene = new THREE.Scene();
    const disposeEnv = attachPbrEnvironment(renderer, scene, resolvedLighting, resolvedLook);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 120);
    buildSceneInto(scene);

    let composer: EffectComposer | null = null;
    const bloomAmt = Math.max(0, Math.min(100, Number(bloomStrength ?? 22)));
    // Use half-res EffectComposer Bloom only for standard lit 3D beauty passes (skip 2.5D & 3DGS ShaderMaterials
    // which already output final sRGB, preventing double-gamma washout and accelerating headless renders 4x).
    if (resolvedPass === 'beauty' && bloomAmt > 8 && !is25D && !isSplatModel) {
      try {
        composer = new EffectComposer(renderer);
        composer.setSize(width, height);
        composer.addPass(new RenderPass(scene, camera));
        const bloom = new UnrealBloomPass(
          new THREE.Vector2(Math.max(160, Math.round(width * 0.5)), Math.max(90, Math.round(height * 0.5))),
          (bloomAmt / 100) * 0.48,
          0.42,
          0.74,
        );
        composer.addPass(bloom);
        composer.addPass(new OutputPass());
      } catch {
        composer?.dispose();
        composer = null;
      }
    }

    ctxRef.current = { renderer, scene, camera, composer, disposeEnv };
    return () => {
      composer?.dispose();
      const keepTex = new Set<THREE.Texture>(layerTextures);
      if (screenTexture) keepTex.add(screenTexture);
      Object.values(objTextures).forEach((tx) => keepTex.add(tx));
      if (scene.overrideMaterial) {
        disposeMaterial(scene.overrideMaterial);
        scene.overrideMaterial = null;
      }
      disposeObject3D(scene, keepTex);
      disposeEnv();
      ctxRef.current = null;
    };
  }, [
    isSmallStaticThumb,
    width,
    height,
    resolvedLighting,
    resolvedLook,
    resolvedPass,
    bloomStrength,
    is25D,
    isSplatModel,
    buildSceneInto,
    layerTextures,
    screenTexture,
  ]);

  useLayoutEffect(() => {
    if (isSmallStaticThumb) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.camera.aspect = width / height;
    applyFrameState(ctx.camera, t);
    if (ctx.composer) {
      ctx.composer.render();
    } else {
      ctx.renderer.render(ctx.scene, ctx.camera);
    }
  }, [isSmallStaticThumb, width, height, t, applyFrameState, buildSceneInto]);

  // Interactive 3D Viewport Raycast Picking & Floor Projection (Studio interactive mode only)
  useEffect(() => {
    if (!studioInteractive || isSmallStaticThumb) return;
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -STAGE_FLOOR_Y);
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitFloor = new THREE.Vector3();

    const onStagePointer = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        action?: string;
        nx?: number;
        ny?: number;
        requestId?: string;
      }>).detail;
      const ctx = ctxRef.current;
      if (!ctx || !detail || typeof detail.nx !== 'number' || typeof detail.ny !== 'number') return;
      ctx.camera.updateMatrixWorld();
      ctx.scene.updateMatrixWorld();
      ndc.set(detail.nx * 2 - 1, -(detail.ny * 2 - 1));
      raycaster.setFromCamera(ndc, ctx.camera);

      let floorX: number | null = null;
      let floorZ: number | null = null;
      if (raycaster.ray.intersectPlane(floorPlane, hitFloor)) {
        floorX = Number(Math.max(-6, Math.min(6, hitFloor.x)).toFixed(2));
        floorZ = Number(Math.max(-6, Math.min(6, hitFloor.z)).toFixed(2));
      }

      let pickedId: string | null = null;
      if (detail.action === 'pick') {
        const roots = Array.from(rigRef.current.selectableRoots.values());
        if (roots.length > 0) {
          const hits = raycaster.intersectObjects(roots, true);
          for (const h of hits) {
            let cur: THREE.Object3D | null = h.object;
            while (cur) {
              if (typeof cur.userData?.stageObjectId === 'string') {
                pickedId = cur.userData.stageObjectId;
                break;
              }
              cur = cur.parent;
            }
            if (pickedId) break;
          }
        }
      }

      window.dispatchEvent(
        new CustomEvent('cocraft-stage-event', {
          detail: {
            action: detail.action || 'floor',
            requestId: detail.requestId,
            objectId: pickedId,
            floorX,
            floorZ,
          },
        }),
      );
    };

    window.addEventListener('cocraft-stage-pointer', onStagePointer);
    return () => window.removeEventListener('cocraft-stage-pointer', onStagePointer);
  }, [studioInteractive, isSmallStaticThumb]);

  const bgStyle =
    resolvedPass === 'depth'
      ? '#000000'
      : resolvedPass === 'normal'
        ? '#8080ff'
        : resolvedPass === 'clay'
          ? '#1e2430'
          : resolvedPass === 'wireframe'
            ? '#050811'
            : isLight
              ? 'radial-gradient(circle at 52% 44%, #ffffff 0%, #e5ebf3 78%)'
              : resolvedLook === 'noir-dramatic'
                ? 'radial-gradient(circle at 50% 42%, #111827 0%, #030712 75%)'
                : 'radial-gradient(circle at 52% 44%, #132038 0%, #090d16 74%)';

  const dofAmt = resolvedPass === 'beauty' ? Math.max(0, Math.min(100, Number(dofStrength ?? 18))) : 0;
  const camLabels: Record<string, string> = {
    'dolly-in': '推镜',
    orbit: '环绕',
    'crane-up': '升降',
    'dolly-zoom': '希区柯克变焦',
    'pan-sweep': '横摇',
    isometric: '等轴',
    'top-down': '俯瞰',
    'hero-low': '仰拍',
    static: '固定',
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: bgStyle,
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        color: isLight ? '#0f172a' : '#f8fafc',
        overflow: 'hidden',
      }}
    >
      {isSmallStaticThumb ? (
        staticThumbUrl ? (
          <img
            src={staticThumbUrl}
            alt=""
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%' }} />
        )
      ) : (
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      )}

      {/* Subtle optical Depth-of-Field peripheral focus vignette (beauty pass only) */}
      {dofAmt > 0 && !isSmallStaticThumb && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `radial-gradient(ellipse at 50% 46%, transparent ${64 - dofAmt * 0.2}%, rgba(4, 8, 18, ${(dofAmt / 100) * 0.42}) 100%)`,
          }}
        />
      )}

      {/* Optional Minimal Director HUD (hidden by default for clean cinema 2.5D / Device / Splat frames) */}
      {showHud && resolvedPass === 'beauty' && (
        <>
          <div
            style={{
              position: 'absolute',
              top: isPortrait ? 88 : 54,
              left: isPortrait ? 56 : 68,
              right: isPortrait ? 56 : 68,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              pointerEvents: 'none',
            }}
          >
            <div>
              {subtitle && (
                <div
                  style={{
                    fontSize: isPortrait ? 22 : 18,
                    letterSpacing: 3.5,
                    textTransform: 'uppercase',
                    color: secondary || '#14b8a6',
                    fontWeight: 600,
                    marginBottom: 10,
                  }}
                >
                  {subtitle}
                </div>
              )}
              {title && (
                <div
                  style={{
                    fontSize: isPortrait ? 58 : 52,
                    fontWeight: 700,
                    letterSpacing: -0.5,
                    lineHeight: 1.15,
                    textShadow: isLight ? 'none' : '0 8px 28px rgba(0,0,0,0.55)',
                  }}
                >
                  {title}
                </div>
              )}
            </div>

            <div
              style={{
                padding: '10px 18px',
                borderRadius: 999,
                background: isLight ? 'rgba(255, 255, 255, 0.88)' : 'rgba(15, 23, 42, 0.72)',
                border: `1px solid ${accent}55`,
                fontFamily: '"SFMono-Regular", Consolas, monospace',
                fontSize: 16,
                color: isLight ? '#334155' : '#cbd5e1',
                display: 'flex',
                gap: 14,
              }}
            >
              <span>
                {Math.round(Number(cameraLens ?? 35))}mm · {camLabels[String(cameraPreset)] || String(cameraPreset)}
              </span>
              {currentExplode > 0.01 && (
                <span style={{ color: accent }}>拆解 · {Math.round(currentExplode * 100)}%</span>
              )}
            </div>
          </div>

          {focusLabel && (
            <div
              style={{
                position: 'absolute',
                bottom: isPortrait ? 185 : 132,
                left: isPortrait ? 56 : 68,
                right: isPortrait ? 56 : 68,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 20px',
                  borderRadius: 12,
                  background: isLight ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 23, 42, 0.78)',
                  borderLeft: `3px solid ${accent}`,
                  fontSize: isPortrait ? 24 : 20,
                  color: isLight ? '#0f172a' : '#e2e8f0',
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: secondary,
                    boxShadow: `0 0 12px ${secondary}`,
                  }}
                />
                {focusLabel}
              </div>
              <div
                style={{
                  fontFamily: '"SFMono-Regular", Consolas, monospace',
                  fontSize: 15,
                  color: isLight ? '#64748b' : '#94a3b8',
                }}
              >
                速率 {Number(speed ?? 1).toFixed(1)}x · {t.toFixed(2)}s
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RemotionSpatialStageBridge(props: SpatialStageProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  return (
    <SpatialStageBody
      {...props}
      isStandalone={false}
      frame={props.frame ?? frame}
      fps={props.fps ?? fps}
      width={props.width || width}
      height={props.height || height}
    />
  );
}

/**
 * CoCraft Unified Spatial Stage (2.5D Parallax / Previs Whitebox / 3D Hardware Screen / GLB Skeletal / 3DGS Splat / Teardown).
 */
export function SpatialStage(props: SpatialStageProps) {
  if (
    props.frame !== undefined &&
    props.fps !== undefined &&
    props.width !== undefined &&
    props.height !== undefined
  ) {
    return (
      <SpatialStageBody
        {...props}
        isStandalone={Boolean(props.standalone)}
        frame={props.frame}
        fps={props.fps}
        width={props.width}
        height={props.height}
      />
    );
  }
  return <RemotionSpatialStageBridge {...props} />;
}
