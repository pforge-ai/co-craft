import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyOperations,
  clone,
  createCompoundVaultItemFromClips,
  detachAudioFromClipOperations,
  instantiateCompoundVaultItemOperations,
  newClip,
  newProject,
  parseSRTText,
  preflightSequence,
  prepareScopedComponentOperations,
  splitOperations,
  timecodeFrames,
  uid,
} from '../src/core/project';
import {
  applyKeyframeEasing,
  buildAudioDuckingKeyframes,
  buildKenBurnsKeyframes,
  KEYFRAME_PROPERTY_RANGES,
  evaluateKeyframeTrack,
  moveClipKeyframeFrame,
  removeClipKeyframe,
  resolveClipPropsAtFrame,
  scaleKeyframesForFps,
  splitKeyframesForSplit,
  upsertClipKeyframe,
} from '../src/core/keyframes';
import {
  DEFAULT_DIRECTOR_SHOTS,
  DEFAULT_SPATIAL_BOOKMARKS,
  buildMotionShotKeyframes,
  buildSpatialStageProps,
  computeActorPathState,
  computeDirectorCameraOverride,
  computeParallaxLayerLayout,
  computeParallaxPlaneScale,
  computeSpatialCameraPose,
  computeStageSceneSignature,
  createDirectorShot,
  createStageObject,
  isSpatialClip,
  isSplatAssetPath,
  kelvinToHex,
  lensMmToFov,
  normalizeCameraBookmarks,
  normalizeStageShots,
  shotsToCameraBookmarks,
} from '../src/core/spatialStage';
import { ProjectStore } from '../electron/store';
import type { Asset, CodeComponent } from '../src/core/types';
import {
  filterPresets,
  filterStudioMediaByKind,
  filterTransitions,
  matchCatalogText,
} from '../src/core/catalog';
import {
  detectActiveLayoutPreset,
  matchMentionTrigger,
  parseTimecodeInput,
} from '../src/lib/workbenchState';
import {
  CANVAS_LANE_TOP,
  computeTidyCanvasLayout,
  estimateCanvasNodeSize,
  formatAssetCardMeta,
  formatCanvasDisplayName,
  resolveNonOverlappingCanvasLayout,
} from '../src/lib/canvasLayout';

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

  // 5c. Unified Pro-NLE Storyboard Model: 10s visual + 2 short overlays stays ONE shot in BOTH computeCompositeShots and computePrimaryTimelineShots!
  let p2 = newProject('长底图统一分镜');
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
  assert.equal(bgShots.length, 1, 'Unified NLE model keeps 1 primary visual shot even with 2 short overlays');
  assert.equal(bgShots[0].start, 0);
  assert.equal(bgShots[0].duration, 300);
  assert.equal(bgShots[0].captionClips.length, 2, 'Shot captures both timed captions');

  // 5d. Per-line timed caption edit preserves start/duration; explicit merge rewrite collapses extras!
  const { updateSingleCaptionTextOperations, stripExplicitListMarker } = await import('../src/core/storyboard');
  const pPerLine = applyOperations(
    p2,
    updateSingleCaptionTextOperations(p2.sequences[0], cOld1, '第一句改标点。'),
  );
  const perLineCaps = pPerLine.sequences[0].clips.filter((c) => c.kind === 'caption').sort((a, b) => a.start - b.start);
  assert.equal(perLineCaps.length, 2, 'Per-line caption edit keeps both timed lines');
  assert.equal(perLineCaps[0].start, 60);
  assert.equal(perLineCaps[0].duration, 50);
  assert.equal(perLineCaps[0].props.text, '第一句改标点。');
  assert.equal(perLineCaps[1].start, 120);
  assert.equal(perLineCaps[1].duration, 60);

  p2 = applyOperations(
    p2,
    updateShotScriptOperations(p2.sequences[0], bgShots[0], '整镜合并后的新台词', { resetTiming: true }),
  );
  const remainingCaps = p2.sequences[0].clips.filter((c) => c.kind === 'caption');
  assert.equal(remainingCaps.length, 1, 'Explicit merge rewrite deletes extra captions cleanly');
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

  // 6. Wave B Core Regressions: numeric preservation, lock-safe relink, audio attachment, spanning watermark, split transitionIn, trailing preflight, cross-FPS compound
  // 6a. Review #3: Numeric prefix preservation & explicit list marker stripping
  assert.equal(stripExplicitListMarker('2026 年首次亮相'), '2026 年首次亮相');
  assert.equal(stripExplicitListMarker('3.5 倍光学变焦'), '3.5 倍光学变焦');
  assert.equal(stripExplicitListMarker('35mm 镜头拍摄'), '35mm 镜头拍摄');
  assert.equal(stripExplicitListMarker('100% 回收材料'), '100% 回收材料');
  assert.equal(stripExplicitListMarker('-15℃ 低温测试'), '-15℃ 低温测试');
  assert.equal(stripExplicitListMarker('1. 第一镜开场'), '第一镜开场');
  assert.equal(stripExplicitListMarker('2、第二镜转折'), '第二镜转折');
  assert.equal(stripExplicitListMarker('- 要点一'), '要点一');

  // 6b. Review #1: Content-fingerprinted lock-safe relink (same sha256 allowed on locked clip; different sha256 rejected!)
  let pRelink = newProject('锁定重连');
  pRelink = applyOperations(pRelink, [
    {
      type: 'addAsset',
      asset: {
        id: 'ast_blue',
        name: 'blue.mp4',
        kind: 'video',
        path: '/tmp/old-blue.mp4',
        duration: 4,
        sha256: 'hash_blue_123',
        byteSize: 1000,
        createdAt: '',
      },
    },
    {
      type: 'addClip',
      sequenceId: pRelink.sequences[0].id,
      clip: { ...newClip('video', 0, 'ast_blue'), id: 'clip_blue', duration: 60, locked: true },
    },
  ]);
  const pRelinkSame = applyOperations(pRelink, [
    { type: 'relinkAsset', assetId: 'ast_blue', path: '/tmp/moved-blue.mp4', sha256: 'hash_blue_123', byteSize: 1000 },
  ]);
  assert.equal(pRelinkSame.assets[0].path, '/tmp/moved-blue.mp4', 'Identical SHA-256 recovers transparently on locked clip');
  assert.throws(
    () =>
      applyOperations(pRelink, [
        { type: 'relinkAsset', assetId: 'ast_blue', path: '/tmp/green.mp4', sha256: 'hash_green_999', byteSize: 1000 },
      ]),
    /禁止替换为不同内容/,
    'Different SHA-256 MUST be rejected when asset is referenced by locked clip',
  );

  // 6c. Review #5 + Spanning overlay: shot-attached SFX moves atomically, timeline BGM stays pinned, spanning watermark does NOT block reorder!
  let pAudio = newProject('随镜声音与跨镜水印');
  const sAud = pAudio.sequences[0].id;
  pAudio = applyOperations(pAudio, [
    { type: 'addAsset', asset: { id: 'a_vid', name: 'v.mp4', kind: 'video', path: '/tmp/v.mp4', duration: 10, createdAt: '' } },
    { type: 'addAsset', asset: { id: 'a_sfx', name: 'cue.wav', kind: 'audio', path: '/tmp/cue.wav', duration: 1, createdAt: '' } },
    { type: 'addAsset', asset: { id: 'a_bgm', name: 'bgm.wav', kind: 'audio', path: '/tmp/bgm.wav', duration: 10, createdAt: '' } },
    { type: 'addClip', sequenceId: sAud, clip: { ...newClip('video', 0, 'a_vid'), id: 'v_shot1', duration: 60, sourceIn: 0 } },
    { type: 'addClip', sequenceId: sAud, clip: { ...newClip('video', 60, 'a_vid'), id: 'v_shot2', duration: 60, sourceIn: 60 } },
    { type: 'addClip', sequenceId: sAud, clip: { ...newClip('audio', 5, 'a_sfx'), id: 'aud_sfx', duration: 15, audioAttachMode: 'shot' } },
    { type: 'addClip', sequenceId: sAud, clip: { ...newClip('audio', 0, 'a_bgm'), id: 'aud_bgm', duration: 300, audioAttachMode: 'timeline' } },
    { type: 'addClip', sequenceId: sAud, clip: { ...newClip('title', 0), id: 'ov_watermark', track: 'overlay', duration: 120, props: { text: 'WM' } } },
  ]);
  const audShots = computeCompositeShots(pAudio.sequences[0]);
  assert.equal(audShots.length, 2);
  assert.equal(audShots[0].audioClips.length, 1, 'Shot 1 owns shot-attached SFX');
  assert.equal(audShots[0].spanningOverlays.length, 1, 'Watermark classified as spanning overlay');
  const swapAudioOps = moveCompositeShotOperations(pAudio.sequences[0], audShots, audShots[0].id, 1);
  assert.ok(swapAudioOps.length > 0, 'Spanning watermark does NOT block shot reorder');
  pAudio = applyOperations(pAudio, swapAudioOps);
  assert.equal(pAudio.sequences[0].clips.find((c) => c.id === 'v_shot1')!.start, 60);
  assert.equal(pAudio.sequences[0].clips.find((c) => c.id === 'aud_sfx')!.start, 65, 'Shot-attached SFX moved with Shot 1 preserving 5f offset');
  assert.equal(pAudio.sequences[0].clips.find((c) => c.id === 'aud_bgm')!.start, 0, 'Timeline BGM stayed pinned at 0');
  assert.equal(pAudio.sequences[0].clips.find((c) => c.id === 'ov_watermark')!.start, 0, 'Spanning watermark stayed pinned at 0');

  // 6d. Review #10: Preflight detects 6s empty tail (4s video + 10s BGM) & splitOperations clears transitionIn on second half
  const tailIssues = preflightSequence(pAudio, sAud, []);
  assert.ok(tailIssues.some((i) => i.id.startsWith('gap-tail-')), 'Preflight catches 6s empty tail after 4s visual + 10s BGM');
  const { splitOperations } = await import('../src/core/project');
  const clipToSplit = pAudio.sequences[0].clips.find((c) => c.id === 'v_shot1')!;
  const splitOps = splitOperations(
    pAudio.sequences[0],
    { ...clipToSplit, transitionIn: { type: 'dissolve', durationFrames: 15 } },
    clipToSplit.start + 30,
  );
  const secondHalfOp = splitOps[1];
  assert.equal(secondHalfOp.type, 'addClip');
  assert.equal(secondHalfOp.clip.transitionIn, undefined, 'splitOperations does not duplicate transitionIn onto second half');

  // 6e. Cross-FPS compound scaling (30fps -> 60fps scales sourceIn & transitionIn.durationFrames)
  const inst60 = instantiateCompoundVaultItemOperations(sCompId, compItem, 0, 60);
  const vis60 = (inst60.operations[0] as any).clip;
  assert.equal(vis60.sourceIn, 30, 'sourceIn 15@30fps scales to 30@60fps');
  assert.equal(vis60.transitionIn.durationFrames, 30, 'transitionIn 15f@30fps scales to 30f@60fps');
}

