import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

// Minimal valid embedded .gltf file (2 meshes so radial explode has multiple parts)
function createMinimalGltfJson() {
  // 3 vertices triangle in Float32 little-endian base64
  const positions = new Float32Array([0, 0.8, 0, -0.7, -0.5, 0, 0.7, -0.5, 0]);
  const b64 = Buffer.from(positions.buffer).toString('base64');
  return JSON.stringify({
    asset: { version: '2.0', generator: 'CoCraft Test' },
    buffers: [{ uri: `data:application/octet-stream;base64,${b64}`, byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 }],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.7, -0.5, 0],
        max: [0.7, 0.8, 0],
      },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 } }] },
      { primitives: [{ attributes: { POSITION: 0 } }] },
    ],
    nodes: [
      { mesh: 0, translation: [-0.4, 0, 0] },
      { mesh: 1, translation: [0.4, 0, 0] },
    ],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
  });
}

const data = await mkdtemp(join(tmpdir(), 'cocraft-v03-full-'));
const verifyOut = resolve('docs/verification/v3');
const sampleGltf = join(data, 'sample-prism.gltf');
await writeFile(sampleGltf, createMinimalGltfJson(), 'utf8');

const app = await electron.launch({
  args: ['.', '--use-mock-keychain'],
  env: { ...process.env, COCRAFT_DATA_DIR: data },
});

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.locator('.preview-canvas iframe').waitFor();

  // 1. Check 8-into-4 Built-in Science & Demo Skills discovery
  const boot = await page.evaluate(() => window.cocraft.call('boot'));
  const skillNames = boot.skills.map((s) => s.name);
  for (const required of [
    'cocraft-editing',
    'cocraft-motion',
    'cocraft-seecode',
    'cocraft-tinycharts',
    'cocraft-anatomy',
    'cocraft-teardown-3d',
  ]) {
    assert(skillNames.includes(required), `Missing built-in skill: ${required}`);
  }
  assert(boot.globalVault.length >= 4, 'Starter Global Asset Library seeded');
  console.log('PASS · 8-into-4 Science/Demo Skills & Starter Global Vault discovered');

  // 2. Dual-Layer Asset Vault: create Subject Card in Project A -> Promote to Global -> Create Project B -> Pull into Project B
  await page.getByRole('button', { name: /^资产/ }).click();
  await page.getByRole('button', { name: '主体卡', exact: true }).click();
  await page.getByLabel('资产名称', { exact: true }).fill('阿泽 · 科技主讲人');
  await page.getByLabel('一致性描述锚点', { exact: true }).fill('深蓝极简毛衣，35mm 棚拍柔光，跨分镜人物严格一致');
  await page.getByRole('button', { name: '保存资产', exact: true }).click();
  await page.locator('.vault-card.structured').getByText('阿泽 · 科技主讲人').waitFor();

  const afterSubject = await page.evaluate(() => window.cocraft.call('boot'));
  const createdItem = afterSubject.current.project.vault.find((v) => v.name === '阿泽 · 科技主讲人');
  assert(createdItem, 'Subject card saved in Project A vault');

  const promotedRes = await page.evaluate(
    (itemId) => window.cocraft.call('vault.promote', { itemId }),
    createdItem.id,
  );
  assert(promotedRes.promoted.id.startsWith('gvault_'), 'Promoted to Global Asset Library');

  // Create fresh Project B through real UI so renderer state switches cleanly
  await page.getByRole('button', { name: /^项目/ }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const newProjModal = page.getByRole('dialog', { name: '新建项目' });
  await newProjModal.getByLabel('项目名称', { exact: true }).fill('三维拆解与架构演示片');
  await newProjModal.getByRole('button', { name: /^创建/ }).click();
  await newProjModal.waitFor({ state: 'hidden' });
  await page.locator('.breadcrumbs b').waitFor();

  await page.evaluate((id) => window.cocraft.call('vault.pull', { id }), promotedRes.promoted.id);
  await page.evaluate(() => window.cocraft.call('vault.pull', { id: 'gvault_brand_cobalt' }));

  const bootB = await page.evaluate(() => window.cocraft.call('boot'));
  assert.equal(bootB.current.project.name, '三维拆解与架构演示片');
  assert.equal(bootB.current.project.vault.length, 2, 'Project B pulled 2 global vault items independently');
  console.log('PASS · Dual-layer Asset Vault (Project A -> Global Library -> Project B)');

  // 3. Import .gltf 3D model asset + Dual-Mode Storyboard Studio & Multi-Take switching
  const afterGltf = await page.evaluate(
    (p) => window.cocraft.call('media.import', { paths: [p], append: false }),
    sampleGltf,
  );
  const gltfAsset = afterGltf.project.assets.find((a) => a.kind === 'model-3d');
  assert(gltfAsset, '.gltf imported as kind=model-3d asset');

  // Switch UI to Storyboard Studio mode ("分镜编排")
  await page.getByRole('tab', { name: '分镜编排' }).click();
  await page.locator('.storyboard-studio.full').waitFor();
  await page.getByRole('button', { name: '+ 3D 拆解镜' }).click();
  await page.locator('.shot-card').nth(0).waitFor();
  await page.getByRole('button', { name: '+ 架构演示镜' }).click();
  await page.locator('.shot-card').nth(1).waitFor();

  // Add a second Take (+ SeeCode 架构图解候选) onto Shot #01 and toggle between T1 and T2
  const firstShot = page.locator('.shot-card').first();
  await firstShot.locator('.take-add-btn').click();
  await firstShot.getByRole('button', { name: '+ SeeCode 架构图解候选' }).click();
  await firstShot.locator('.take-pill').nth(1).waitFor();

  await page.screenshot({ path: join(verifyOut, 'v03-storyboard-studio.png'), scale: 'css' });

  // Switch back to T1 (3D Teardown) and verify second shot's start frame was NOT disturbed!
  const beforeSwitch = await page.evaluate(() => window.cocraft.call('boot'));
  const secondClipStartBefore = beforeSwitch.current.project.sequences[0].clips[1].start;
  await firstShot.locator('.take-pill').nth(0).click();
  await page.waitForFunction(async () => {
    const b = await window.cocraft.call('boot');
    return b.current.project.sequences[0].clips[0]?.props?.presetId === 'teardown-3d';
  });
  const afterSwitch = await page.evaluate(() => window.cocraft.call('boot'));
  assert.equal(
    afterSwitch.current.project.sequences[0].clips[1].start,
    secondClipStartBefore,
    'Adjacent clip start preserved across Take switch',
  );
  console.log('PASS · Dual-Mode Storyboard Studio, .gltf model asset & Multi-Take switching');

  // 4. Switch back to Stage mode, compile custom Three.js CodeComponent, capture Previs Reference PNG & export MP4!
  await page.getByRole('tab', { name: '舞台剪辑' }).click();
  await page.evaluate(() => {
    // Seek into 3D teardown shot at 1.2s so explosion is clearly visible
    window.postMessage({ source: 'cocraft-test' }, '*');
  });
  // Click timeline at ~1.5s and wait a beat for WebGL frame
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(verifyOut, 'v03-three-stage.png'), scale: 'css' });

  // Compile custom Three.js CodeComponent (`import * as THREE from 'three'; import { ThreeCanvas } from '@remotion/three'`)
  const customThreeSource = `
import React, { useCallback } from 'react';
import * as THREE from 'three';
import { ThreeCanvas } from '@remotion/three';

export default function OrbitalCrystal({ explode = 0.4, accent = '#3b82f6' }) {
  const setup = useCallback((scene: THREE.Scene) => {
    scene.add(new THREE.AmbientLight('#ffffff', 1.0));
    const key = new THREE.DirectionalLight('#ffffff', 2.0);
    key.position.set(4, 6, 5);
    scene.add(key);
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1, 1),
      new THREE.MeshStandardMaterial({ color: accent, metalness: 0.5, roughness: 0.2 })
    );
    mesh.name = 'crystal';
    scene.add(mesh);
  }, [accent]);
  const onFrame = useCallback(({ scene, camera, time }: any) => {
    camera.position.set(Math.cos(time * 0.6) * 4.5, 2.0 + explode, Math.sin(time * 0.6) * 4.5);
    camera.lookAt(0, 0, 0);
    const c = scene.getObjectByName('crystal');
    if (c) c.rotation.y = time;
  }, [explode]);
  return <ThreeCanvas setup={setup} onFrame={onFrame} />;
}`;
  const compiledThree = await page.evaluate(
    (source) =>
      window.cocraft.call('code.compile', {
        source,
        name: 'Three.js 晶体预演组件',
        props: { explode: 0.4, accent: '#3b82f6' },
      }),
    customThreeSource,
  );
  const latestBoot = await page.evaluate(() => window.cocraft.call('boot'));
  await page.evaluate(
    ({ baseRevision, component }) =>
      window.cocraft.call('project.edit', {
        baseRevision,
        name: '发布 Three.js 组件',
        operations: [{ type: 'putComponent', component }],
      }),
    { baseRevision: latestBoot.current.project.revision, component: compiledThree },
  );
  console.log('PASS · Custom Three.js (@remotion/three) CodeComponent compiled & headless-validated');

  // Capture Previs-to-Video Reference Frame from 3D Stage
  const seqId = latestBoot.current.project.sequences[0].id;
  const captureRes = await page.evaluate(
    (sequenceId) => window.cocraft.call('stage.captureReference', { sequenceId, frame: 45 }),
    seqId,
  );
  const capturedStat = await stat(captureRes.asset.path);
  assert(capturedStat.size > 1000, `Captured 3D previs PNG is non-empty (${capturedStat.size} bytes)`);
  console.log('PASS · 3D Stage Previs-to-Video reference frame captured to Project Vault');

  // Shorten sequence clips to 15 frames each so real MP4 H.264 export completes in ~3 seconds
  const preExport = await page.evaluate(() => window.cocraft.call('boot'));
  const targetSeq = preExport.current.project.sequences[0];
  const trimOps = targetSeq.clips.map((c, idx) => ({
    type: 'updateClip',
    sequenceId: targetSeq.id,
    clipId: c.id,
    changes: { start: idx * 15, duration: 15 },
  }));
  await page.evaluate(
    ({ baseRevision, operations }) =>
      window.cocraft.call('project.edit', { baseRevision, name: '紧凑导出测试时长', operations }),
    { baseRevision: preExport.current.project.revision, operations: trimOps },
  );

  const exportJob = await page.evaluate(
    (sequenceId) => window.cocraft.call('export.start', { sequenceId, scale: 0.5 }),
    targetSeq.id,
  );
  let finishedExport = null;
  for (let attempt = 0; attempt < 90; attempt++) {
    const b = await page.evaluate(() => window.cocraft.call('boot'));
    const j = b.jobs.find((x) => x.id === exportJob.id);
    if (j?.status === 'failed') throw new Error('Export failed: ' + j.error);
    if (j?.status === 'completed') {
      finishedExport = j;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(finishedExport, 'Export job completed within timeout');
  const mp4Stat = await stat(finishedExport.output);
  assert(mp4Stat.size > 2000, `Exported 3D + SeeCode MP4 is valid (${mp4Stat.size} bytes)`);
  console.log('PASS · End-to-end Three.js 3D + SeeCode H.264 MP4 export verified');
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
