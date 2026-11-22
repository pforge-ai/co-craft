import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type CameraPreset = 'orbit' | 'isometric' | 'dolly-in' | 'top-down' | 'hero-low';
export type LightingPreset = 'studio' | 'dramatic' | 'soft';

export interface ThreeCanvasProps {
  width?: number;
  height?: number;
  frame?: number;
  fps?: number;
  lightingPreset?: LightingPreset;
  camera?: { position?: [number, number, number]; fov?: number };
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onFrame?: (ctx: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    frame: number;
    fps: number;
    time: number;
  }) => void;
  setup?: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => (() => void) | void;
}

function attachPbrEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  lightingPreset: LightingPreset = 'studio',
): () => void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  if ('environmentIntensity' in scene) {
    (scene as THREE.Scene & { environmentIntensity: number }).environmentIntensity =
      lightingPreset === 'dramatic' ? 0.55 : lightingPreset === 'soft' ? 1.25 : 0.95;
  }
  renderer.toneMappingExposure =
    lightingPreset === 'dramatic' ? 1.04 : lightingPreset === 'soft' ? 1.22 : 1.18;
  return () => {
    scene.environment = null;
    envRT.dispose();
    envScene.dispose();
    pmrem.dispose();
  };
}

function disposeMaterial(mat: THREE.Material) {
  const rec = mat as unknown as Record<string, unknown>;
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'envMap']) {
    const tex = rec[key];
    if (tex && typeof (tex as THREE.Texture).dispose === 'function') {
      (tex as THREE.Texture).dispose();
    }
  }
  mat.dispose();
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      mesh.geometry.dispose();
    }
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) if (m) disposeMaterial(m);
    } else if (mat) {
      disposeMaterial(mat);
    }
  });
}

function StandaloneThreeCanvas({
  width,
  height,
  frame,
  fps,
  lightingPreset = 'studio',
  camera: camCfg,
  style,
  setup,
  onFrame,
}: Required<Pick<ThreeCanvasProps, 'width' | 'height' | 'frame' | 'fps'>> & ThreeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [staticThumbUrl, setStaticThumbUrl] = useState<string | null>(null);
  const isSmallStaticThumb = width <= 420 && height <= 300;
  const ctxRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    cleanup?: () => void;
    disposeEnv?: () => void;
  } | null>(null);

  // For small card thumbnails, render one deterministic snapshot and immediately release the WebGL context
  // so 3D asset/shot grids never exhaust Chromium's 8-16 WebGL context limit.
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;

    const scene = new THREE.Scene();
    const disposeEnv = attachPbrEnvironment(renderer, scene, lightingPreset);
    const camera = new THREE.PerspectiveCamera(camCfg?.fov || 40, width / height, 0.1, 100);
    const pos = camCfg?.position || [4.2, 3.0, 5.2];
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(0, 0, 0);

    const cleanup = setup ? setup(scene, camera) || undefined : undefined;
    onFrame?.({ scene, camera, renderer, frame, fps, time: frame / fps });
    renderer.render(scene, camera);
    try {
      setStaticThumbUrl(offscreen.toDataURL('image/png'));
    } catch {}
    cleanup?.();
    disposeObject3D(scene);
    disposeEnv();
    renderer.dispose();
    renderer.forceContextLoss();
  }, [isSmallStaticThumb, width, height, frame, fps, lightingPreset, setup, onFrame]);

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
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;

    const scene = new THREE.Scene();
    const disposeEnv = attachPbrEnvironment(renderer, scene, lightingPreset);
    const camera = new THREE.PerspectiveCamera(camCfg?.fov || 40, width / height, 0.1, 100);
    const pos = camCfg?.position || [4.2, 3.0, 5.2];
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(0, 0, 0);

    const cleanup = setup ? setup(scene, camera) || undefined : undefined;
    ctxRef.current = { renderer, scene, camera, cleanup, disposeEnv };

    return () => {
      cleanup?.();
      disposeObject3D(scene);
      disposeEnv();
      renderer.dispose();
      renderer.forceContextLoss();
      ctxRef.current = null;
    };
  }, [isSmallStaticThumb, width, height, lightingPreset, setup]);

  useLayoutEffect(() => {
    if (isSmallStaticThumb) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.camera.aspect = width / height;
    ctx.camera.updateProjectionMatrix();
    onFrame?.({
      scene: ctx.scene,
      camera: ctx.camera,
      renderer: ctx.renderer,
      frame,
      fps,
      time: frame / fps,
    });
    ctx.renderer.render(ctx.scene, ctx.camera);
  }, [isSmallStaticThumb, frame, fps, width, height, onFrame, setup]);

  if (isSmallStaticThumb) {
    return staticThumbUrl ? (
      <img src={staticThumbUrl} alt="" style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', ...style }} />
    ) : (
      <div style={{ width: '100%', height: '100%', ...style }} />
    );
  }
  return <canvas ref={canvasRef} width={width} height={height} style={{ width: '100%', height: '100%', ...style }} />;
}