// 7. Wave C: Shared catalog search engine (Review #13) + Workbench helpers (Reviews #16/#19/#20)
{
  // 7a. Multi-token & keyword matching across AssetExplorer & ResourceLibrary
  assert.equal(matchCatalogText('', 'anything'), true);
  assert.equal(matchCatalogText('声学 示波器', '声场 · 相位实验', ['声学', '示波器']), true);
  assert.equal(matchCatalogText('声学 不存在词', '声场 · 相位实验', ['声学', '示波器']), false);

  const byKeyword = filterPresets('示波器');
  assert.ok(byKeyword.some((p) => p.id === 'phase-study'), 'filterPresets matches preset keywords');
  assert.equal(filterPresets('__不存在的关键词_xyz__').length, 0, 'Empty search returns 0 presets');

  // Carrier separation on studio media (images vs audio never mixed)
  const mockStudio: Asset[] = [
    { id: 's-photo', name: '有轨电车', kind: 'image', path: '/a.jpg', duration: 0, createdAt: '' },
    { id: 's-sfx', name: '卡片轻巧弹出', kind: 'audio', path: '/b.wav', duration: 0.3, createdAt: '' },
  ];
  const splitAll = filterStudioMediaByKind(mockStudio, '');
  assert.equal(splitAll.visual.length, 1);
  assert.equal(splitAll.audio.length, 1);
  assert.equal(splitAll.visual[0].id, 's-photo');
  assert.equal(splitAll.audio[0].id, 's-sfx');
  const splitAudioOnly = filterStudioMediaByKind(mockStudio, '音效');
  assert.equal(splitAudioOnly.visual.length, 0);
  assert.equal(splitAudioOnly.audio.length, 1);

  assert.ok(filterTransitions('叠化').length >= 1, 'filterTransitions matches Chinese transition name');
  assert.equal(filterTransitions('__nonexistent__').length, 0);

  // 7b. Chinese @ trigger without space (Review #16) while ignoring email addresses
  assert.equal(matchMentionTrigger('给这个镜头加@林夏'), '@林夏');
  assert.equal(matchMentionTrigger('用/新建分支'), '/新建分支');
  assert.equal(matchMentionTrigger('contact foo@bar.com'), null);

  // 7c. Timecode parser (Review #20)
  assert.equal(parseTimecodeInput('70', 30), 70);
  assert.equal(parseTimecodeInput('70f', 30), 70);
  assert.equal(parseTimecodeInput('2.5s', 30), 75);
  assert.equal(parseTimecodeInput('01:02:15', 30), 1875);
  assert.equal(parseTimecodeInput('00:02.5', 30), 75);
  assert.equal(parseTimecodeInput('invalid', 30), null);

  // 7d. Workspace layout preset detection (Review #19)
  assert.equal(
    detectActiveLayoutPreset({ showNav: false, showBottom: true, showRight: false, rightTab: 'inspector' }),
    'focus',
  );
  assert.equal(
    detectActiveLayoutPreset({ showNav: true, showBottom: true, showRight: true, rightTab: 'inspector' }),
    'edit',
  );
  assert.equal(
    detectActiveLayoutPreset({ showNav: false, showBottom: true, showRight: true, rightTab: 'agent' }),
    'collab',
  );

  // 7e. CreateCanvas Option B: collision-free layout, card meta, tidy layout & group/hidden persistence
  assert.equal(formatCanvasDisplayName('海岸公路.svg'), '海岸公路');
  assert.equal(formatCanvasDisplayName('山脊柔光晨雾 · 18.4s', true), '山脊柔光晨雾');
  assert.equal(
    formatAssetCardMeta({
      id: 'img1',
      name: '海岸公路.svg',
      kind: 'image',
      path: '/a/coast.svg',
      duration: 8,
      createdAt: '',
    }),
    'SVG',
    'Image cards must NEVER show bogus 8.0s duration',
  );
  assert.equal(
    formatAssetCardMeta({
      id: 'img2',
      name: 'frame.png',
      kind: 'image',
      path: '/a/frame.png',
      duration: 5,
      width: 1920,
      height: 1080,
      createdAt: '',
    }),
    '1920×1080',
  );
  assert.equal(
    estimateCanvasNodeSize('ent:cmp', { assets: [], entities: [] }).h,
    162,
    'Compound/visual card height matches real 162px DOM geometry (no floating wire dot)',
  );

  // Collision-free auto-layout: saved position at (40, CANVAS_LANE_TOP) must NOT be overlapped by newly added ent!
  const nonOverlap = resolveNonOverlappingCanvasLayout({
    assetNodeKeys: ['ent:new_compound', 'asset:existing_svg'],
    shotNodeKeys: [],
    savedPositions: { 'asset:existing_svg': { x: 40, y: CANVAS_LANE_TOP } },
    assetCols: 2,
    shotLaneX: 700,
    getSize: () => ({ w: 248, h: 162 }),
  });
  assert.deepEqual(nonOverlap['asset:existing_svg'], { x: 40, y: CANVAS_LANE_TOP });
  assert.notDeepEqual(
    nonOverlap['ent:new_compound'],
    nonOverlap['asset:existing_svg'],
    'New entity never stacks onto existing saved asset coordinate',
  );
  // Legacy exact stack repair
  const repaired = resolveNonOverlappingCanvasLayout({
    assetNodeKeys: ['ent:a', 'asset:b'],
    shotNodeKeys: [],
    savedPositions: { 'ent:a': { x: 40, y: 274 }, 'asset:b': { x: 42, y: 276 } },
    assetCols: 2,
    shotLaneX: 700,
    getSize: () => ({ w: 248, h: 162 }),
  });
  assert.ok(
    Math.hypot(repaired['ent:a'].x - repaired['asset:b'].x, repaired['ent:a'].y - repaired['asset:b'].y) > 100,
    'Legacy stacked cards are automatically separated',
  );

  const tidy = computeTidyCanvasLayout({
    assetNodeKeys: ['asset:1', 'asset:2', 'asset:3', 'asset:4'],
    shotNodeKeys: ['shot:s1'],
    groups: [{ id: 'g1', name: '组1', nodeIds: ['asset:3', 'asset:4'] }],
    getSize: () => ({ w: 248, h: 162 }),
  });
  assert.ok(tidy.positions['asset:3'].y >= CANVAS_LANE_TOP);
  assert.ok(tidy.positions['shot:s1'].x > tidy.positions['asset:2'].x + 248);

  // Verify canvasHiddenNodeIds persists through applyOperations
  const pHide = applyOperations(newProject('HideTest'), [
    { type: 'updateProject', changes: { canvasHiddenNodeIds: ['asset:foo'] } },
  ]);
  assert.deepEqual(pHide.canvasHiddenNodeIds, ['asset:foo']);
}

// 8. Milestone 1: Keyframes & Easing Curves, Split/FPS Scaling, Auto-Ducking, J/L Cut Detach, Track Solo
{
  // 8a. Easing curves & track evaluation
  assert.equal(applyKeyframeEasing(0.5, 'linear'), 0.5);
  assert.ok(applyKeyframeEasing(0.5, 'ease-in') < 0.2, 'ease-in starts slow');
  assert.ok(applyKeyframeEasing(0.5, 'ease-out') > 0.8, 'ease-out decelerates smoothly');
  assert.equal(applyKeyframeEasing(0.5, 'ease-in-out'), 0.5);
  assert.equal(applyKeyframeEasing(0.99, 'hold'), 0);
  assert.equal(applyKeyframeEasing(1, 'hold'), 1);

  const track = [
    { frame: 0, value: 0, easing: 'linear' as const },
    { frame: 30, value: 1, easing: 'hold' as const },
    { frame: 60, value: 0.25, easing: 'ease-in-out' as const },
  ];
  assert.equal(evaluateKeyframeTrack(track, -5, 9), 0, 'Clamps to first keyframe before start');
  assert.ok(Math.abs(evaluateKeyframeTrack(track, 15, 9) - 0.5) < 1e-6, 'Linear midpoint');
  assert.equal(evaluateKeyframeTrack(track, 45, 9), 1, 'Hold keeps previous value until next keyframe');
  assert.equal(evaluateKeyframeTrack(track, 60, 9), 0.25);
  assert.equal(evaluateKeyframeTrack(track, 120, 9), 0.25, 'Clamps to last keyframe after end');

  // 8b. Upsert / Move / Remove + resolveClipPropsAtFrame
  let kf = upsertClipKeyframe(undefined, 'scale', 0, 1, 'ease-in-out');
  kf = upsertClipKeyframe(kf, 'scale', 60, 1.2, 'ease-in-out');
  kf = moveClipKeyframeFrame(kf, 60, 30);
  assert.equal(kf?.scale?.[1].frame, 30);
  const clipBase = { ...newClip('image', 0), id: 'kf_clip', duration: 60, props: { scale: 1, opacity: 1 }, keyframes: kf };
  const midProps = resolveClipPropsAtFrame(clipBase, 15);
  assert.ok(Math.abs(Number(midProps.scale) - 1.1) < 1e-4, 'resolveClipPropsAtFrame evaluates animated props');
  kf = removeClipKeyframe(kf, 'scale', 0);
  kf = removeClipKeyframe(kf, 'scale', 30);
  assert.equal(kf, undefined, 'Removing final keyframe cleans empty keyframes record');

  // 8c. Split keyframes seamlessly across clip boundary & FPS scaling
  const splitPair = splitKeyframesForSplit(
    { opacity: [{ frame: 0, value: 0, easing: 'linear' }, { frame: 60, value: 1, easing: 'linear' }] },
    30,
  );
  assert.ok(Math.abs(evaluateKeyframeTrack(splitPair.left?.opacity, 30, 1) - 0.5) < 1e-4);
  assert.ok(Math.abs(evaluateKeyframeTrack(splitPair.right?.opacity, 0, 1) - 0.5) < 1e-4);
  assert.ok(Math.abs(evaluateKeyframeTrack(splitPair.right?.opacity, 30, 1) - 1) < 1e-4);

  const scaled = scaleKeyframesForFps(splitPair.left, 60 / 30);
  assert.equal(scaled?.opacity?.[1].frame, 60, '30f@30fps keyframe scales cleanly to 60f@60fps');

  // 8d. Ken Burns + Auto-Ducking presets
  const kb = buildKenBurnsKeyframes(clipBase, 'zoom-in');
  assert.equal(kb.scale?.length, 2);
  assert.ok((kb.scale?.[1].value ?? 0) > (kb.scale?.[0].value ?? 0));

  let pM1 = newProject('Milestone1Test');
  const sM1 = pM1.sequences[0].id;
  pM1 = applyOperations(pM1, [
    { type: 'addAsset', asset: { id: 'a_vid1', name: 'interview.mp4', kind: 'video', path: '/tmp/iv.mp4', duration: 6, createdAt: '' } },
    { type: 'addAsset', asset: { id: 'a_bgm1', name: 'bgm.wav', kind: 'audio', path: '/tmp/bgm.wav', duration: 6, createdAt: '' } },
    { type: 'addAsset', asset: { id: 'a_vo1', name: 'vo.wav', kind: 'audio', path: '/tmp/vo.wav', duration: 2, createdAt: '' } },
    {
      type: 'addClip',
      sequenceId: sM1,
      clip: {
        ...newClip('video', 0, 'a_vid1'),
        id: 'v_iv',
        duration: 180,
        props: { volume: 0.9 },
        keyframes: {
          opacity: [{ frame: 0, value: 0, easing: 'linear' }, { frame: 60, value: 1, easing: 'linear' }],
          volume: [{ frame: 0, value: 0.5, easing: 'linear' }, { frame: 60, value: 1, easing: 'linear' }],
        },
      },
    },
    { type: 'addClip', sequenceId: sM1, clip: { ...newClip('audio', 0, 'a_bgm1'), id: 'aud_bgm_m1', duration: 180, props: { volume: 1 } } },
    { type: 'addClip', sequenceId: sM1, clip: { ...newClip('audio', 60, 'a_vo1'), id: 'aud_vo_m1', duration: 60, props: { volume: 1 } } },
  ]);
  const bgmClip = pM1.sequences[0].clips.find((c) => c.id === 'aud_bgm_m1')!;
  const duckedKf = buildAudioDuckingKeyframes(pM1.sequences[0], bgmClip, { duckVolume: 0.25, rampFrames: 6 });
  assert.ok((duckedKf.volume?.length ?? 0) >= 4, 'Auto-Duck generates ramp points around voice window');
  assert.ok(evaluateKeyframeTrack(duckedKf.volume, 10, 1) > 0.9, 'BGM stays full before narration');
  assert.ok(evaluateKeyframeTrack(duckedKf.volume, 90, 1) < 0.3, 'BGM ducks down during narration (f60..120)');
  assert.ok(evaluateKeyframeTrack(duckedKf.volume, 150, 1) > 0.9, 'BGM recovers after narration');

  // 8e. Split clip preserves & splits keyframes through applyOperations
  const vIv = pM1.sequences[0].clips.find((c) => c.id === 'v_iv')!;
  const splitM1Ops = splitOperations(pM1.sequences[0], vIv, 30);
  const pSplitM1 = applyOperations(pM1, splitM1Ops);
  const firstHalf = pSplitM1.sequences[0].clips.find((c) => c.id === 'v_iv')!;
  const secondHalf = pSplitM1.sequences[0].clips.find((c) => c.id !== 'v_iv' && c.kind === 'video')!;
  assert.ok(Math.abs(evaluateKeyframeTrack(firstHalf.keyframes?.opacity, 30, 1) - 0.5) < 1e-4);
  assert.ok(Math.abs(evaluateKeyframeTrack(secondHalf.keyframes?.opacity, 0, 1) - 0.5) < 1e-4);

  // 8f. J/L Cut Audio Detach (mutes video clip, spawns frame-aligned audio clip on A1 with transferred volume keyframes)
  const { operations: detachOps, audioClipId } = detachAudioFromClipOperations(pM1.sequences[0], vIv);
  assert.equal(detachOps.length, 2);
  const pDetached = applyOperations(pM1, detachOps);
  const mutedVid = pDetached.sequences[0].clips.find((c) => c.id === 'v_iv')!;
  const detachedAud = pDetached.sequences[0].clips.find((c) => c.id === audioClipId)!;
  assert.equal(mutedVid.muted, true, 'Original video clip is muted');
  assert.equal(mutedVid.keyframes?.volume, undefined, 'Volume keyframes moved off muted video clip');
  assert.ok(mutedVid.keyframes?.opacity?.length, 'Visual keyframes remain intact on video clip');
  assert.equal(detachedAud.kind, 'audio');
  assert.equal(detachedAud.track, 'audio');
  assert.equal(detachedAud.assetId, vIv.assetId);
  assert.equal(detachedAud.start, vIv.start);
  assert.equal(detachedAud.duration, vIv.duration);
  assert.equal(detachedAud.audioAttachMode, 'timeline', 'Detached audio defaults to timeline-anchored for J/L sliding');
  assert.equal(detachedAud.keyframes?.volume?.length, 2, 'Volume keyframes transferred to detached audio clip');

  // 8g. Track Solo (S) persists via updateSequence & surfaces warning in preflightSequence
  const pSolo = applyOperations(pM1, [
    { type: 'updateSequence', sequenceId: sM1, changes: { soloTracks: ['audio'] } },
  ]);
  assert.deepEqual(pSolo.sequences[0].soloTracks, ['audio']);
  const soloIssues = preflightSequence(pSolo, sM1, []);
  assert.ok(soloIssues.some((i) => i.id === 'solo-tracks-active'), 'Preflight warns when Solo mode is active');
}

