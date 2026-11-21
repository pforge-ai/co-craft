import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyOperations,
  clone,
  createCompoundVaultItemFromClips,
  instantiateCompoundVaultItemOperations,
  newClip,
  newProject,
  parseSRTText,
  preflightSequence,
  prepareScopedComponentOperations,
  timecodeFrames,
  uid,
} from '../src/core/project';
import { ProjectStore } from '../electron/store';
import type { CodeComponent } from '../src/core/types';

console.log('Running Phase 1 Core & Store Unit Suite...');

// 1. Frame-accurate timecode
assert.equal(timecodeFrames(0, 30), '00:00:00');
assert.equal(timecodeFrames(75, 30), '00:02:15');
assert.equal(timecodeFrames(1805, 30), '01:00:05');

// 2. Hardened SRT parser (UTF-8 BOM, HTML/ASS tags, 1-frame rounding non-overlap)
const srtRaw = `\uFEFF1
00:00:01,000 --> 00:00:02,334
{\\an8}<i>第一句带样式标签</i>

2
00:00:02,333 --> 00:00:04,000
<b>紧接的第二句</b>
`;
const parsedCaptions = parseSRTText(srtRaw, 30);
assert.equal(parsedCaptions.length, 2);
assert.equal(parsedCaptions[0].props.text, '第一句带样式标签');
assert.equal(parsedCaptions[1].props.text, '紧接的第二句');
assert.ok(
  parsedCaptions[1].start >= parsedCaptions[0].start + parsedCaptions[0].duration,
  'Back-to-back subtitles must not overlap by 1 frame',
);

// 3. Track-aware smart ripple delete (deleting caption does NOT shift video; deleting visual keeps spanning bed music intact)
{
  const p = newProject('RippleTest');
  const seq = p.sequences[0];
  p.assets.push(
    { id: 'a_vid', name: 'v.mp4', kind: 'video', path: '/tmp/v.mp4', duration: 20, createdAt: '' },
    { id: 'a_bgm', name: 'bgm.wav', kind: 'audio', path: '/tmp/bgm.wav', duration: 20, createdAt: '' },
  );
  const v1 = { ...newClip('video', 0, 'a_vid'), duration: 90 };
  const v2 = { ...newClip('video', 90, 'a_vid'), duration: 90 };
  const cap1 = { ...newClip('caption', 0), duration: 30 };
  const cap2 = { ...newClip('caption', 60), duration: 30 };
  const bgm = { ...newClip('audio', 0, 'a_bgm'), duration: 300 };
  seq.clips = [v1, v2, cap1, cap2, bgm];

  // Ripple deleting cap1 ONLY shifts cap2, leaving v2 at 90!
  const afterCapRipple = applyOperations(p, [
    { type: 'deleteClip', sequenceId: seq.id, clipId: cap1.id, ripple: true },
  ]);
  assert.equal(afterCapRipple.sequences[0].clips.find((c) => c.id === v2.id)!.start, 90);
  assert.equal(afterCapRipple.sequences[0].clips.find((c) => c.id === cap2.id)!.start, 30);

  // Ripple deleting v1 shifts v2 (90 -> 0), while spanning bgm starting at 0 stays at 0!
  const afterVidRipple = applyOperations(p, [
    { type: 'deleteClip', sequenceId: seq.id, clipId: v1.id, ripple: true },
  ]);
  assert.equal(afterVidRipple.sequences[0].clips.find((c) => c.id === v2.id)!.start, 0);
  assert.equal(afterVidRipple.sequences[0].clips.find((c) => c.id === bgm.id)!.start, 0);
}