function RemotionThreeCanvasBridge(props: ThreeCanvasProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  return (
    <StandaloneThreeCanvas
      {...props}
      frame={props.frame ?? frame}
      fps={props.fps ?? fps}
      width={props.width || width}
      height={props.height || height}
    />
  );
}

/**
 * Deterministic Remotion-synchronized Three.js WebGL Canvas.
 * Works both inside Remotion compositions and standalone preview cards when frame/fps/width/height are passed.
 */
export function ThreeCanvas(props: ThreeCanvasProps) {
  if (
    props.frame !== undefined &&
    props.fps !== undefined &&
    props.width !== undefined &&
    props.height !== undefined
  ) {
    return (
      <StandaloneThreeCanvas
        {...props}
        frame={props.frame}
        fps={props.fps}
        width={props.width}
        height={props.height}
      />
    );
  }
  return <RemotionThreeCanvasBridge {...props} />;
}

interface ExplodablePart {
  obj: THREE.Object3D;
  basePos: THREE.Vector3;
  explodeDir: THREE.Vector3;
  spinSpeed?: number;
  spinAxis?: 'x' | 'y' | 'z';
}

function buildProceduralScene(
  sceneType: string,
  accentHex: string,
  secondaryHex: string,
): { group: THREE.Group; parts: ExplodablePart[]; packets: THREE.Mesh[] } {
  const group = new THREE.Group();
  const parts: ExplodablePart[] = [];
  const packets: THREE.Mesh[] = [];

  const accent = new THREE.Color(accentHex || '#3b82f6');
  const secondary = new THREE.Color(secondaryHex || '#14b8a6');

  const metalDark = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.82, roughness: 0.24 });
  const metalSilver = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.88, roughness: 0.18 });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: accent,
    metalness: 0.25,
    roughness: 0.15,
    transmission: 0.35,
    thickness: 0.8,
    emissive: accent,
    emissiveIntensity: 0.22,
  });
  const secondaryMat = new THREE.MeshStandardMaterial({
    color: secondary,
    metalness: 0.55,
    roughness: 0.22,
    emissive: secondary,
    emissiveIntensity: 0.18,
  });
  const copperMat = new THREE.MeshStandardMaterial({ color: '#f59e0b', metalness: 0.85, roughness: 0.25 });

  if (sceneType === 'chip-stack') {
    // 5-layer vertical semiconductor / AI accelerator stack
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 3.2), metalDark);
    pcb.position.set(0, -0.9, 0);
    group.add(pcb);
    parts.push({ obj: pcb, basePos: pcb.position.clone(), explodeDir: new THREE.Vector3(0, -1.35, 0) });

    const interposer = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 2.5), copperMat);
    interposer.position.set(0, -0.55, 0);
    group.add(interposer);
    parts.push({ obj: interposer, basePos: interposer.position.clone(), explodeDir: new THREE.Vector3(0, -0.65, 0) });

    const dieGroup = new THREE.Group();
    dieGroup.position.set(0, -0.2, 0);
    const mainDie = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.16, 1.45), accentMat);
    dieGroup.add(mainDie);
    for (const [dx, dz] of [
      [-1.0, -0.6],
      [-1.0, 0.6],
      [1.0, -0.6],
      [1.0, 0.6],
    ]) {
      const hbm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.72), secondaryMat);
      hbm.position.set(dx, 0, dz);
      dieGroup.add(hbm);
    }
    group.add(dieGroup);
    parts.push({ obj: dieGroup, basePos: dieGroup.position.clone(), explodeDir: new THREE.Vector3(0, 0.1, 0) });

    const vaporChamber = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.16, 2.7), metalSilver);
    vaporChamber.position.set(0, 0.22, 0);
    group.add(vaporChamber);
    parts.push({ obj: vaporChamber, basePos: vaporChamber.position.clone(), explodeDir: new THREE.Vector3(0, 0.85, 0) });

    const sinkGroup = new THREE.Group();
    sinkGroup.position.set(0, 0.68, 0);
    for (let i = -6; i <= 6; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.42, 0.06), metalDark);
      fin.position.set(0, 0, i * 0.2);
      sinkGroup.add(fin);
    }
    group.add(sinkGroup);
    parts.push({ obj: sinkGroup, basePos: sinkGroup.position.clone(), explodeDir: new THREE.Vector3(0, 1.65, 0) });
  } else if (sceneType === 'factory-flow') {
    // 3-station conveyor & high-concurrency packet processing diorama
    const rail = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.12, 0.9), metalDark);
    rail.position.set(0, -0.55, 0);
    group.add(rail);
    parts.push({ obj: rail, basePos: rail.position.clone(), explodeDir: new THREE.Vector3(0, -0.6, 0) });

    const stations = [
      { x: -1.9, mat: secondaryMat, h: 0.95, dir: new THREE.Vector3(-0.8, 0.5, 0) },
      { x: 0, mat: accentMat, h: 1.28, dir: new THREE.Vector3(0, 1.1, 0) },
      { x: 1.9, mat: copperMat, h: 0.95, dir: new THREE.Vector3(0.8, 0.5, 0) },
    ];
    for (const st of stations) {
      const stGroup = new THREE.Group();
      stGroup.position.set(st.x, 0.15, 0);
      const archL = new THREE.Mesh(new THREE.BoxGeometry(0.9, st.h, 0.14), metalSilver);
      archL.position.set(0, 0, -0.52);
      const archR = new THREE.Mesh(new THREE.BoxGeometry(0.9, st.h, 0.14), metalSilver);
      archR.position.set(0, 0, 0.52);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.95, 24), st.mat);
      head.rotation.x = Math.PI / 2;
      head.position.set(0, st.h * 0.32, 0);
      stGroup.add(archL, archR, head);
      group.add(stGroup);
      parts.push({ obj: stGroup, basePos: stGroup.position.clone(), explodeDir: st.dir });
    }
    for (let i = 0; i < 8; i++) {
      const pkt = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.32), i % 2 === 0 ? accentMat : secondaryMat);
      pkt.position.set(-2.6 + i * 0.72, -0.32, 0);
      group.add(pkt);
      packets.push(pkt);
    }
  } else {
    // Default 'turbine': Coaxial precision optical/mechanical turbine assembly
    const rearMount = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.32, 36), metalDark);
    rearMount.rotation.z = Math.PI / 2;
    rearMount.position.set(-1.15, 0, 0);
    group.add(rearMount);
    parts.push({ obj: rearMount, basePos: rearMount.position.clone(), explodeDir: new THREE.Vector3(-1.6, 0, 0) });

    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.18, 20, 48), copperMat);
    coil.rotation.y = Math.PI / 2;
    coil.position.set(-0.62, 0, 0);
    group.add(coil);
    parts.push({ obj: coil, basePos: coil.position.clone(), explodeDir: new THREE.Vector3(-0.9, 0, 0) });

    const rotorGroup = new THREE.Group();
    rotorGroup.position.set(-0.08, 0, 0);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.44, 28), metalSilver);
    hub.rotation.z = Math.PI / 2;
    rotorGroup.add(hub);
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.62, 0.07), secondaryMat);
      blade.position.set(0, Math.cos(angle) * 0.72, Math.sin(angle) * 0.72);
      blade.rotation.x = angle;
      blade.rotation.y = 0.38;
      rotorGroup.add(blade);
    }
    group.add(rotorGroup);
    parts.push({
      obj: rotorGroup,
      basePos: rotorGroup.position.clone(),
      explodeDir: new THREE.Vector3(-0.15, 0, 0),
      spinSpeed: 2.2,
      spinAxis: 'x',
    });

    const prismCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.56, 1), accentMat);
    prismCore.position.set(0.52, 0, 0);
    group.add(prismCore);
    parts.push({
      obj: prismCore,
      basePos: prismCore.position.clone(),
      explodeDir: new THREE.Vector3(0.75, 0, 0),
      spinSpeed: -0.9,
      spinAxis: 'x',
    });

    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.12, 0.56, 36, 1, true), metalSilver);
    shroud.material = metalSilver.clone();
    (shroud.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    shroud.rotation.z = Math.PI / 2;
    shroud.position.set(0.95, 0, 0);
    group.add(shroud);
    parts.push({ obj: shroud, basePos: shroud.position.clone(), explodeDir: new THREE.Vector3(1.55, 0, 0) });

    const lensRing = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.1, 20, 48), accentMat);
    lensRing.rotation.y = Math.PI / 2;
    lensRing.position.set(1.28, 0, 0);
    group.add(lensRing);
    parts.push({ obj: lensRing, basePos: lensRing.position.clone(), explodeDir: new THREE.Vector3(2.2, 0, 0) });
  }

  return { group, parts, packets };
}