// 9. Milestone 2: PBR 3D lightingPreset + RoughJS deterministic seed + whiteboard-sketch preset
{
  const roughMod = (await import('roughjs')).default;
  const gen = roughMod.generator();
  const a = gen.toPaths(gen.rectangle(10, 10, 200, 100, { seed: 42, fill: '#d97706', fillStyle: 'hachure' }));
  const b = gen.toPaths(gen.rectangle(10, 10, 200, 100, { seed: 42, fill: '#d97706', fillStyle: 'hachure' }));
  assert.ok(a.length >= 2, 'RoughJS produces fill + sketchy stroke paths');
  assert.deepEqual(a, b, 'Fixed seed produces bit-identical SVG paths across Remotion frames (0 flicker)');

  const { createPresetClip, getPreset } = await import('../src/core/presets');
  const td = getPreset('teardown-3d');
  assert.ok(td?.parameters.some((p) => p.key === 'lightingPreset'), 'teardown-3d exposes PBR lightingPreset parameter');
  const tdClip = createPresetClip('teardown-3d', 0, 30, { lightingPreset: 'dramatic' });
  assert.equal(tdClip.props.lightingPreset, 'dramatic');

  const wbClip = createPresetClip('whiteboard-sketch', 0, 30, { text: '白板实测' });
  assert.equal(wbClip.props.presetId, 'whiteboard-sketch');
  assert.equal(wbClip.props.text, '白板实测');
  assert.ok(filterPresets('roughjs').some((p) => p.id === 'whiteboard-sketch'), 'whiteboard-sketch searchable by roughjs');

  // Curated model picker & smart inference
  const { suggestedModelsFor, inferModelFromId } = await import('../src/core/models');
  const dsImgOptions = suggestedModelsFor('dashscope', 'dashscope-image');
  assert.ok(dsImgOptions.some((m) => m.modelId === 'qwen-image-2.0-pro'), 'DashScope image picker includes qwen-image-2.0-pro');
  assert.equal(inferModelFromId('wan2.6-t2v', 'dashscope').adapter, 'dashscope-video');
  assert.equal(inferModelFromId('my-custom-flux-t2i', 'dashscope').adapter, 'dashscope-image');
  assert.deepEqual(inferModelFromId('custom-private-llm', 'openai').capabilities, ['agent']);

  // 10. Unified Core Tool Service parity between Built-in Agent & MCP Server
  const { readFileSync } = await import('node:fs');
  const toolServiceSrc = readFileSync('electron/tool-service.ts', 'utf8');
  const coreMatch = toolServiceSrc.match(/export const COCRAFT_CORE_TOOLS = \[([\s\S]*?)\] as const;/);
  assert.ok(coreMatch, 'COCRAFT_CORE_TOOLS exported in electron/tool-service.ts');
  const coreTools = [...coreMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.equal(coreTools.length, 20, `Expected 20 canonical shared core tools, got ${coreTools.length}`);
  const workerSrc = readFileSync('electron/agent-worker.ts', 'utf8');
  const mcpSrc = readFileSync('scripts/cocraft-mcp.mjs', 'utf8');
  for (const tool of coreTools) {
    assert.ok(workerSrc.includes(`'${tool}'`), `Built-in Agent worker missing core tool: ${tool}`);
  }
  for (const mcpTool of [
    'cocraft_read_project',
    'cocraft_publish_edit',
    'cocraft_list_models',
    'cocraft_list_presets',
    'cocraft_add_preset_clip',
    'cocraft_list_studio_media',
    'cocraft_prepare_studio_media',
    'cocraft_search_assets',
    'cocraft_pull_vault_item',
    'cocraft_apply_keyframe_preset',
    'cocraft_detach_audio',
    'cocraft_compile_component',
    'cocraft_import_asset',
    'cocraft_generate_media',
    'cocraft_inspect_media',
    'cocraft_preview_frame',
    'cocraft_preflight',
    'cocraft_export',
    'cocraft_bake_spatial_video',
  ]) {
    assert.ok(mcpSrc.includes(`'${mcpTool}'`), `MCP server missing core tool: ${mcpTool}`);
  }

  // 11. Multi-Provider Architecture v2: DashScope (Qwen-Image 3.0 / Wan 3.0 / Wan 2.7 / HappyHorse / Z-Image), Ark (Seedream 5.5 / Seedance 2.5), MiniMax (H3 / Hailuo / H3-Image / Speech 2.8)
  const {
    modelInputCapabilities,
    minimaxEndpoints,
    compatibleAdapters,
    providerModelSuites,
    curatedModelsByProtocol,
  } = await import('../src/core/models');
  const {
    getProviderDriver,
    isDashscopeMediaArrayVideo,
    isDashscopeMultimodalImage,
    isMiniMaxH3Image,
    isMiniMaxV2Video,
  } = await import('../electron/providers');

  assert.deepEqual(minimaxEndpoints('https://api.minimaxi.com'), {
    root: 'https://api.minimaxi.com',
    v1Base: 'https://api.minimaxi.com/v1',
    v2Base: 'https://api.minimaxi.com/v2',
  });
  assert.deepEqual(minimaxEndpoints('https://api.minimax.io/v1/'), {
    root: 'https://api.minimax.io',
    v1Base: 'https://api.minimax.io/v1',
    v2Base: 'https://api.minimax.io/v2',
  });

  // Curated catalog & suites coverage
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'qwen-image-3.0-pro'));
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'wan2.7-image-pro'));
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'z-image-turbo'));
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'wan3.0-video'));
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'happyhorse-1.1-t2v'));
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'happyhorse-1.1-i2v'));
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'happyhorse-1.1-r2v'));
  assert.ok(curatedModelsByProtocol.ark.some((m) => m.modelId === 'doubao-seedream-5-5-261028'));
  assert.ok(curatedModelsByProtocol.ark.some((m) => m.modelId === 'doubao-seedance-2-5'));
  assert.ok(curatedModelsByProtocol.minimax.some((m) => m.modelId === 'MiniMax-H3'));
  assert.ok(curatedModelsByProtocol.minimax.some((m) => m.modelId === 'MiniMax-Hailuo-2.3'));
  assert.ok(curatedModelsByProtocol.minimax.some((m) => m.modelId === 'MiniMax-H3-Image'));
  assert.ok(curatedModelsByProtocol.minimax.some((m) => m.modelId === 'speech-2.8-hd'));
  assert.ok(providerModelSuites.dashscope && providerModelSuites.ark && providerModelSuites.minimax);

  // Smart inference across protocols
  assert.equal(inferModelFromId('happyhorse-1.1-t2v', 'dashscope').adapter, 'dashscope-video');
  assert.equal(inferModelFromId('z-image-turbo', 'dashscope').adapter, 'dashscope-image');
  assert.equal(inferModelFromId('wan3.0-video-prime', 'dashscope').adapter, 'dashscope-video');
  assert.equal(inferModelFromId('kling/kling-v3-video-generation', 'dashscope').adapter, 'dashscope-video');
  assert.equal(inferModelFromId('doubao-seedream-5-5-261028', 'ark').adapter, 'ark-image');
  assert.equal(inferModelFromId('doubao-seedance-2-5', 'ark').adapter, 'ark-video');
  assert.equal(inferModelFromId('MiniMax-H3', 'minimax').adapter, 'minimax-video');
  assert.equal(inferModelFromId('MiniMax-H3-Image', 'minimax').adapter, 'minimax-image');
  assert.equal(inferModelFromId('speech-2.8-hd', 'minimax').adapter, 'minimax-speech');
  assert.ok(
    compatibleAdapters({ id: 'm', name: 'M', protocol: 'minimax', baseUrl: 'https://api.minimaxi.com', hasApiKey: true, requiresKey: true })
      .some((a) => a.id === 'minimax-video'),
  );

  // Declarative model capabilities
  const hhI2vCaps = modelInputCapabilities({ adapter: 'dashscope-video', modelId: 'happyhorse-1.1-i2v' });
  assert.equal(hhI2vCaps.requiresReference, true);
  assert.equal(hhI2vCaps.supportsLastFrame, true);
  const hhR2vCaps = modelInputCapabilities({ adapter: 'dashscope-video', modelId: 'happyhorse-1.1-r2v' });
  assert.equal(hhR2vCaps.maxReferences, 5);
  assert.equal(hhR2vCaps.referenceMode, 'multi-ref');
  const seedream55Caps = modelInputCapabilities({ adapter: 'ark-image', modelId: 'doubao-seedream-5-5-261028' });
  assert.equal(seedream55Caps.supportsTransparentBg, true);
  assert.equal(seedream55Caps.maxReferences, 10);
  const minimaxH3Caps = modelInputCapabilities({ adapter: 'minimax-video', modelId: 'MiniMax-H3' });
  assert.equal(minimaxH3Caps.supportsLastFrame, true);
  assert.equal(minimaxH3Caps.supportsAudioToggle, true);
  assert.ok(minimaxH3Caps.resolutions?.includes('2K'));
  const zImgCaps = modelInputCapabilities({ adapter: 'dashscope-image', modelId: 'z-image-turbo' });
  assert.equal(zImgCaps.maxReferences, 0);

  // Driver routing helpers & registry
  assert.equal(isDashscopeMediaArrayVideo('happyhorse-1.1-i2v'), true);
  assert.equal(isDashscopeMediaArrayVideo('wan2.7-t2v'), true);
  assert.equal(isDashscopeMediaArrayVideo('wan3.0-video'), true);
  assert.equal(isDashscopeMediaArrayVideo('wan2.6-i2v'), false);
  assert.equal(isDashscopeMultimodalImage('z-image-turbo'), true);
  assert.equal(isDashscopeMultimodalImage('wan2.7-image-pro'), true);
  assert.equal(isMiniMaxV2Video('MiniMax-H3'), true);
  assert.equal(isMiniMaxV2Video('MiniMax-Hailuo-2.3'), false);
  assert.equal(isMiniMaxH3Image('MiniMax-H3-Image'), true);
  assert.equal(isMiniMaxH3Image('image-01'), false);
  for (const ad of ['dashscope-image', 'dashscope-video', 'dashscope-speech', 'ark-image', 'ark-video', 'minimax-image', 'minimax-video', 'minimax-speech', 'openai-image', 'openai-video', 'openai-speech', 'system-speech'] as const) {
    assert.ok(getProviderDriver(ad), `Driver registered for ${ad}`);
  }

  // 12. Create Canvas v2: Arbitrary Shot Drag Reorder, Dynamic Wire Bounds, Multi-Subject Context & Stale Detection
  const { reorderCompositeShotOperations, computePrimaryTimelineShots } = await import('../src/core/storyboard');
  const { computeWireSvgBounds } = await import('../src/components/CanvasWiresLayer');
  const { resolveShotGenContextFull, detectStaleBindings, collectVisualSelection } = await import(
    '../src/components/canvas/types'
  );

  // 12a. reorderCompositeShotOperations moves shot #3 -> #1 keeping captions, shot audio & gaps synced while BGM stays pinned
  let pRe = newProject('ReorderTest');
  const sRe = pRe.sequences[0].id;
  pRe = applyOperations(pRe, [
    { type: 'addAsset', asset: { id: 'img_1', name: 'kf1.png', kind: 'image', path: '/tmp/1.png', duration: 0, createdAt: '' } },
    { type: 'addAsset', asset: { id: 'img_2', name: 'kf2.png', kind: 'image', path: '/tmp/2.png', duration: 0, createdAt: '' } },
    { type: 'addAsset', asset: { id: 'aud_bgm', name: 'bgm.wav', kind: 'audio', path: '/tmp/bgm.wav', duration: 20, createdAt: '' } },
    { type: 'addAsset', asset: { id: 'aud_s3', name: 'vo3.wav', kind: 'audio', path: '/tmp/vo3.wav', duration: 2, createdAt: '' } },
    { type: 'addClip', sequenceId: sRe, clip: { ...newClip('title', 0), id: 'sh1', duration: 60, track: 'visual', name: 'Shot 1' } },
    { type: 'addClip', sequenceId: sRe, clip: { ...newClip('caption', 0), id: 'cap1', duration: 60, props: { text: '一' } } },
    { type: 'addClip', sequenceId: sRe, clip: { ...newClip('title', 60), id: 'sh2', duration: 90, track: 'visual', name: 'Shot 2' } },
    { type: 'addClip', sequenceId: sRe, clip: { ...newClip('caption', 60), id: 'cap2', duration: 90, props: { text: '二' } } },
    { type: 'addClip', sequenceId: sRe, clip: { ...newClip('title', 150), id: 'sh3', duration: 45, track: 'visual', name: 'Shot 3' } },
    { type: 'addClip', sequenceId: sRe, clip: { ...newClip('caption', 150), id: 'cap3', duration: 45, props: { text: '三' } } },
    { type: 'addClip', sequenceId: sRe, clip: { ...newClip('audio', 155, 'aud_s3'), id: 'vo3', duration: 30, audioAttachMode: 'shot' } },
    { type: 'addClip', sequenceId: sRe, clip: { ...newClip('audio', 0, 'aud_bgm'), id: 'bgm', duration: 240, audioAttachMode: 'timeline' } },
  ]);
  const reShots = computePrimaryTimelineShots(pRe.sequences[0]);
  assert.equal(reShots.length, 3);
  const reOps = reorderCompositeShotOperations(pRe.sequences[0], reShots, reShots[2].id, 0);
  assert.ok(reOps.length >= 6, 'Moving shot #3 to #1 shifts all affected shots & local clips');
  const pAfterRe = applyOperations(pRe, reOps);
  const afterShots = computePrimaryTimelineShots(pAfterRe.sequences[0]);
  assert.deepEqual(
    afterShots.map((s) => s.anchorClip.id),
    ['sh3', 'sh1', 'sh2'],
    'Shots reordered cleanly to [sh3, sh1, sh2]',
  );
  assert.equal(afterShots[0].start, 0);
  assert.equal(afterShots[1].start, 45);
  assert.equal(afterShots[2].start, 105);
  assert.equal(pAfterRe.sequences[0].clips.find((c) => c.id === 'vo3')?.start, 5, 'Shot-attached audio preserves relative offset');
  assert.equal(pAfterRe.sequences[0].clips.find((c) => c.id === 'cap3')?.start, 0, 'Shot caption moves with sh3');
  assert.equal(pAfterRe.sequences[0].clips.find((c) => c.id === 'bgm')?.start, 0, 'Timeline BGM stays pinned');

  // Locked shot refuses reorder
  const pLockedRe = applyOperations(pRe, [
    { type: 'updateClip', sequenceId: sRe, clipId: 'sh2', changes: { locked: true } },
  ]);
  const lockedShots = computePrimaryTimelineShots(pLockedRe.sequences[0]);
  assert.equal(reorderCompositeShotOperations(pLockedRe.sequences[0], lockedShots, lockedShots[2].id, 0).length, 0);

  // 12b. Dynamic SVG wire bounding box handles negative and massive coordinates without clipping
  const bounds = computeWireSvgBounds(
    [
      {
        key: 'w1',
        kind: 'asset-lineage',
        semantic: 'first-last',
        fromKey: 'asset:a',
        toKey: 'asset:b',
        x1: -1400,
        y1: -650,
        x2: 6800,
        y2: 4200,
        s1: 'right',
        s2: 'left',
        label: '首帧',
        shotId: '',
        clipId: '',
        entityId: '',
        active: false,
      },
    ],
    null,
  );
  assert.ok(bounds && bounds.x <= -1400 && bounds.y <= -650, 'Wire SVG bounds include negative coordinates');
  assert.ok(bounds && bounds.x + bounds.w >= 6800 && bounds.y + bounds.h >= 4200, 'Wire SVG bounds expand beyond 4000x3000');

  // 12c. Multi-subject reference aggregation, stale upstream detection & left-to-right first/last visual selection
  const entA = {
    id: 'ent_a',
    name: '林夏',
    category: 'subject' as const,
    subkind: 'character' as const,
    entityKind: 'image' as const,
    assetId: 'img_1',
    promptAnchor: '黑色风衣侦探',
    version: 3,
    updatedAt: '',
  };
  const entB = {
    id: 'ent_b',
    name: '雨夜霓虹街',
    category: 'subject' as const,
    subkind: 'environment' as const,
    entityKind: 'image' as const,
    assetId: 'img_2',
    promptAnchor: '湿润反光柏油路',
    version: 1,
    updatedAt: '',
  };
  const multiShot = {
    ...reShots[0],
    bindings: [
      { entityId: 'ent_a', pinnedVersion: 1 },
      { entityId: 'ent_b', pinnedVersion: 1 },
    ],
  };
  const fullCtx = resolveShotGenContextFull(multiShot, [entA, entB], pRe.assets, {});
  assert.deepEqual(fullCtx.refAssetIds, ['img_1', 'img_2'], 'Collects ALL bound subject reference images');
  assert.ok(fullCtx.prompt.includes('@林夏') && fullCtx.prompt.includes('@雨夜霓虹街'));

  const stale = detectStaleBindings(multiShot, [entA, entB]);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].entity.id, 'ent_a', 'Detects upstream entity v3 > pinnedVersion v1');

  const visSel = collectVisualSelection(
    ['asset:img_2', 'asset:img_1'],
    pRe,
    [entA, entB],
    reShots,
    {},
    { 'asset:img_1': { x: 100, y: 120 }, 'asset:img_2': { x: 460, y: 120 } },
  );
  assert.deepEqual(visSel.imageAssetIds, ['img_1', 'img_2'], 'Left-to-right canvas order maps Left -> First Frame, Right -> Last Frame');
  assert.ok(visSel.anchorPlacement.x > 460, 'Anchor placement sits cleanly to the right of selection');
}