// 4. Strict EditScope enforcement for Agent edits
{
  const p = newProject('ScopeTest');
  const seq1 = p.sequences[0];
  const seq2 = { ...structuredClone(seq1), id: uid('seq'), name: '竖版' };
  const c1 = newClip('title', 0);
  const c2 = newClip('title', 150);
  seq1.clips = [c1, c2];
  p.sequences.push(seq2);

  // Rejects modifying c2 when strict scope only permits c1
  assert.throws(
    () =>
      applyOperations(
        p,
        [{ type: 'updateClip', sequenceId: seq1.id, clipId: c2.id, changes: { props: { text: '越界' } } }],
        'agent',
        { sequenceId: seq1.id, clipIds: [c1.id], strict: true },
      ),
    /范围/,
  );

  // Rejects modifying seq2 when strict scope only permits seq1
  assert.throws(
    () =>
      applyOperations(
        p,
        [{ type: 'updateSequence', sequenceId: seq2.id, changes: { background: '#000000' } }],
        'agent',
        { sequenceId: seq1.id, strict: true },
      ),
    /范围/,
  );

  // Allows modifying c1 within scope
  const allowed = applyOperations(
    p,
    [{ type: 'updateClip', sequenceId: seq1.id, clipId: c1.id, changes: { props: { text: '合规修改' } } }],
    'agent',
    { sequenceId: seq1.id, clipIds: [c1.id], strict: true },
  );
  assert.equal(allowed.sequences[0].clips[0].props.text, '合规修改');
}

// 5. Component Copy-on-Write across sequences (no silent cross-sequence mutation)
{
  const p = newProject('CoWTest');
  const comp: CodeComponent = {
    id: 'comp_shared',
    name: '共享标题',
    source: 'v1',
    compiled: 'v1',
    hash: 'h1',
    props: { text: 'v1' },
  };
  p.components.push(comp);
  const s1 = p.sequences[0];
  const clip1 = { ...newClip('code', 0), componentId: comp.id };
  s1.clips = [clip1];
  const s2 = {
    ...structuredClone(s1),
    id: uid('seq'),
    name: '竖版',
    clips: [{ ...newClip('code', 0), componentId: comp.id }],
  };
  p.sequences.push(s2);

  const updatedComp: CodeComponent = { ...comp, source: 'v2', compiled: 'v2', hash: 'h2' };
  const ops = prepareScopedComponentOperations(p, s1.id, updatedComp, clip1.id);
  const next = applyOperations(p, ops, 'you');
  assert.equal(next.components.length, 2, 'Forked new component instead of overwriting shared one');
  assert.notEqual(next.sequences[0].clips[0].componentId, comp.id);
  assert.equal(next.sequences[1].clips[0].componentId, comp.id, 'Other sequence keeps original component untouched');
}