function applyCameraPreset(
  camera: THREE.PerspectiveCamera,
  preset: string,
  t: number,
  speed: number,
  isPortrait: boolean,
  cameraYaw = 0,
  cameraPitch = 0,
) {
  const distScale = isPortrait ? 1.38 : 1.0;
  const spd = Math.max(0, Number.isFinite(speed) ? speed : 1);
  if (preset === 'isometric') {
    const sway = Math.sin(t * 0.45 * spd) * 0.35;
    camera.position.set((4.6 + sway) * distScale, 3.6 * distScale, (4.6 - sway) * distScale);
  } else if (preset === 'dolly-in') {
    const z = Math.max(3.1, 6.2 - t * 0.55 * spd);
    camera.position.set(2.2 * distScale, 1.7 * distScale, z * distScale);
  } else if (preset === 'top-down') {
    const angle = t * 0.3 * spd;
    camera.position.set(Math.sin(angle) * 1.8 * distScale, 6.4 * distScale, Math.cos(angle) * 1.8 * distScale);
  } else if (preset === 'hero-low') {
    const angle = -0.45 + t * 0.25 * spd;
    camera.position.set(Math.sin(angle) * 5.2 * distScale, 0.85 * distScale, Math.cos(angle) * 5.2 * distScale);
  } else {
    // 'orbit'
    const angle = 0.55 + t * 0.48 * spd;
    camera.position.set(Math.cos(angle) * 5.4 * distScale, 2.35 * distScale, Math.sin(angle) * 5.4 * distScale);
  }
  if (cameraYaw || cameraPitch) {
    const spherical = new THREE.Spherical().setFromVector3(camera.position);
    spherical.theta += (cameraYaw * Math.PI) / 180;
    spherical.phi = Math.max(0.18, Math.min(Math.PI - 0.18, spherical.phi + (cameraPitch * Math.PI) / 180));
    camera.position.setFromSpherical(spherical);
  }
  camera.lookAt(0, 0, 0);
}