// 13. Create Canvas v3 Systemic Redesign: In-Canvas Generator Nodes, Smart Model Rec, Inline Role Tagging, Trace BFS & Layout Sizes
{
  const { recommendModelForInputs } = await import('../src/core/models');
  const { computeTraceGraph } = await import('../src/components/CanvasWiresLayer');
  const { estimateCanvasNodeSize } = await import('../src/lib/canvasLayout');

  // 13a. Smart model recommendation honors transparentBg, hasLastFrame & multi-ref capabilities
  const settingsV3 = {
    theme: 'dark' as const,
    glow: 'subtle' as const,
    motionEffects: true,
    providers: [
      { id: 'dashscope', name: 'DashScope', protocol: 'dashscope' as const, baseUrl: 'https://dashscope.aliyuncs.com/api/v1', hasApiKey: true, requiresKey: true },
      { id: 'ark', name: 'Ark', protocol: 'ark' as const, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', hasApiKey: true, requiresKey: true },
      { id: 'minimax', name: 'MiniMax', protocol: 'minimax' as const, baseUrl: 'https://api.minimaxi.com', hasApiKey: true, requiresKey: true },
    ],
    models: [
      {
        id: 'm_ds_zimg',
        name: 'Z-Image Turbo',
        providerId: 'dashscope',
        adapter: 'dashscope-image' as const,
        modelId: 'z-image-turbo',
        capabilities: ['image' as const],
        parameters: {},
      },
      {
        id: 'm_ark_seedream55',
        name: 'Seedream 5.5',
        providerId: 'ark',
        adapter: 'ark-image' as const,
        modelId: 'doubao-seedream-5-5-261028',
        capabilities: ['image' as const],
        parameters: {},
      },
      {
        id: 'm_minimax_h3',
        name: 'MiniMax H3',
        providerId: 'minimax',
        adapter: 'minimax-video' as const,
        modelId: 'MiniMax-H3',
        capabilities: ['video' as const],
        parameters: {},
      },
    ],
    defaults: { image: 'm_ds_zimg', video: 'm_minimax_h3' },
    defaultFps: 30,
    defaultWidth: 1920,
    defaultHeight: 1080,
  };
  const recCutout = recommendModelForInputs(settingsV3, 'image', { transparentBg: true, refCount: 1 });
  assert.equal(recCutout?.id, 'm_ark_seedream55', 'Transparent cutout recommends transparent-capable model over Z-Image');
  const recMultiRef = recommendModelForInputs(settingsV3, 'image', { refCount: 2 });
  assert.equal(recMultiRef?.id, 'm_ark_seedream55', 'Multi-ref image skips 0-ref Z-Image and recommends Seedream 5.5');
  const recLastFrame = recommendModelForInputs(settingsV3, 'video', { refCount: 1, hasLastFrame: true });
  assert.equal(recLastFrame?.id, 'm_minimax_h3', 'First+last frame recommends last-frame-capable video model');

  // 13b. Persistent canvasGenerators, canvasCollapsedZones & inline Asset role set/clear
  let pV3 = newProject('CanvasV3Test');
  pV3 = applyOperations(pV3, [
    {
      type: 'addAsset',
      asset: { id: 'a_hero', name: 'hero.png', kind: 'image', path: '/tmp/hero.png', duration: 0, createdAt: '' },
    },
    {
      type: 'updateAssetMeta',
      assetId: 'a_hero',
      changes: { role: 'character' },
    },
    {
      type: 'updateProject',
      changes: {
        canvasCollapsedZones: ['explore'],
        canvasGenerators: [
          {
            id: 'g1',
            use: 'image',
            action: 'multi-ref-image',
            prompt: '赛博霓虹雨夜侦探与街道融合',
            inputs: [{ nodeKey: 'asset:a_hero', slot: 'subject' }],
            params: { aspectRatio: '16:9', batchCount: 2 },
            collapsed: false,
            outputAssetIds: ['a_out1'],
            createdAt: '2026-11-25T00:00:00Z',
          },
        ],
      },
    },
  ]);
  assert.equal(pV3.assets.find((a) => a.id === 'a_hero')?.role, 'character', 'Inline asset role saved');
  assert.deepEqual(pV3.canvasCollapsedZones, ['explore'], 'Collapsed semantic zones persisted');
  assert.equal(pV3.canvasGenerators?.length, 1, 'In-canvas generator node persisted');
  assert.equal(pV3.canvasGenerators?.[0].inputs[0].slot, 'subject');

  pV3 = applyOperations(pV3, [
    { type: 'updateAssetMeta', assetId: 'a_hero', changes: { role: null } },
  ]);
  assert.equal(pV3.assets.find((a) => a.id === 'a_hero')?.role, undefined, 'Passing role: null clears asset role cleanly');

  // 13c. Trace Spotlight full upstream + downstream BFS
  const traceWires = [
    {
      key: 'w_in',
      kind: 'generator-input' as const,
      semantic: 'gen-input' as const,
      category: 'lineage' as const,
      fromKey: 'asset:a_hero',
      toKey: 'gen:g1',
      x1: 0, y1: 0, x2: 300, y2: 0, s1: 'right' as const, s2: 'left' as const,
      label: '主体', shotId: '', clipId: '', entityId: '', active: false,
    },
    {
      key: 'w_out',
      kind: 'asset-lineage' as const,
      semantic: 'lineage' as const,
      category: 'lineage' as const,
      fromKey: 'gen:g1',
      toKey: 'asset:a_out1',
      x1: 300, y1: 0, x2: 650, y2: 0, s1: 'right' as const, s2: 'left' as const,
      label: '生成', shotId: '', clipId: '', entityId: '', active: false,
    },
    {
      key: 'w_shot',
      kind: 'shot-clip' as const,
      semantic: 'shot-clip' as const,
      category: 'assembly' as const,
      fromKey: 'asset:a_out1',
      toKey: 'shot:s1',
      x1: 650, y1: 0, x2: 960, y2: 0, s1: 'right' as const, s2: 'left' as const,
      label: '引用', shotId: 's1', clipId: 'c1', entityId: '', active: false,
    },
    {
      key: 'w_unrelated',
      kind: 'asset-lineage' as const,
      semantic: 'lineage' as const,
      category: 'lineage' as const,
      fromKey: 'asset:other1',
      toKey: 'asset:other2',
      x1: 0, y1: 400, x2: 300, y2: 400, s1: 'right' as const, s2: 'left' as const,
      label: '生成', shotId: '', clipId: '', entityId: '', active: false,
    },
  ];
  const traced = computeTraceGraph('gen:g1', traceWires);
  assert.deepEqual(
    [...traced.nodeKeys].sort(),
    ['asset:a_hero', 'asset:a_out1', 'gen:g1', 'shot:s1'],
    'BFS traces both upstream sources and downstream outputs/shots',
  );
  assert.ok(traced.wireKeys.has('w_in') && traced.wireKeys.has('w_out') && traced.wireKeys.has('w_shot'));
  assert.ok(!traced.wireKeys.has('w_unrelated'), 'Unrelated island excluded from trace spotlight');

  // 13d. Layout dimensions for gen: nodes (expanded vs collapsed pill)
  assert.deepEqual(
    estimateCanvasNodeSize('gen:g1', {
      assets: pV3.assets,
      entities: [],
      generators: pV3.canvasGenerators,
    }),
    { w: 316, h: 268 },
  );
  pV3 = applyOperations(pV3, [
    {
      type: 'updateProject',
      changes: {
        canvasGenerators: [{ ...pV3.canvasGenerators![0], collapsed: true }],
      },
    },
  ]);
  assert.deepEqual(
    estimateCanvasNodeSize('gen:g1', {
      assets: pV3.assets,
      entities: [],
      generators: pV3.canvasGenerators,
    }),
    { w: 248, h: 66 },
  );
}

// 14. M1 Low-Cost Cinema Engine, Audio-First Shot Combo, Speaker Auto-Binding, Silence Trim & Cast Voice Profile
{
  const {
    parseSpeakerDialogueLines,
    scriptOutlineToShotOperations,
    combineVisualAndAudioToShotOperations,
    computePrimaryTimelineShots,
    parseSilenceDetectLog,
  } = await import('../src/core/storyboard');
  const { collectVisualSelection } = await import('../src/components/canvas/types');

  // 14a. Speaker-aware dialogue parsing matches registered characters without false-positives on timestamps/ratios
  const castEntities = [
    {
      id: 'ent_lin',
      name: '林夏',
      category: 'subject' as const,
      subkind: 'character' as const,
      entityKind: 'image' as const,
      assetId: 'a_lin',
      promptAnchor: '黑色风衣女侦探',
      voiceProfile: { voice: 'Cherry', styleNote: '冷静克制' },
      version: 2,
      updatedAt: '',
    },
    {
      id: 'ent_chen',
      name: '陈默',
      category: 'subject' as const,
      subkind: 'character' as const,
      entityKind: 'image' as const,
      assetId: 'a_chen',
      version: 1,
      updatedAt: '',
    },
  ];
  const parsedDialogue = parseSpeakerDialogueLines(
    [
      '林夏：雨夜行动开始 [特写推镜]',
      '00:05 镜头切到霓虹雨巷',
      '16:9 宽银幕全景展开',
      '陈默: 别回头，身后有人跟上来了（低声）',
    ].join('\n'),
    castEntities,
  );
  assert.equal(parsedDialogue.length, 4);
  assert.equal(parsedDialogue[0].speakerName, '林夏');
  assert.equal(parsedDialogue[0].entity?.id, 'ent_lin');
  assert.equal(parsedDialogue[0].text, '雨夜行动开始');
  assert.equal(parsedDialogue[0].stageNote, '特写推镜');
  assert.equal(parsedDialogue[1].speakerName, undefined, 'Timestamp 00:05 must not be misparsed as speaker');
  assert.equal(parsedDialogue[2].speakerName, undefined, 'Aspect ratio 16:9 must not be misparsed as speaker');
  assert.equal(parsedDialogue[3].speakerName, '陈默');
  assert.equal(parsedDialogue[3].entity?.id, 'ent_chen');
  assert.equal(parsedDialogue[3].stageNote, '低声');

  // 14b. scriptOutlineToShotOperations auto-binds matched character VaultItems & enables kinetic wordHighlight captions
  let pM1 = newProject('M1CinemaTest');
  pM1 = applyOperations(pM1, [
    { type: 'putVaultItem', item: castEntities[0] },
    { type: 'putVaultItem', item: castEntities[1] },
  ]);
  const savedLin = pM1.vault?.find((v) => v.id === 'ent_lin');
  assert.equal(savedLin?.voiceProfile?.voice, 'Cherry', 'VaultItem voiceProfile persists cleanly');
  assert.equal(savedLin?.voiceProfile?.styleNote, '冷静克制');

  const scriptOps = scriptOutlineToShotOperations(
    pM1.sequences[0],
    '林夏：档案就在钟楼顶层 [雨夜特写]\n陈默：我来掩护你',
    { entityId: 'ent_script', version: 1 },
    castEntities,
  );
  pM1 = applyOperations(pM1, scriptOps);
  const scriptShots = computePrimaryTimelineShots(pM1.sequences[0]);
  assert.equal(scriptShots.length, 2);
  assert.ok(
    scriptShots[0].bindings.some((b) => b.entityId === 'ent_lin' && b.pinnedVersion === 2),
    'Shot 1 auto-binds matched character 林夏 v2',
  );
  assert.ok(
    scriptShots[1].bindings.some((b) => b.entityId === 'ent_chen' && b.pinnedVersion === 1),
    'Shot 2 auto-binds matched character 陈默 v1',
  );
  const cap1 = pM1.sequences[0].clips.find((c) => c.kind === 'caption' && c.start === scriptShots[0].start);
  assert.equal(cap1?.props.wordHighlight, true, 'Generated captions enable M1 wordHighlight by default');
  assert.equal(cap1?.props.text, '档案就在钟楼顶层', 'Speaker prefix & stage notes stripped cleanly from subtitle text');

  // 14c. Audio-First combo: combineVisualAndAudioToShotOperations matches audio duration + L1 cinematic still motion + transcript captions
  const stillAsset = {
    id: 'a_still_1',
    name: '钟楼雨夜.png',
    kind: 'image' as const,
    path: '/tmp/tower.png',
    duration: 0,
    width: 1920,
    height: 1080,
    createdAt: '',
  };
  const voAsset = {
    id: 'a_vo_1',
    name: '林夏配音.wav',
    kind: 'audio' as const,
    path: '/tmp/vo.wav',
    duration: 4.5,
    transcript: {
      text: '钟楼顶层的灯还亮着 看来我们赶上了最后一步',
      segments: [
        { start: 0.0, end: 2.1, text: '钟楼顶层的灯还亮着' },
        { start: 2.2, end: 4.4, text: '看来我们赶上了最后一步' },
      ],
    },
    createdAt: '',
  };
  const combo = combineVisualAndAudioToShotOperations(pM1.sequences[0], stillAsset, voAsset, {
    enableL1Cinema: true,
    wordHighlight: true,
  });
  pM1 = applyOperations(pM1, [
    { type: 'addAsset', asset: stillAsset },
    { type: 'addAsset', asset: voAsset },
    ...combo.operations,
  ]);
  const comboVis = pM1.sequences[0].clips.find((c) => c.id === combo.visualClipId)!;
  const comboAud = pM1.sequences[0].clips.find((c) => c.id === combo.audioClipId)!;
  assert.equal(comboVis.duration, Math.round(4.5 * 30), 'Audio-First shot duration matches audio length');
  assert.equal(comboVis.props.cameraBreath, 42, 'Still image receives L1 cameraBreath automatically');
  assert.equal(comboVis.props.filmGrain, 18, 'Still image receives L1 filmGrain automatically');
  assert.equal(comboAud.audioAttachMode, 'shot', 'Paired audio attaches to shot for ripple-safe reordering');
  assert.equal(comboAud.start, comboVis.start);
  const comboCaps = pM1.sequences[0].clips.filter(
    (c) => c.kind === 'caption' && c.start >= comboVis.start && c.start < comboVis.start + comboVis.duration,
  );
  assert.equal(comboCaps.length, 2, 'Transcript segments materialize synced wordHighlight captions');
  assert.equal(comboCaps[0].props.wordHighlight, true);

  // 14d. FFmpeg silencedetect log parser trims leading/middle/trailing silences with 60ms natural breath padding
  const fakeStderr = [
    '[silencedetect @ 0x1] silence_start: 0',
    '[silencedetect @ 0x1] silence_end: 0.80 | silence_duration: 0.80',
    '[silencedetect @ 0x1] silence_start: 1.80',
    '[silencedetect @ 0x1] silence_end: 3.00 | silence_duration: 1.20',
    '[silencedetect @ 0x1] silence_start: 4.00',
    '[silencedetect @ 0x1] silence_end: 4.80 | silence_duration: 0.80',
  ].join('\n');
  const trimPlan = parseSilenceDetectLog(fakeStderr, 4.8, 0.06);
  assert.equal(trimPlan.kept.length, 2, 'Two spoken islands kept between 3 silence regions');
  assert.ok(Math.abs(trimPlan.kept[0].start - 0.74) < 1e-3, '60ms pre-pad preserved before speech 1');
  assert.ok(Math.abs(trimPlan.kept[0].end - 1.86) < 1e-3, '60ms post-pad preserved after speech 1');
  assert.ok(Math.abs(trimPlan.kept[1].start - 2.94) < 1e-3);
  assert.ok(Math.abs(trimPlan.kept[1].end - 4.06) < 1e-3);
  assert.ok(trimPlan.removedSeconds > 2.4 && trimPlan.removedSeconds < 2.6, 'Accurate removed silence calculation');

  // 14e. Multi-select summary collects images, videos, audios & text nodes cleanly
  const textEnt = {
    id: 'ent_prompt',
    name: '反推提示词',
    category: 'subject' as const,
    subkind: 'note' as const,
    entityKind: 'text' as const,
    textContent: '赛博霓虹雨巷、35mm胶片颗粒',
    version: 1,
    updatedAt: '',
  };
  const pMulti = applyOperations(pM1, [
    { type: 'addAsset', asset: { id: 'a_vid_1', name: 'v1.mp4', kind: 'video', path: '/tmp/v1.mp4', duration: 2, createdAt: '' } },
    { type: 'putVaultItem', item: textEnt },
  ]);
  const multiSum = collectVisualSelection(
    ['asset:a_still_1', 'asset:a_vid_1', 'asset:a_vo_1', 'ent:ent_prompt'],
    pMulti,
    [textEnt],
    [],
    {},
    {
      'asset:a_still_1': { x: 100, y: 100 },
      'asset:a_vid_1': { x: 400, y: 100 },
      'asset:a_vo_1': { x: 700, y: 100 },
      'ent:ent_prompt': { x: 100, y: 360 },
    },
  );
  assert.deepEqual(multiSum.imageAssetIds, ['a_still_1']);
  assert.deepEqual(multiSum.videoAssetIds, ['a_vid_1']);
  assert.deepEqual(multiSum.audioAssetIds, ['a_vo_1']);
  assert.deepEqual(multiSum.visualAssetIds, ['a_still_1', 'a_vid_1']);
  assert.deepEqual(multiSum.textNodeKeys, ['ent:ent_prompt']);
  assert.deepEqual(multiSum.textSnippets, ['赛博霓虹雨巷、35mm胶片颗粒']);
  assert.deepEqual(multiSum.videoNodeKeys, ['asset:a_vid_1']);
  assert.deepEqual(multiSum.audioNodeKeys, ['asset:a_vo_1']);
}

// 15. M2 Unified Signal Performance Workshop: Wan 2.2 Animate Move / Mix / S2V Routing, Capabilities & Recipe Subgraph
{
  const {
    curatedModelsByProtocol,
    inferModelFromId,
    modelInputCapabilities,
    recommendModelForInputs,
  } = await import('../src/core/models');
  const { isDashscopeAnimateVideo, isDashscopeS2VVideo } = await import('../electron/providers');

  // 15a. Curated models & smart inference cover wan2.2-animate-move, wan2.2-animate-mix, wan2.2-s2v
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'wan2.2-animate-move'));
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'wan2.2-animate-mix'));
  assert.ok(curatedModelsByProtocol.dashscope.some((m) => m.modelId === 'wan2.2-s2v'));
  assert.equal(inferModelFromId('wan2.2-animate-move', 'dashscope').adapter, 'dashscope-video');
  assert.equal(inferModelFromId('wan2.2-animate-mix', 'dashscope').adapter, 'dashscope-video');
  assert.equal(inferModelFromId('wan2.2-s2v', 'dashscope').adapter, 'dashscope-video');
  assert.equal(isDashscopeAnimateVideo('wan2.2-animate-move'), true);
  assert.equal(isDashscopeAnimateVideo('wan2.2-animate-mix'), true);
  assert.equal(isDashscopeAnimateVideo('wan2.2-s2v'), false);
  assert.equal(isDashscopeS2VVideo('wan2.2-s2v'), true);
  assert.equal(isDashscopeS2VVideo('wan2.7-i2v'), false);

  // 15b. Declarative capability profiles for performance models
  const moveCaps = modelInputCapabilities({ adapter: 'dashscope-video', modelId: 'wan2.2-animate-move' });
  assert.equal(moveCaps.supportsMotionVideo, true);
  assert.equal(moveCaps.motionMode, 'move');
  assert.equal(moveCaps.promptOptional, true);
  assert.equal(moveCaps.costTier, 'L3');
  assert.deepEqual(moveCaps.animateModes, ['wan-std', 'wan-pro']);

  const mixCaps = modelInputCapabilities({ adapter: 'dashscope-video', modelId: 'wan2.2-animate-mix' });
  assert.equal(mixCaps.supportsMotionVideo, true);
  assert.equal(mixCaps.motionMode, 'mix');
  assert.equal(mixCaps.promptOptional, true);

  const s2vCaps = modelInputCapabilities({ adapter: 'dashscope-video', modelId: 'wan2.2-s2v' });
  assert.equal(s2vCaps.supportsDriverAudio, true);
  assert.equal(s2vCaps.promptOptional, true);
  assert.equal(s2vCaps.costTier, 'L2');
  assert.deepEqual(s2vCaps.resolutions, ['480P', '720P']);

  // 15c. Signal-typed model recommendation automatically routes motion-video (move/mix) and driver-audio (s2v)
  const settingsM2 = {
    theme: 'dark' as const,
    glow: 'subtle' as const,
    motionEffects: true,
    providers: [
      { id: 'dash', name: '百炼', protocol: 'dashscope' as const, baseUrl: 'https://dashscope.aliyuncs.com/api/v1', hasApiKey: true, requiresKey: true },
    ],
    models: [
      { id: 'm_t2v', name: 'Wan 3.0', providerId: 'dash', adapter: 'dashscope-video' as const, modelId: 'wan3.0-video', capabilities: ['video' as const], parameters: {} },
      { id: 'm_move', name: 'Animate Move', providerId: 'dash', adapter: 'dashscope-video' as const, modelId: 'wan2.2-animate-move', capabilities: ['video' as const], parameters: { mode: 'wan-std' } },
      { id: 'm_mix', name: 'Animate Mix', providerId: 'dash', adapter: 'dashscope-video' as const, modelId: 'wan2.2-animate-mix', capabilities: ['video' as const], parameters: { mode: 'wan-std' } },
      { id: 'm_s2v', name: 'Wan S2V', providerId: 'dash', adapter: 'dashscope-video' as const, modelId: 'wan2.2-s2v', capabilities: ['video' as const], parameters: { resolution: '720P' } },
    ],
    defaults: { video: 'm_t2v' },
    defaultFps: 30,
    defaultWidth: 1920,
    defaultHeight: 1080,
  };
  assert.equal(
    recommendModelForInputs(settingsM2, 'video', { hasMotionVideo: true, motionMode: 'move', refCount: 1 })?.id,
    'm_move',
    'Motion transfer recommends wan2.2-animate-move over default T2V',
  );
  assert.equal(
    recommendModelForInputs(settingsM2, 'video', { hasMotionVideo: true, motionMode: 'mix', refCount: 1 })?.id,
    'm_mix',
    'Character replace recommends wan2.2-animate-mix over Move/T2V',
  );
  assert.equal(
    recommendModelForInputs(settingsM2, 'video', { hasDriverAudio: true, refCount: 1 })?.id,
    'm_s2v',
    'Lip-sync recommends wan2.2-s2v over default T2V',
  );

  // 15d. Workshop Recipe VaultItem persistence round-trip
  let pM2 = newProject('M2RecipeTest');
  pM2 = applyOperations(pM2, [
    {
      type: 'putVaultItem',
      item: {
        id: 'recipe_move_1',
        name: '动作迁移配方 1',
        entityKind: 'skill',
        role: 'animation-skill',
        category: 'recipe',
        subkind: 'recipe',
        recipe: {
          skillId: 'canvas-workshop',
          slots: ['主体', '动作视频'],
          promptTemplate: '',
          workshop: {
            use: 'video',
            action: 'motion-transfer',
            modelId: 'm_move',
            prompt: '',
            inputSlots: ['subject', 'motion-video'],
            params: { animateMode: 'wan-pro' },
          },
        },
        version: 1,
        updatedAt: '2026-11-25T07:45:00Z',
      },
    },
  ]);
  const savedRecipe = pM2.vault?.find((v) => v.id === 'recipe_move_1');
  assert.equal(savedRecipe?.recipe?.workshop?.action, 'motion-transfer');
  assert.deepEqual(savedRecipe?.recipe?.workshop?.inputSlots, ['subject', 'motion-video']);
  assert.equal(savedRecipe?.recipe?.workshop?.params?.animateMode, 'wan-pro');
}