// 6. Preflight check & O(1) revisions-index + legacy migration + offline relink
{
  const dir = await mkdtemp(join(tmpdir(), 'cocraft-unit-p1-'));
  try {
    const mediaFile = join(dir, 'sample.png');
    await writeFile(mediaFile, 'fake-bytes');
    const store = new ProjectStore(join(dir, 'proj.cocraft'));
    const p = newProject('Preflight & Index');
    p.assets.push({
      id: 'asset_1',
      name: 'sample.png',
      kind: 'image',
      path: mediaFile,
      duration: 5,
      createdAt: '',
    });
    const imgClip = { ...newClip('image', 60, 'asset_1'), duration: 90 }; // Starts at frame 60 -> 2s leading gap!
    p.sequences[0].clips.push(imgClip);
    await store.init(p);

    assert.ok(existsSync(join(store.path, '.cocraft', 'revisions-index.json')), 'revisions-index.json created');
    let env = await store.envelope();
    assert.deepEqual(env.offlineAssetIds, []);

    // Leading gap warning detected, zero blockers
    const onlineIssues = preflightSequence(env.project, env.project.sequences[0].id, env.offlineAssetIds);
    assert.equal(onlineIssues.filter((i) => i.severity === 'blocker').length, 0);
    assert.ok(onlineIssues.some((i) => i.severity === 'warning' && i.id.startsWith('gap-')));

    // Simulate file moved/deleted -> offline blocker!
    await rm(mediaFile);
    env = await store.envelope();
    assert.deepEqual(env.offlineAssetIds, ['asset_1']);
    const offlineIssues = preflightSequence(env.project, env.project.sequences[0].id, env.offlineAssetIds);
    assert.ok(offlineIssues.some((i) => i.severity === 'blocker' && i.assetId === 'asset_1'));

    // Simulate legacy project migration (remove revisions-index.json and re-open)
    await rm(join(store.path, '.cocraft', 'revisions-index.json'));
    const migratedEnv = await new ProjectStore(store.path).envelope();
    assert.equal(migratedEnv.revisions.length, 1);
    assert.ok(existsSync(join(store.path, '.cocraft', 'revisions-index.json')), 'revisions-index rebuilt automatically');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 5. v0.5 Regression Suite: Shot Reorder Caption Sync, Strict Reorder Scope, Contiguous Backdrop Partition & Multi-Caption Clean
{
  const {
    computeCompositeShots,
    computePrimaryTimelineShots,
    moveCompositeShotOperations,
    scriptOutlineToShotOperations,
    updateShotScriptOperations,
  } = await import('../src/core/storyboard');
  const { newProject, applyOperations, newClip } = await import('../src/core/project');

  // 5a. 3-line outline -> move Shot 1 forward -> visuals AND captions stay 100% matched!
  let p = newProject('换序回归');
  const seqId = p.sequences[0].id;
  p = applyOperations(p, scriptOutlineToShotOperations(p.sequences[0], '甲镜画面与台词\n乙镜画面与台词\n丙镜画面与台词'));
  let shots = computeCompositeShots(p.sequences[0]);
  assert.equal(shots.length, 3);
  const moveOps = moveCompositeShotOperations(p.sequences[0], shots, shots[0].id, 1);
  p = applyOperations(p, moveOps);
  shots = computeCompositeShots(p.sequences[0]);
  assert.ok(shots[0].anchorClip.name.includes('乙镜'), 'Shot 2 moved to index 0');
  assert.equal(shots[0].scriptText, '乙镜画面与台词', 'Shot 2 caption moved to index 0 alongside Shot 2 visual');
  assert.ok(shots[1].anchorClip.name.includes('甲镜'), 'Shot 1 moved to index 1');
  assert.equal(shots[1].scriptText, '甲镜画面与台词', 'Shot 1 caption moved to index 1 alongside Shot 1 visual');

  // 5b. Core reorderClips ALSO moves synced captions & overlays atomically, AND strict clip scope blocks reorderClips!
  const vClips = p.sequences[0].clips.filter((c) => c.track === 'visual').sort((a, b) => a.start - b.start);
  assert.throws(
    () =>
      applyOperations(
        p,
        [{ type: 'reorderClips', sequenceId: seqId, orderedClipIds: [vClips[1].id, vClips[0].id, vClips[2].id] }],
        'agent',
        { sequenceId: seqId, clipIds: [vClips[0].id], strict: true },
      ),
    /仅改此处/,
    'Strict clip scope MUST reject reorderClips touching other shots',
  );
  // Authorized reorderClips shifts captions in lockstep
  p = applyOperations(p, [
    { type: 'reorderClips', sequenceId: seqId, orderedClipIds: [vClips[1].id, vClips[0].id, vClips[2].id] },
  ]);
  const reorderedShots = computeCompositeShots(p.sequences[0]);
  assert.ok(reorderedShots[0].anchorClip.name.includes('甲镜'));
  assert.equal(reorderedShots[0].scriptText, '甲镜画面与台词', 'Core reorderClips shifted companion captions');

  // 5c. 10s backdrop + 2 overlapping short titles -> full contiguous 0..10s coverage, zero overlaps!
  let p2 = newProject('长底图分区');
  const s2 = p2.sequences[0].id;
  const bg = { ...newClip('image', 0, 'bg_1'), id: 'bg_10s', track: 'visual' as const, duration: 300, name: '10秒底图' };
  const t1 = { ...newClip('title', 60), id: 'ov_t1', track: 'overlay' as const, duration: 105, name: '短标题一' };
  const t2 = { ...newClip('title', 150), id: 'ov_t2', track: 'overlay' as const, duration: 90, name: '短标题二' };
  const cOld1 = { ...newClip('caption', 60), id: 'cap_a', duration: 50, props: { text: '第一句旧词' } };
  const cOld2 = { ...newClip('caption', 120), id: 'cap_b', duration: 60, props: { text: '第二句旧词' } };
  p2 = applyOperations(p2, [
    {
      type: 'addAsset',
      asset: { id: 'bg_1', name: 'bg.png', kind: 'image', path: '/tmp/bg.png', duration: 10, width: 1920, height: 1080 },
    },
    { type: 'addClip', sequenceId: s2, clip: bg },
    { type: 'addClip', sequenceId: s2, clip: t1 },
    { type: 'addClip', sequenceId: s2, clip: t2 },
    { type: 'addClip', sequenceId: s2, clip: cOld1 },
    { type: 'addClip', sequenceId: s2, clip: cOld2 },
  ]);
  const bgShots = computeCompositeShots(p2.sequences[0]);
  assert.equal(bgShots[0].start, 0, 'Backdrop head 0..2s has its own shot card');
  assert.equal(bgShots.at(-1)!.start + bgShots.at(-1)!.duration, 300, 'Backdrop tail ..10s has its own shot card');
  for (let i = 1; i < bgShots.length; i++) {
    assert.ok(bgShots[i].start >= bgShots[i - 1].start + bgShots[i - 1].duration, 'Zero overlapping shot cards');
  }

  // 5d. Editing script on a shot with 2 captions updates 1st and deletes stale 2nd!
  const midShot = bgShots.find((sh) => sh.captionClips.length === 2)!;
  assert.ok(midShot, 'Middle shot captured both captions');
  p2 = applyOperations(p2, updateShotScriptOperations(p2.sequences[0], midShot, '整镜合并后的新台词'));
  const remainingCaps = p2.sequences[0].clips.filter((c) => c.kind === 'caption');
  assert.equal(remainingCaps.length, 1, 'Stale second caption deleted cleanly');
  assert.equal(remainingCaps[0].props.text, '整镜合并后的新台词');

  // 5e. Built-in Style Switch mutates unlocked clips & sequence background while preserving locked clips!
  // Also computeCompositeShots preserves non-background visual anchor when code overlay is present.
  const { createPresetClip } = await import('../src/core/presets');
  let pTheme = newProject('换肤与锚点测试');
  const sThemeId = pTheme.sequences[0].id;
  const unlockedRig = { ...createPresetClip('seecode-architecture', 0, 30), id: 'rig_unlocked' };
  const lockedRig = {
    ...createPresetClip('screen-focus-rig', 150, 30),
    id: 'rig_locked',
    locked: true,
  };
  pTheme = applyOperations(pTheme, [
    { type: 'addClip', sequenceId: sThemeId, clip: unlockedRig },
    { type: 'addClip', sequenceId: sThemeId, clip: lockedRig },
    { type: 'setActiveBrand', itemId: 'gstyle_warm_paper' },
  ]);
  const updatedUnlocked = pTheme.sequences[0].clips.find((c) => c.id === 'rig_unlocked')!;
  const untouchedLocked = pTheme.sequences[0].clips.find((c) => c.id === 'rig_locked')!;
  assert.equal(pTheme.activeBrandId, 'gstyle_warm_paper');
  assert.equal(updatedUnlocked.props.surface, 'light', 'Unlocked preset switches to warm-paper light surface');
  assert.equal(updatedUnlocked.props.accent, '#2563eb', 'Unlocked preset inherits warm-paper accent');
  assert.equal(untouchedLocked.props.surface, 'dark', 'Locked clip retains original dark surface');
  assert.equal(untouchedLocked.props.accent, '#3b82f6', 'Locked clip retains original accent');
  // Sequence without locked clip also updates sequence.background
  let pClean = applyOperations(newProject('纯未锁换肤'), [
    { type: 'addClip', sequenceId: 'seq_test', clip: { ...createPresetClip('seecode-architecture', 0, 30), id: 'c1' } },
  ].filter(() => false));
  pClean = applyOperations(pClean, [{ type: 'setActiveBrand', itemId: 'gstyle_warm_paper' }]);
  assert.equal(pClean.sequences[0].background, '#fbf9f3', 'Clean sequence background updates to style bg');

  // Non-background visual shot + overlapping overlay code clip keeps visual shot as anchorClip!
  // Background-only visual shot + overlapping overlay code clip promotes overlay code as anchorClip!
  let pAnchor = newProject('锚点保持');
  const sAnch = pAnchor.sequences[0].id;
  const mainVisual = { ...createPresetClip('teardown-3d', 0, 30), id: 'vis_3d', track: 'visual' as const };
  const bgVisual = { ...createPresetClip('gradient-orbit', 240, 30), id: 'vis_bg', track: 'visual' as const };
  const ovCode = {
    ...newClip('code', 0),
    id: 'ov_code',
    track: 'overlay' as const,
    componentId: 'comp_anchor_test',
    duration: 180,
    name: '代码角标',
  };
  const ovCodeOnBg = {
    ...newClip('code', 240),
    id: 'ov_code_bg',
    track: 'overlay' as const,
    componentId: 'comp_anchor_test',
    duration: 180,
    name: '背景上代码组件',
  };
  pAnchor = applyOperations(pAnchor, [
    {
      type: 'putComponent',
      component: {
        id: 'comp_anchor_test',
        name: '测试角标',
        path: 'components/test.tsx',
        source: 'export default () => null',
        bundle: 'export default () => null',
        props: {},
        version: 1,
        updatedAt: '2026-11-18T00:00:00.000Z',
      },
    },
    { type: 'addClip', sequenceId: sAnch, clip: mainVisual },
    { type: 'addClip', sequenceId: sAnch, clip: ovCode },
    { type: 'addClip', sequenceId: sAnch, clip: bgVisual },
    { type: 'addClip', sequenceId: sAnch, clip: ovCodeOnBg },
  ]);
  const anchorShots = computeCompositeShots(pAnchor.sequences[0]);
  assert.equal(anchorShots[0].anchorClip.id, 'vis_3d', 'Non-background visual remains shot anchor despite code overlay');
  assert.equal(anchorShots[1].anchorClip.id, 'ov_code_bg', 'Overlay code becomes anchor over pure background shape');

  // 5f. Clip transitionIn apply, validation & removal
  let pTr = applyOperations(pAnchor, [
    {
      type: 'updateClip',
      sequenceId: sAnch,
      clipId: 'vis_3d',
      changes: { transitionIn: { type: 'dissolve', durationFrames: 18 } },
    },
  ]);
  assert.equal(pTr.sequences[0].clips.find((c) => c.id === 'vis_3d')?.transitionIn?.type, 'dissolve');
  assert.throws(
    () =>
      applyOperations(pTr, [
        {
          type: 'updateClip',
          sequenceId: sAnch,
          clipId: 'vis_3d',
          changes: { transitionIn: { type: 'fade', durationFrames: 0 } },
        },
      ]),
    /转场时长/,
    'Invalid 0-frame transitionIn rejected',
  );
  pTr = applyOperations(pTr, [
    {
      type: 'updateClip',
      sequenceId: sAnch,
      clipId: 'vis_3d',
      changes: { transitionIn: null },
    },
  ]);
  assert.equal(pTr.sequences[0].clips.find((c) => c.id === 'vis_3d')?.transitionIn, undefined, 'transitionIn cleared cleanly');

  // 5g. Default title visibility (no CREATED WITH COCRAFT, no frame-0 fade) & primary timeline shots do not fragment over overlays
  const blankTitle = newClip('title', 0);
  assert.equal(blankTitle.props.animation, 'none', 'New title defaults to animation=none so frame 0 is visible');
  assert.equal(blankTitle.props.subtitle, undefined, 'New title has no hardcoded CREATED WITH COCRAFT watermark');
  const primaryShots = computePrimaryTimelineShots(p2.sequences[0]);
  assert.equal(primaryShots.length, 1, 'computePrimaryTimelineShots keeps 1 continuous shot despite 2 short overlay titles');
  assert.equal(primaryShots[0].anchorClip.id, 'bg_10s');

  // 5h. Compound clip save/instantiate, asset derivedFrom lineage, canvasGroups, and removeAsset guard
  let pComp = clone(p2);
  pComp = applyOperations(pComp, [
    {
      type: 'addAsset',
      asset: {
        id: 'bg_asset',
        name: 'bg.mp4',
        kind: 'video',
        path: 'assets/bg.mp4',
        duration: 10,
        width: 1280,
        height: 720,
        hasAudio: true,
      },
    },
    {
      type: 'addAsset',
      asset: {
        id: 'ast_derived_target',
        name: '参考衍生图.png',
        kind: 'image',
        path: 'assets/ref.png',
        duration: 5,
        width: 1280,
        height: 720,
        hasAudio: false,
      },
    },
  ]);
  const sCompId = pComp.sequences[0].id;
  const trimmedVis = {
    ...newClip('video', 60, 'bg_asset'),
    id: 'clip_trim_vis',
    name: '精剪主镜',
    duration: 90,
    sourceIn: 15,
    transitionIn: { type: 'dissolve' as const, durationFrames: 15 },
    props: { saturation: 120 },
  };
  const syncedOv = {
    ...newClip('title', 90),
    id: 'clip_trim_ov',
    name: '精剪叠加',
    duration: 45,
    props: { text: '精剪叠加' },
  };
  pComp = applyOperations(pComp, [
    { type: 'addClip', sequenceId: sCompId, clip: trimmedVis },
    { type: 'addClip', sequenceId: sCompId, clip: syncedOv },
  ]);
  const compItem = createCompoundVaultItemFromClips(pComp, pComp.sequences[0], [trimmedVis, syncedOv], '海岸双层精剪包');
  assert.equal(compItem.entityKind, 'compound', 'Compound item entityKind preserved');
  assert.equal(compItem.subkind, 'compound-clip', 'Compound item subkind preserved');
  assert.equal(compItem.compound?.clips.length, 2, 'Compound snapshot captures both clips');
  assert.equal(compItem.compound?.clips[0].start, 0, 'Compound normalizes earliest clip to start=0');
  assert.equal(compItem.compound?.clips[1].start, 30, 'Compound preserves relative overlay offset');
  assert.equal(compItem.compound?.clips[0].sourceIn, 15, 'Compound preserves sourceIn trim');
  assert.equal(compItem.compound?.clips[0].transitionIn?.type, 'dissolve', 'Compound preserves transitionIn');
  assert.equal(compItem.compound?.clips[0].props.saturation, 120, 'Compound preserves styling/color props');
  assert.equal(compItem.derivedFrom?.[0]?.via, 'compound-save', 'Compound records derivedFrom lineage');

  pComp = applyOperations(pComp, [
    { type: 'putVaultItem', item: compItem },
    {
      type: 'updateProject',
      changes: {
        canvasGroups: [
          {
            id: 'grp_unit_1',
            name: '海岸灵感组',
            nodeIds: ['asset:ast_derived_target', `ent:${compItem.id}`],
            createdAt: new Date().toISOString(),
          },
        ],
      },
    },
    {
      type: 'updateAssetMeta',
      assetId: 'ast_derived_target',
      changes: {
        derivedFrom: [{ assetId: 'bg_asset', via: 'manual-ref', note: '风格锚点连线' }],
      },
    },
  ]);
  assert.equal(pComp.canvasGroups?.length, 1, 'canvasGroups persisted via applyOperations');
  assert.equal(
    pComp.assets.find((a) => a.id === 'ast_derived_target')?.derivedFrom?.[0]?.assetId,
    'bg_asset',
    'derivedFrom lineage persisted via updateAssetMeta',
  );
  const pNoClip = applyOperations(pComp, [{ type: 'deleteClip', sequenceId: sCompId, clipId: 'clip_trim_vis' }]);
  assert.throws(
    () => applyOperations(pNoClip, [{ type: 'removeAsset', assetId: 'bg_asset' }]),
    /状态变体或组合包引用/,
    'removeAsset guards assets referenced by compound bundle after timeline clip is deleted',
  );

  const { operations: instOps, primaryClipId } = instantiateCompoundVaultItemOperations(sCompId, compItem, 300, 30);
  assert.equal(instOps.length, 2, 'Instantiate creates addClip ops for all layers');
  assert.ok(primaryClipId && primaryClipId !== trimmedVis.id, 'Instantiate mints fresh clip IDs');
  const beforeInstCount = pComp.sequences[0].clips.length;
  pComp = applyOperations(pComp, instOps);
  assert.equal(pComp.sequences[0].clips.length, beforeInstCount + 2, 'Compound clips appended cleanly to sequence');
  const reInserted = pComp.sequences[0].clips.find((c) => c.id === primaryClipId);
  assert.equal(reInserted?.start, 300, 'Instantiated compound placed at target playhead frame');
  assert.equal(reInserted?.sourceIn, 15, 'Instantiated compound preserved trim sourceIn');
  assert.equal(reInserted?.transitionIn?.type, 'dissolve', 'Instantiated compound preserved transitionIn');
}

console.log('PASS · all Phase 1 + v0.5 core regression tests (timecode, SRT, ripple, strict reorder scope, shot-caption sync, contiguous partition, style theming, composite anchor, transitions, compound assets, canvasGroups & derivedFrom)');