export interface TeardownStageProps {
  title?: string;
  subtitle?: string;
  sceneType?: string;
  lightingPreset?: string;
  cameraPreset?: string;
  cameraYaw?: number;
  cameraPitch?: number;
  explode?: number;
  speed?: number;
  animateExplode?: boolean;
  focusLabel?: string;
  accent?: string;
  secondary?: string;
  surface?: string;
  modelUrl?: string;
  frame?: number;
  fps?: number;
  width?: number;
  height?: number;
}

function TeardownStageBody({
  title = '三维精密结构拆解',
  subtitle = '三维空间结构展示',
  sceneType = 'turbine',
  lightingPreset = 'studio',
  cameraPreset = 'orbit',
  cameraYaw = 0,
  cameraPitch = 0,
  explode = 0.55,
  speed = 1,
  animateExplode = true,
  focusLabel = '光学棱镜与同轴叶轮核心',
  accent = '#3b82f6',
  secondary = '#14b8a6',
  surface = 'dark',
  modelUrl,
  frame,
  fps,
  width,
  height,
}: Required<Pick<TeardownStageProps, 'frame' | 'fps' | 'width' | 'height'>> & TeardownStageProps) {
  const resolvedLighting: LightingPreset =
    lightingPreset === 'dramatic' || lightingPreset === 'soft' ? lightingPreset : 'studio';
  const isLight = surface === 'light';
  const isPortrait = height > width;
  const t = frame / fps;

  // Smooth explosion envelope: either animated ease-in-hold or fixed slider
  const targetExplode = Math.max(0, Math.min(1.5, Number(explode ?? 0.55)));
  const easeRamp = Math.min(1, Math.max(0, (t - 0.25) / 1.4));
  const smoothRamp = 1 - Math.pow(1 - easeRamp, 3);
  const currentExplode = animateExplode ? targetExplode * smoothRamp : targetExplode;

  const [loadedGltf, setLoadedGltf] = useState<THREE.Group | null>(null);

  useEffect(() => {
    if (!modelUrl) {
      setLoadedGltf(null);
      return;
    }
    const handle = delayRender(`Loading 3D model: ${modelUrl}`);
    let cancelled = false;
    const loader = new GLTFLoader();
    let loadedRef: THREE.Group | null = null;
    loader.load(
      modelUrl,
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
        const normScale = 3.2 / maxDim;
        root.position.sub(center);
        const wrapper = new THREE.Group();
        wrapper.scale.setScalar(normScale);
        wrapper.add(root);
        loadedRef = wrapper;
        setLoadedGltf(wrapper);
        continueRender(handle);
      },
      undefined,
      () => {
        if (!cancelled) {
          setLoadedGltf(null);
          continueRender(handle);
        }
      },
    );
    return () => {
      cancelled = true;
      if (loadedRef) disposeObject3D(loadedRef);
      continueRender(handle);
    };
  }, [modelUrl]);

  const rigRef = useRef<{
    parts: ExplodablePart[];
    packets: THREE.Mesh[];
  }>({ parts: [], packets: [] });

  const setup = React.useCallback(
    (scene: THREE.Scene) => {
      const isDramatic = resolvedLighting === 'dramatic';
      const isSoft = resolvedLighting === 'soft';
      const amb = new THREE.AmbientLight('#dbeafe', isDramatic ? 0.32 : isSoft ? 1.05 : 0.55);
      const key = new THREE.DirectionalLight('#ffffff', isDramatic ? 3.2 : isSoft ? 1.8 : 2.35);
      key.position.set(isDramatic ? 8 : 6, 8, isDramatic ? 4 : 6);
      const rim = new THREE.DirectionalLight(accent || '#3b82f6', isDramatic ? 2.6 : isSoft ? 1.0 : 1.75);
      rim.position.set(-6, 3.5, -5.5);
      const fill = new THREE.PointLight(secondary || '#14b8a6', isDramatic ? 1.1 : 1.5, 20);
      fill.position.set(0, -3, 4.5);
      scene.add(amb, key, rim, fill);

      // Subtle metallic floor ring beneath the subject to ground reflections
      const floorRing = new THREE.Mesh(
        new THREE.RingGeometry(2.1, 2.18, 64),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(accent || '#3b82f6'),
          transparent: true,
          opacity: isLight ? 0.22 : 0.28,
          side: THREE.DoubleSide,
        }),
      );
      floorRing.rotation.x = -Math.PI / 2;
      floorRing.position.y = -1.64;
      scene.add(floorRing);

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

      if (loadedGltf) {
        const cloneRoot = loadedGltf.clone(true);
        scene.add(cloneRoot);
        cloneRoot.updateWorldMatrix(true, true);
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
            // Convert world-space explosion offset into child's local scale space so any GLB unit scale explodes cleanly.
            dir.multiplyScalar(invNormScale);
            glbParts.push({ obj: child, basePos: child.position.clone(), explodeDir: dir });
          }
        });
        rigRef.current = { parts: glbParts, packets: [] };
      } else {
        const built = buildProceduralScene(sceneType, accent, secondary);
        scene.add(built.group);
        rigRef.current = { parts: built.parts, packets: built.packets };
      }
    },
    [sceneType, accent, secondary, loadedGltf, isLight, resolvedLighting],
  );

  const onFrame = React.useCallback(
    ({ camera, time }: { camera: THREE.PerspectiveCamera; time: number }) => {
      applyCameraPreset(
        camera,
        cameraPreset,
        time,
        Number(speed ?? 1),
        isPortrait,
        Number(cameraYaw ?? 0),
        Number(cameraPitch ?? 0),
      );
      for (const p of rigRef.current.parts) {
        p.obj.position.copy(p.basePos).addScaledVector(p.explodeDir, currentExplode);
        if (p.spinSpeed) {
          const angle = time * p.spinSpeed * Number(speed ?? 1);
          if (p.spinAxis === 'x') p.obj.rotation.x = angle;
          else if (p.spinAxis === 'z') p.obj.rotation.z = angle;
          else p.obj.rotation.y = angle;
        }
      }
      rigRef.current.packets.forEach((pkt, idx) => {
        const travel = ((idx * 0.72 + time * 1.5 * Number(speed ?? 1)) % 5.6) - 2.8;
        pkt.position.x = travel;
      });
    },
    [cameraPreset, cameraYaw, cameraPitch, speed, isPortrait, currentExplode],
  );

  const camLabels: Record<string, string> = {
    orbit: '环绕',
    isometric: '等轴',
    'dolly-in': '推近',
    'top-down': '俯瞰',
    'hero-low': '仰拍',
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: isLight
          ? 'radial-gradient(circle at 52% 44%, #ffffff 0%, #e9eef5 76%)'
          : 'radial-gradient(circle at 52% 44%, #132038 0%, #090d16 72%)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        color: isLight ? '#0f172a' : '#f8fafc',
        overflow: 'hidden',
      }}
    >
      <ThreeCanvas
        frame={frame}
        fps={fps}
        width={width}
        height={height}
        lightingPreset={resolvedLighting}
        setup={setup}
        onFrame={onFrame}
      />

      {/* Editorial Technical HUD Overlay */}
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
          <div
            style={{
              fontSize: isPortrait ? 60 : 54,
              fontWeight: 700,
              letterSpacing: -0.5,
              lineHeight: 1.15,
              textShadow: isLight ? 'none' : '0 8px 28px rgba(0,0,0,0.55)',
            }}
          >
            {title}
          </div>
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
          <span>机位 · {camLabels[String(cameraPreset)] || String(cameraPreset)}</span>
          <span style={{ color: accent }}>拆解 · {Math.round(currentExplode * 100)}%</span>
        </div>
      </div>

      {focusLabel && (
        <div
          style={{
            position: 'absolute',
            bottom: isPortrait ? 120 : 56,
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
    </div>
  );
}

function RemotionTeardownBridge(props: TeardownStageProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  return (
    <TeardownStageBody
      {...props}
      frame={props.frame ?? frame}
      fps={props.fps ?? fps}
      width={props.width || width}
      height={props.height || height}
    />
  );
}

export function TeardownStage(props: TeardownStageProps) {
  if (
    props.frame !== undefined &&
    props.fps !== undefined &&
    props.width !== undefined &&
    props.height !== undefined
  ) {
    return (
      <TeardownStageBody
        {...props}
        frame={props.frame}
        fps={props.fps}
        width={props.width}
        height={props.height}
      />
    );
  }
  return <RemotionTeardownBridge {...props} />;
}