// 16. M3 Optional System 1 Rules, Jev Box Normalization, True 9:16 Auto-Reframe, QualityScore & Wide Tidy Layout
{
  const {
    classifyAssetRoleLocally,
    routeOmnibarLocally,
    boxToNormalizedFocal,
    reframeClipForTargetAspect,
  } = await import('../src/core/system1Rules');
  const { computeTidyCanvasLayout, estimateCanvasNodeSize } = await import('../src/lib/canvasLayout');

  // 16a. Tier-0 local free heuristics (0 API spend)
  assert.equal(classifyAssetRoleLocally({ name: 'actor-lin-portrait.png', kind: 'image', duration: 0, width: 1080, height: 1440 }), 'character');
  assert.equal(classifyAssetRoleLocally({ name: 'neon-street-bg.jpg', kind: 'image', duration: 0, width: 1920, height: 1080 }), 'environment');
  assert.equal(classifyAssetRoleLocally({ name: 'cyber-bgm-theme.wav', kind: 'audio', duration: 45 }), 'bgm');
  assert.equal(classifyAssetRoleLocally({ name: 'whoosh-sfx.wav', kind: 'audio', duration: 0.9 }), 'sfx');
  assert.equal(classifyAssetRoleLocally({ name: 'line01.wav', kind: 'audio', duration: 4.2 }), 'voiceover');
  assert.equal(classifyAssetRoleLocally({ name: 'app-screen-demo.mp4', kind: 'video', duration: 12 }), 'screen-recording');

  assert.equal(routeOmnibarLocally('整理画布').intent, 'tidy');
  assert.equal(routeOmnibarLocally('派生 9:16 竖屏').intent, 'reframe-vertical');
  assert.equal(routeOmnibarLocally('新建文本：开场白').intent, 'new-text');
  assert.equal(routeOmnibarLocally('第一镜：开场\n第二镜：转折\n第三镜：高潮').intent, 'breakdown');
  assert.equal(routeOmnibarLocally('帮我分析这段节奏为什么不够抓人？').intent, 'agent');

  // 16b. TypeSafe Jev Box (0..1000 grid, 0..1 fraction, and >1000 pixel coords) -> 0..100% CoCraft focal point
  assert.deepEqual(
    boxToNormalizedFocal({ top: 180, bottom: 520, left: 620, right: 860 }),
    { focalX: 74, focalY: 35 },
    'Jev 0..1000 normalized box converts accurately to 0..100% focalX/Y',
  );
  assert.deepEqual(
    boxToNormalizedFocal({ top: 0.2, bottom: 0.6, left: 0.1, right: 0.3 }),
    { focalX: 20, focalY: 40 },
    '0..1 fractional box converts cleanly to 0..100%',
  );
  assert.deepEqual(
    boxToNormalizedFocal({ top: 200, bottom: 600, left: 1200, right: 1600 }, 1920, 1080),
    { focalX: 73, focalY: 37 },
    'Pixel coordinates (>1000) normalize using image dimensions to 0..100%',
  );

  // 16c. True Auto-Reframe 16:9 -> 9:16 via forkSequenceBranch + Asset qualityScore persistence
  let pM3 = newProject('M3ReframeTest');
  const mainSeqId = pM3.sequences[0].id;
  pM3 = applyOperations(pM3, [
    { type: 'addAsset', asset: { id: 'a_wide', name: 'wide.png', kind: 'image', path: '/tmp/wide.png', duration: 0, width: 1920, height: 1080, createdAt: '' } },
    { type: 'addClip', sequenceId: mainSeqId, clip: { ...newClip('image', 0, 'a_wide'), id: 'c_vis', duration: 90, props: { fit: 'contain' } } },
    { type: 'addClip', sequenceId: mainSeqId, clip: { ...newClip('caption', 0), id: 'c_cap', duration: 90, props: { text: '雨夜钟楼', fontSize: 56, position: 'bottom', y: 0 } } },
    {
      type: 'updateAssetMeta',
      assetId: 'a_wide',
      changes: {
        qualityScore: { score: 94, recommended: true, provider: 'typesafe-jev', evaluatedAt: '2026-11-25T08:00:00Z' },
      },
    },
    {
      type: 'forkSequenceBranch',
      sourceSequenceId: mainSeqId,
      newSequenceId: 'seq_vert',
      branchName: '竖屏 9:16',
      width: 1080,
      height: 1920,
      autoReframe: true,
      focalOverrides: { a_wide: { focalX: 74, focalY: 35 } },
    },
  ]);
  const scoredAsset = pM3.assets.find((a) => a.id === 'a_wide')!;
  assert.equal(scoredAsset.qualityScore?.score, 94);
  assert.equal(scoredAsset.qualityScore?.recommended, true);
  const vertSeq = pM3.sequences.find((s) => s.id === 'seq_vert')!;
  assert.equal(vertSeq.width, 1080);
  assert.equal(vertSeq.height, 1920);
  const vertVis = vertSeq.clips.find((c) => c.kind === 'image')!;
  const vertCap = vertSeq.clips.find((c) => c.kind === 'caption')!;
  assert.equal(vertVis.props.fit, 'cover', 'Portrait reframe enforces cover fit with zero letterbox bars');
  assert.equal(vertVis.props.focalX, 74, 'System 1 Box focalX override (74%) applied cleanly');
  assert.equal(vertVis.props.focalY, 35, 'System 1 Box focalY override (35%) applied cleanly');
  assert.ok(Number(vertCap.props.y) <= -200, 'Portrait caption lifted above bottom platform safe-zone');
  assert.ok(Number(vertCap.props.fontSize) <= 54 && Number(vertCap.props.fontSize) >= 34);

  // Fallback Tier-0 portrait reframe without focalOverride uses smart upper-third (50%, 42%)
  const localReframed = reframeClipForTargetAspect(
    { ...newClip('image', 0, 'a_wide'), id: 'c_loc', duration: 60, props: { fit: 'contain' } },
    1920,
    1080,
    1080,
    1920,
  );
  assert.equal(localReframed.props.focalX, 50);
  assert.equal(localReframed.props.focalY, 42);

  // 16d. Wide tidy layout guarantees zero horizontal overlap for 316px expanded generator cards
  const wideGens = [
    { id: 'g1', use: 'video' as const, action: 'motion-transfer' as const, prompt: '', inputs: [], updatedAt: '' },
    { id: 'g2', use: 'video' as const, action: 'lip-sync' as const, prompt: '', inputs: [], updatedAt: '' },
    { id: 'g3', use: 'image' as const, action: 'image-edit' as const, prompt: '', inputs: [], updatedAt: '' },
    { id: 'g4', use: 'image' as const, action: 'multi-ref-image' as const, prompt: '', inputs: [], updatedAt: '' },
  ];
  const tidyRes = computeTidyCanvasLayout({
    assetNodeKeys: wideGens.map((g) => `gen:${g.id}`),
    shotNodeKeys: [],
    groups: [],
    getSize: (k) => estimateCanvasNodeSize(k, { assets: [], entities: [], generators: wideGens }),
  });
  assert.ok(
    tidyRes.positions['gen:g2'].x - tidyRes.positions['gen:g1'].x >= 316 + 24,
    'Expanded 316px generator cards keep clean horizontal gutter after Tidy',
  );
}

// 17. Unified Spatial Stage (2.5D Parallax / Director Camera / Dolly-Zoom / 3DGS Splat / Multi-Camera Bookmarks)
{
  // Full-frame 35mm lens -> FOV conversion sanity
  const fov24 = lensMmToFov(24);
  const fov35 = lensMmToFov(35);
  const fov85 = lensMmToFov(85);
  assert.ok(fov24 > 50 && fov24 < 56, `24mm vertical FOV expected ~53°, got ${fov24}`);
  assert.ok(fov35 > 35 && fov35 < 41, `35mm vertical FOV expected ~38°, got ${fov35}`);
  assert.ok(fov85 > 14 && fov85 < 19, `85mm vertical FOV expected ~16°, got ${fov85}`);

  // Hitchcock Dolly-Zoom invariant: apparent half-height at Z=0 stays constant as camera pushes in & FOV widens!
  const dzEarly = computeSpatialCameraPose({ preset: 'dolly-zoom', time: 0, is25D: true, lensMm: 35 });
  const dzLate = computeSpatialCameraPose({ preset: 'dolly-zoom', time: 3.0, is25D: true, lensMm: 35 });
  assert.ok(dzLate.position[2] < dzEarly.position[2] - 0.8, 'dolly-zoom pushes camera closer');
  assert.ok(dzLate.fov > dzEarly.fov + 8, 'dolly-zoom widens FOV to counter dolly push');
  const halfHEarly = Math.tan(((dzEarly.fov * Math.PI) / 180) / 2) * dzEarly.position[2];
  const halfHLate = Math.tan(((dzLate.fov * Math.PI) / 180) / 2) * dzLate.position[2];
  assert.ok(Math.abs(halfHEarly - halfHLate) < 0.08, `dolly-zoom apparent scale drift too high: ${halfHEarly} vs ${halfHLate}`);

  // Portrait aspect distance compensation & interactive pan/yaw/pitch
  const landPose = computeSpatialCameraPose({ preset: 'orbit', time: 1, isPortrait: false });
  const portPose = computeSpatialCameraPose({ preset: 'orbit', time: 1, isPortrait: true });
  assert.ok(
    Math.hypot(...portPose.position) > Math.hypot(...landPose.position) * 1.25,
    'portrait mode pulls camera back cleanly for framing',
  );
  const panned = computeSpatialCameraPose({ preset: 'static', time: 0, panX: 0.5, panY: -0.25 });
  assert.ok(panned.target[0] > 1.0 && panned.target[1] < -0.3, 'camera pan shifts lookAt target');

  // 2.5D multi-layer layout & perspective scale compensation
  assert.equal(computeParallaxPlaneScale(5, 0), 1);
  assert.ok(computeParallaxPlaneScale(5, -2) > 1.3, 'background plane scales up to preserve framing');
  assert.ok(computeParallaxPlaneScale(5, 1.5) < 0.8, 'foreground plane scales down to preserve framing');
  const layout3 = computeParallaxLayerLayout(3, 1.0);
  assert.equal(layout3.length, 3);
  assert.ok(layout3[0].z < layout3[1].z && layout3[1].z < layout3[2].z, '2.5D layers strictly ordered back-to-front');

  // 3DGS splat format detection & unified spatial clip detector
  assert.equal(isSplatAssetPath('world.spz'), true);
  assert.equal(isSplatAssetPath('/tmp/scene.SPLAT'), true);
  assert.equal(isSplatAssetPath('scan.ksplat'), true);
  assert.equal(isSplatAssetPath('pointcloud.ply'), true);
  assert.equal(isSplatAssetPath('hero.glb'), false);

  const { createPresetClip, getPreset } = await import('../src/core/presets');
  const spatialPreset = getPreset('spatial-stage');
  assert.ok(spatialPreset, 'spatial-stage preset is registered');
  const spatialClip = createPresetClip('spatial-stage', 0, 90, buildSpatialStageProps({ sceneMode: 'parallax-25d', layerAssetIds: ['a1', 'a2'] }));
  assert.equal(isSpatialClip(spatialClip, null), true);
  assert.equal(DEFAULT_SPATIAL_BOOKMARKS.length, 4);
  assert.deepEqual(DEFAULT_SPATIAL_BOOKMARKS.map((b) => b.shortKey), ['A', 'B', 'C', 'D']);

  // 3D actor blocking trajectory solver (approach, cross, circle-rival & custom Agent coordinates)
  const appStart = computeActorPathState({ path: 'approach', time: 0, durationSec: 4, baseX: 0, baseZ: 0, baseYaw: 0 });
  const appEnd = computeActorPathState({ path: 'approach', time: 4, durationSec: 4, baseX: 0, baseZ: 0, baseYaw: 0 });
  assert.ok(appEnd.z > appStart.z + 2.5, 'approach path advances actor smoothly toward camera');
  const crossStart = computeActorPathState({ path: 'cross-left-right', time: 0, durationSec: 4, baseX: 0, baseZ: 0, baseYaw: 0 });
  const crossEnd = computeActorPathState({ path: 'cross-left-right', time: 4, durationSec: 4, baseX: 0, baseZ: 0, baseYaw: 0 });
  assert.ok(crossStart.x < -2 && crossEnd.x > 2, 'cross-left-right moves actor across stage');
  const customPath = computeActorPathState({
    path: 'hold',
    time: 2,
    durationSec: 4,
    baseX: 0,
    baseZ: 0,
    baseYaw: 0,
    customStart: [-2, -2],
    customEnd: [2, 2],
  });
  assert.ok(Math.abs(customPath.x) < 0.05 && Math.abs(customPath.z) < 0.05, 'custom Agent start->end midpoint lands at origin');

  // Lock-safe undoable asset & component deletion
  const { buildDeleteAssetOperations, buildDeleteComponentOperations } = await import('../src/core/project');
  const delBase = newProject('Delete Regression');
  const delSeqId = delBase.sequences[0].id;
  const delProj = applyOperations(delBase, [
    {
      type: 'addAsset',
      asset: {
        id: 'asset_del_1',
        name: 'shot.png',
        kind: 'image',
        path: '/tmp/shot.png',
        duration: 5,
        width: 1280,
        height: 720,
      },
    },
    {
      type: 'putComponent',
      component: {
        id: 'comp_del_1',
        name: '城市白模',
        source: 'export default () => null;',
        compiled: 'exports.default = () => null;',
        hash: 'del_hash_1',
        props: {},
      },
    },
    {
      type: 'addClip',
      sequenceId: delSeqId,
      clip: { ...newClip('image', 0, 'asset_del_1'), id: 'clip_del_img' },
    },
    {
      type: 'addClip',
      sequenceId: delSeqId,
      clip: { ...newClip('code', 150), id: 'clip_del_comp', componentId: 'comp_del_1' },
    },
    {
      type: 'updateProject',
      changes: {
        canvasLayout: { 'asset:asset_del_1': { x: 40, y: 116 }, 'comp:comp_del_1': { x: 40, y: 300 } },
      },
    },
  ]);

  // Raw removeComponent rejects while referenced
  assert.throws(() => applyOperations(delProj, [{ type: 'removeComponent', componentId: 'comp_del_1' }]));

  // buildDeleteAssetOperations + buildDeleteComponentOperations clean unlocked clips + canvasLayout atomically
  const afterAssetDel = applyOperations(delProj, buildDeleteAssetOperations(delProj, 'asset_del_1'));
  assert.equal(afterAssetDel.assets.length, 0);
  assert.equal(afterAssetDel.sequences[0].clips.some((c) => c.id === 'clip_del_img'), false);
  assert.equal(afterAssetDel.canvasLayout?.['asset:asset_del_1'], undefined);

  const afterCompDel = applyOperations(afterAssetDel, buildDeleteComponentOperations(afterAssetDel, 'comp_del_1'));
  assert.equal(afterCompDel.components.length, 0);
  assert.equal(afterCompDel.sequences[0].clips.length, 0);
  assert.equal(afterCompDel.canvasLayout?.['comp:comp_del_1'], undefined);

  // Locked clip protects both asset and component from deletion
  const lockedProj = applyOperations(delProj, [
    { type: 'updateClip', sequenceId: delSeqId, clipId: 'clip_del_img', changes: { locked: true } },
    { type: 'updateClip', sequenceId: delSeqId, clipId: 'clip_del_comp', changes: { locked: true } },
  ]);
  assert.throws(() => buildDeleteAssetOperations(lockedProj, 'asset_del_1'));
  assert.throws(() => buildDeleteComponentOperations(lockedProj, 'comp_del_1'));
}

// 48. addClip guarantees valid unique clip.id & ProjectStore heals corrupted legacy clips without id
{
  const p = newProject('ClipIdHealTest');
  const seqId = p.sequences[0].id;
  const badClip = { ...newClip('title', 0), id: undefined as unknown as string, props: undefined as unknown as Record<string, unknown> };
  const afterAdd = applyOperations(p, [{ type: 'addClip', sequenceId: seqId, clip: badClip }]);
  assert.equal(afterAdd.sequences[0].clips.length, 1);
  assert.ok(typeof afterAdd.sequences[0].clips[0].id === 'string' && afterAdd.sequences[0].clips[0].id.startsWith('clip_'));
  assert.deepEqual(afterAdd.sequences[0].clips[0].props, {});

  // Duplicate clip ID also gets disambiguated automatically
  const dupClip = { ...newClip('title', 30), id: afterAdd.sequences[0].clips[0].id };
  const afterDup = applyOperations(afterAdd, [{ type: 'addClip', sequenceId: seqId, clip: dupClip }]);
  assert.notEqual(afterDup.sequences[0].clips[0].id, afterDup.sequences[0].clips[1].id);

  // Legacy corrupted snapshot on disk heals cleanly on load
  const dir = await mkdtemp(join(tmpdir(), 'cocraft-heal-'));
  try {
    const store = new ProjectStore(dir);
    await store.init(newProject('CorruptSnapshotTest'));
    const head = await store.project();
    const corrupt = clone(head);
    corrupt.sequences[0].clips.push({ ...newClip('title', 0), id: undefined as unknown as string });
    await writeFile(
      join(dir, '.cocraft', 'revisions', `${head.revision}.json`),
      JSON.stringify({ project: corrupt, revision: { revision: head.revision, name: 'init', author: 'system', createdAt: '', changes: [] } }),
      'utf8',
    );
    const healed = await store.project();
    assert.equal(healed.sequences[0].clips.length, 1);
    assert.equal(healed.sequences[0].clips[0].id, 'clip_repaired_0_0');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 49. recommendModelForInputs picks connected models even when settings.defaults is unset; qwen-image-plus is T2I-only
{
  const { modelInputCapabilities, recommendModelForInputs } = await import('../src/core/models');
  const qwenPlusCaps = modelInputCapabilities({ adapter: 'dashscope-image', modelId: 'qwen-image-plus' });
  assert.equal(qwenPlusCaps.maxReferences, 0);
  const qwen3Caps = modelInputCapabilities({ adapter: 'dashscope-image', modelId: 'qwen-image-3.0-pro' });
  assert.equal(qwen3Caps.maxReferences, 3);

  const mockSettings = {
    providers: [
      { id: 'p_ds', name: '阿里百炼', protocol: 'dashscope' as const, baseUrl: 'https://dashscope.aliyuncs.com/api/v1', requiresKey: true, hasApiKey: true },
    ],
    models: [
      { id: 'm_t2v', providerId: 'p_ds', name: 'Wan 2.6 T2V', modelId: 'wan2.6-t2v', capabilities: ['video' as const], adapter: 'dashscope-video' as const, parameters: {} },
      { id: 'm_i2v', providerId: 'p_ds', name: 'Wan 2.6 I2V', modelId: 'wan2.6-i2v', capabilities: ['video' as const], adapter: 'dashscope-video' as const, parameters: {} },
    ],
    defaults: {},
  };
  const pickedWithRef = recommendModelForInputs(mockSettings, 'video', { refCount: 1 });
  assert.equal(pickedWithRef?.id, 'm_i2v');
  const pickedNoRef = recommendModelForInputs(mockSettings, 'video', { refCount: 0 });
  assert.equal(pickedNoRef?.id, 'm_t2v');
}

// 50. MCP Client helpers (URL-only JSON config, masked header round-trip, stdio rejection, namespace qualification)
{
  const {
    MCP_MASKED_HEADER_VALUE,
    normalizeMcpTransport,
    validateMcpUrl,
    serializeMcpServersToJson,
    parseMcpServersJson,
    qualifyMcpToolName,
    parseMcpToolName,
    formatMcpToolLabel,
  } = await import('../src/core/mcp');

  assert.equal(normalizeMcpTransport('streamable-http'), 'streamable-http');
  assert.equal(normalizeMcpTransport('sse'), 'sse');
  assert.equal(normalizeMcpTransport('http'), 'auto');
  assert.equal(validateMcpUrl('http://127.0.0.1:8787/mcp'), 'http://127.0.0.1:8787/mcp');
  assert.throws(() => validateMcpUrl('ftp://127.0.0.1:8787/mcp'));

  const parsed = parseMcpServersJson(
    JSON.stringify({
      mcpServers: {
        designTools: {
          url: 'http://127.0.0.1:8787/mcp',
          transport: 'streamable-http',
          headers: { Authorization: 'Bearer tok' },
        },
        legacyStream: {
          url: 'http://127.0.0.1:8788/sse',
          type: 'sse',
        },
      },
    }),
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].transport, 'streamable-http');
  assert.equal(parsed[0].url, 'http://127.0.0.1:8787/mcp');
  assert.deepEqual(parsed[0].headerKeys, ['Authorization']);
  assert.equal(parsed[1].transport, 'sse');
  assert.equal(parsed[1].url, 'http://127.0.0.1:8788/sse');

  // Masked header round-trip preserves existing ID and leaves headers undefined (keeps encrypted secret on disk)
  const storedPublic = parsed.map(({ headers: _h, ...rest }) => rest);
  const serialized = serializeMcpServersToJson(storedPublic);
  assert.ok(serialized.includes(MCP_MASKED_HEADER_VALUE));
  const roundTripped = parseMcpServersJson(serialized, storedPublic, { allowEmpty: true });
  assert.equal(roundTripped[0].id, storedPublic[0].id);
  assert.equal(roundTripped[0].headers, undefined);
  assert.deepEqual(roundTripped[0].headerKeys, ['Authorization']);

  // Empty config clears cleanly when allowEmpty is enabled
  assert.deepEqual(parseMcpServersJson('{ "mcpServers": {} }', storedPublic, { allowEmpty: true }), []);

  // Rejects command-only stdio config explicitly (CoCraft connects to URLs only)
  assert.throws(
    () =>
      parseMcpServersJson(
        JSON.stringify({ mcpServers: { localCmd: { command: 'npx', args: ['-y', 'demo'] } } }),
      ),
    /仅连接运行中的 MCP 服务 URL/,
  );

  const q = qualifyMcpToolName('Studio Tools', 'render_pass');
  assert.equal(q, 'mcp__studio_tools__render_pass');
  assert.deepEqual(parseMcpToolName(q), { serverSlug: 'studio_tools', toolName: 'render_pass' });
  assert.equal(formatMcpToolLabel(q), 'MCP · studio_tools · render_pass');
  assert.throws(() => parseMcpServersJson('not valid json'));
}

// 51. Dynamic Multi-Track Timeline + Cubic-Bezier Keyframe Curves + MCP Tool Media Grouping
{
  const {
    resolveSequenceTracks,
    createNewTrackDef,
    formatTrackCode,
    findTrackForClip,
    isClipTrackActive,
    getClipCompositingOrder,
    isTrackCompatibleWithClip,
  } = await import('../src/core/tracks');
  const {
    solveCubicBezier,
    evaluateKeyframeTrack,
    upsertClipKeyframe,
  } = await import('../src/core/keyframes');
  const { groupMessagesIntoTurns } = await import('../src/components/AgentThread');

  // 51a. Cubic-bezier solver accuracy (linear identity + fast ease-out + overshoot)
  assert.ok(Math.abs(solveCubicBezier(0.5, 0.25, 0.25, 0.75, 0.75) - 0.5) < 1e-3);
  assert.ok(solveCubicBezier(0.25, 0, 0.9, 0.2, 1) > 0.65, 'Fast ease-out rises early');
  assert.ok(solveCubicBezier(0.5, 0.3, 1.4, 0.7, 1.4) > 1.0, 'Bezier overshoot supported');
  const bezKf = upsertClipKeyframe(
    upsertClipKeyframe(undefined, 'opacity', 0, 0, 'bezier', [0.1, 0.9, 0.2, 1]),
    'opacity',
    30,
    1,
    'ease-in-out',
  );
  const midOpacity = evaluateKeyframeTrack(bezKf.opacity, 15, 0);
  assert.ok(midOpacity > 0.8 && midOpacity < 1, `Expected fast ease-out bezier opacity > 0.8, got ${midOpacity}`);

  // 51b. Dynamic named multi-track creation, naming, compositing z-order, per-track mute/solo & validation
  let pMulti = newProject('MultiTrackTest');
  const seqMulti = pMulti.sequences[0];
  const baseTracks = resolveSequenceTracks(seqMulti);
  assert.equal(baseTracks.length, 4);
  const v3 = createNewTrackDef(baseTracks, 'video', 'B-Roll 叠加');
  const a2 = createNewTrackDef([...baseTracks, v3], 'audio', 'BGM 配乐');
  const nextTracks = [...baseTracks, v3, a2];
  assert.equal(formatTrackCode(v3, nextTracks), 'V3');
  assert.equal(formatTrackCode(a2, nextTracks), 'A2');
  assert.equal(isTrackCompatibleWithClip(v3, 'video'), true);
  assert.equal(isTrackCompatibleWithClip(v3, 'audio'), false);
  assert.equal(isTrackCompatibleWithClip(a2, 'audio'), true);

  pMulti = applyOperations(pMulti, [
    { type: 'updateSequence', sequenceId: seqMulti.id, changes: { tracks: nextTracks } },
    {
      type: 'addClip',
      sequenceId: seqMulti.id,
      clip: { ...newClip('title', 0), id: 'c_v1', track: 'visual', trackId: 'v1', layer: 0 },
    },
    {
      type: 'addClip',
      sequenceId: seqMulti.id,
      clip: { ...newClip('title', 0), id: 'c_v3', track: 'overlay', trackId: v3.id, layer: v3.layer },
    },
  ]);
  const updatedSeq = pMulti.sequences[0];
  const cV1 = updatedSeq.clips.find((c) => c.id === 'c_v1')!;
  const cV3 = updatedSeq.clips.find((c) => c.id === 'c_v3')!;
  assert.equal(findTrackForClip(cV3, updatedSeq.tracks!)?.name, 'B-Roll 叠加');
  assert.ok(
    getClipCompositingOrder(updatedSeq, cV3) > getClipCompositingOrder(updatedSeq, cV1),
    'V3 overlay composites strictly above V1 visual',
  );
  // Per-track mute/solo
  const mutedSeq = {
    ...updatedSeq,
    tracks: updatedSeq.tracks!.map((t) => (t.id === v3.id ? { ...t, muted: true } : t)),
  };
  assert.equal(isClipTrackActive(mutedSeq, cV3), false);
  assert.equal(isClipTrackActive(mutedSeq, cV1), true);
  const soloSeq = {
    ...updatedSeq,
    tracks: updatedSeq.tracks!.map((t) => (t.id === v3.id ? { ...t, solo: true } : t)),
  };
  assert.equal(isClipTrackActive(soloSeq, cV3), true);
  assert.equal(isClipTrackActive(soloSeq, cV1), false);

  // 51c. MCP tool-end image & resource blocks attach cleanly onto grouped assistant turn steps
  const turns = groupMessagesIntoTurns([
    { id: 'm1', role: 'user', text: 'Render scene', createdAt: '' },
    { id: 'm2', role: 'tool', tool: 'mcp__demo__render', status: 'tool-start', text: '{}', createdAt: '' },
    {
      id: 'm3',
      role: 'tool',
      tool: 'mcp__demo__render',
      status: 'tool-end',
      text: '完成',
      toolMedia: [
        { kind: 'image', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==', savedPath: '.mcp-artifacts/demo.png', title: 'render.png' },
        { kind: 'resource', uri: 'scene://main/meta', title: 'Scene Meta', mimeType: 'application/json', textPreview: '{"fps":30}' },
      ],
      createdAt: '',
    },
  ]);
  const assistantTurn = turns.find((t) => t.kind === 'assistant');
  assert.ok(assistantTurn && assistantTurn.kind === 'assistant');
  assert.equal(assistantTurn.steps.length, 1);
  assert.equal(assistantTurn.steps[0].media?.length, 2);
  assert.equal(assistantTurn.steps[0].media?.[0].kind, 'image');
  assert.equal(assistantTurn.steps[0].media?.[1].uri, 'scene://main/meta');
}

// 52. Full-Version 3D Director Studio: unified distance scale, TSX camera override, Kelvin color, Scene Graph & Bookmarks
{
  // 52a. Canonical cameraDistance scale (0.35..3.0 multiplier, default 1.0) & legacy 5.4 remap
  assert.equal(KEYFRAME_PROPERTY_RANGES.cameraDistance.min, 0.35);
  assert.equal(KEYFRAME_PROPERTY_RANGES.cameraDistance.max, 3.0);
  assert.equal(KEYFRAME_PROPERTY_RANGES.cameraDistance.defaultVal, 1.0);
  const poseBase = computeSpatialCameraPose({ preset: 'static', time: 0, distance: 1.0 });
  const poseLegacy = computeSpatialCameraPose({ preset: 'static', time: 0, distance: 5.4 });
  assert.ok(
    Math.abs(poseBase.position[2] - poseLegacy.position[2]) < 1e-3,
    `Legacy distance 5.4 should remap to canonical 1.0 (${poseBase.position[2]} vs ${poseLegacy.position[2]})`,
  );
  const poseClose = computeSpatialCameraPose({ preset: 'static', time: 0, distance: 0.4 });
  const poseFar = computeSpatialCameraPose({ preset: 'static', time: 0, distance: 2.8 });
  assert.ok(poseClose.position[2] < poseBase.position[2] && poseFar.position[2] > poseBase.position[2]);

  // 52b. Pure deterministic Director Camera Override for arbitrary Three.js / TSX 3D scenes
  const idRes = computeDirectorCameraOverride([0, 10, 20], [0, 0, 0], 45, {
    yaw: 0,
    pitch: 0,
    distance: 1,
    panX: 0,
    panY: 0,
  });
  assert.equal(idRes.changed, false);
  assert.deepEqual(idRes.position, [0, 10, 20]);
  assert.equal(idRes.fov, 45);

  const rotRes = computeDirectorCameraOverride([0, 0, 10], [0, 0, 0], 45, {
    yaw: 90,
    pitch: 0,
    distance: 0.5,
    panX: 0,
    panY: 0,
    lensMm: 85,
  });
  assert.equal(rotRes.changed, true);
  assert.ok(Math.abs(rotRes.position[0] - 5) < 0.05 && Math.abs(rotRes.position[2]) < 0.05, `Expected [5,0,0], got ${rotRes.position}`);
  assert.ok(Math.abs(rotRes.fov - lensMmToFov(85)) < 0.05);

  // 52c. Kelvin color temperature converter
  const warmHex = kelvinToHex(2600);
  const dayHex = kelvinToHex(5600);
  const coolHex = kelvinToHex(9000);
  assert.match(warmHex, /^#[0-9a-f]{6}$/);
  assert.ok(parseInt(warmHex.slice(1, 3), 16) > parseInt(warmHex.slice(5, 7), 16), '2600K must be warm (R > B)');
  assert.ok(parseInt(coolHex.slice(5, 7), 16) > parseInt(coolHex.slice(1, 3), 16), '9000K must be cool (B > R)');
  assert.ok(parseInt(dayHex.slice(1, 3), 16) > 230 && parseInt(dayHex.slice(3, 5), 16) > 225);

  // 52d. Composable Scene Graph factory & custom bookmarks normalization
  const actorObj = createStageObject('actor', []);
  assert.equal(actorObj.kind, 'actor');
  assert.ok(Array.isArray(actorObj.endPosition) && actorObj.endPosition.length === 3);
  const lightObj = createStageObject('light', [actorObj]);
  assert.equal(lightObj.kind, 'light');
  assert.ok((lightObj.temperature ?? 0) >= 2200 && (lightObj.intensity ?? 0) > 0);
  const normBms = normalizeCameraBookmarks([
    { id: 'c1', shortKey: 'E', label: 'E · 定制', cameraPreset: 'orbit', cameraLens: 50, cameraYaw: 30, cameraPitch: 10, cameraDistance: 5.4 },
  ]);
  assert.equal(normBms.length, 1);
  assert.equal(normBms[0].cameraDistance, 1.0, 'Legacy 5.4 bookmark distance normalized to 1.0');
  const fallbackBms = normalizeCameraBookmarks(null);
  assert.equal(fallbackBms.length, DEFAULT_SPATIAL_BOOKMARKS.length);
  const stageDefaults = buildSpatialStageProps({ sceneMode: 'previs-blocking' });
  assert.equal(stageDefaults.keyLightTemp, 5600);
  assert.ok(Array.isArray(stageDefaults.stageObjects));
}

// 53. Scene -> Shots (Still vs Motion) -> Assets Production Model & Staleness Signature
{
  const defaultShots = normalizeStageShots(undefined);
  assert.equal(defaultShots.length, DEFAULT_DIRECTOR_SHOTS.length);
  assert.equal(defaultShots.filter((s) => s.mode === 'still').length, 3);
  assert.equal(defaultShots.filter((s) => s.mode === 'motion').length, 1);
  const motionStarter = defaultShots.find((s) => s.mode === 'motion')!;
  assert.ok(motionStarter.keyframes?.cameraYaw?.length === 2, 'Starter motion shot ships with Start->End keyframes');

  // Legacy bookmark migration cleanly produces static shots
  const migrated = normalizeStageShots(undefined, DEFAULT_SPATIAL_BOOKMARKS);
  assert.equal(migrated.length, DEFAULT_SPATIAL_BOOKMARKS.length);
  assert.ok(migrated.every((s) => s.mode === 'still' && s.camera.cameraPreset === 'static'));

  // Scene signature changes on Set edits (lighting / objects) and ignores Camera framing edits!
  const baseProps = buildSpatialStageProps({ sceneMode: 'previs-blocking' });
  const sigA = computeStageSceneSignature(baseProps);
  const sigCamChanged = computeStageSceneSignature({ ...baseProps, cameraYaw: 72, cameraLens: 85, activeShotId: 'shot-2' });
  assert.equal(sigA, sigCamChanged, 'Camera-only changes must NOT mark shot outputs stale');
  const sigLightChanged = computeStageSceneSignature({ ...baseProps, keyLightTemp: 2800 });
  assert.notEqual(sigA, sigLightChanged, 'Scene lighting change MUST change sceneSignature to flag stale shots');
  const sigObjChanged = computeStageSceneSignature({
    ...baseProps,
    stageObjects: [createStageObject('prop-arch', [])],
  });
  assert.notEqual(sigA, sigObjChanged, 'Adding a scene object MUST change sceneSignature');

  // Shot creation + radar projection + motion keyframes helper
  const addedMotion = createDirectorShot('motion', defaultShots, { cameraYaw: 15, cameraLens: 50 }, 30);
  assert.equal(addedMotion.mode, 'motion');
  assert.equal(addedMotion.shortKey, 'S5');
  assert.equal(addedMotion.keyframes?.cameraYaw?.[0].frame, 0);
  assert.equal(addedMotion.keyframes?.cameraYaw?.[1].frame, 119);
  const kfBuilt = buildMotionShotKeyframes(
    { cameraPreset: 'static', cameraLens: 24, cameraYaw: -30, cameraPitch: 0, cameraDistance: 1.2 },
    { cameraPreset: 'static', cameraLens: 85, cameraYaw: 30, cameraPitch: -10, cameraDistance: 0.7 },
    90,
  );
  assert.equal(kfBuilt.cameraLens?.[1].frame, 89);
  assert.equal(kfBuilt.cameraLens?.[1].value, 85);
  const radarBms = shotsToCameraBookmarks([...defaultShots, addedMotion]);
  assert.equal(radarBms.length, 5);
  assert.equal(radarBms[4].shortKey, 'S5');
}

console.log('PASS · all Phase 1 + v0.5 + Wave B + Wave C + Milestone 1 + Milestone 2 + Unified Tools + Multi-Provider v2 + Create Canvas v2 & v3 + M1 + M2 + M3 + Spatial Stage + MCP Client + Multi-Track & Curve Drawer + Full 3D Director Studio (Scene->Shots->Assets) regression tests');
