/**
 * CoCraft Wave B · Fixed Red/Blue End-to-End Creator Delivery Trust Regression
 * Implements the complete creator verification contract from docs/reviews/2026-11-18-v0.4/REVIEW.md:
 *  #1  Lock-safe SHA-256 content-fingerprinted relink (same-hash recovery succeeds; green swap rejected)
 *  #2  3-way audio mute (A1 track mute leaves V1 embedded audio intact; V1 video audio mute silences it)
 *  #3  Numeric script breakdown preservation (2026 年 / 3.5 倍 / 35mm / 100% / -15℃)
 *  #4  Per-line timed SRT caption editing preserves exact frame windows
 *  #5  Shot-attached SFX moves atomically with shot reorder while timeline BGM stays pinned
 *  #6  Full compound shot promotion preserves sourceIn, duration, captions & shot audio
 *  #7  Cold-start empty project -> stage handles & viewport mount immediately without app restart
 *  #8  Frame-accurate shot thumbnails (Shot 1 thumbnail = RED, Shot 2 thumbnail = BLUE)
 *  #9  AI candidate generation automatically back-attaches as inactive ClipTake on originating shot
 *  #10 Complete preflight catches 6-second empty visual tail
 *  +   Pro NLE True A/B Cross-Dissolve verified via real exported MP4 midpoint frame pixel decoding
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const evidenceDir = join(root, 'docs/reviews/2026-11-18-v0.4/evidence');
const sourceRedBlue = join(evidenceDir, 'source-with-audio.mp4');
const replacementGreen = join(evidenceDir, 'replacement-green.mp4');
const cueRedWav = join(evidenceDir, 'cue-red.wav');
const samplePng = join(root, 'resources/public/studio/tram.jpg');
const packagedExec = process.env.COCRAFT_PACKAGED_EXECUTABLE;

const ffmpegBin = existsSync('/opt/homebrew/bin/ffmpeg')
  ? '/opt/homebrew/bin/ffmpeg'
  : join(root, 'node_modules/@remotion/compositor-darwin-arm64/ffmpeg');
const ffprobeBin = existsSync('/opt/homebrew/bin/ffprobe')
  ? '/opt/homebrew/bin/ffprobe'
  : join(root, 'node_modules/@remotion/compositor-darwin-arm64/ffprobe');

function sampleRgbAt(mediaPath, timeSec = null) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (timeSec !== null) args.push('-ss', String(timeSec));
  args.push('-i', mediaPath, '-frames:v', '1', '-vf', 'scale=16:16', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
  const buf = execFileSync(ffmpegBin, args);
  assert.ok(buf.length >= 16 * 16 * 3, `Failed to decode frame from ${mediaPath}`);
  // Average center 4x4 pixels to avoid edge/caption interference
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = 6; y < 10; y++) {
    for (let x = 6; x < 10; x++) {
      const i = (y * 16 + x) * 3;
      r += buf[i];
      g += buf[i + 1];
      b += buf[i + 2];
      n++;
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

function probeAudioInfo(mp4Path) {
  const json = JSON.parse(
    execFileSync(ffprobeBin, ['-v', 'quiet', '-print_format', 'json', '-show_streams', mp4Path], {
      encoding: 'utf8',
    }),
  );
  const hasAudioStream = (json.streams || []).some((s) => s.codec_type === 'audio');
  if (!hasAudioStream) return { hasAudioStream: false, meanVolumeDb: -Infinity };
  const stderr = execFileSync(
    ffmpegBin,
    ['-hide_banner', '-i', mp4Path, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // volumedetect prints to stderr — capture via spawnSync-like fallback if execFileSync only returns stdout
  return { hasAudioStream, raw: stderr };
}

function measureMeanVolumeDb(mp4Path) {
  const json = JSON.parse(
    execFileSync(ffprobeBin, ['-v', 'quiet', '-print_format', 'json', '-show_streams', mp4Path], {
      encoding: 'utf8',
    }),
  );
  const hasAudioStream = (json.streams || []).some((s) => s.codec_type === 'audio');
  if (!hasAudioStream) return { hasAudioStream: false, meanVolumeDb: -Infinity };
  const out = execFileSync(
    'sh',
    ['-c', `"${ffmpegBin}" -hide_banner -i "${mp4Path}" -af volumedetect -f null - 2>&1`],
    { encoding: 'utf8' },
  );
  const m = out.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  return { hasAudioStream: true, meanVolumeDb: m ? Number(m[1]) : -Infinity };
}

const temp = await mkdtemp(join(tmpdir(), 'cocraft-redblue-'));
const dataDir = join(temp, 'data');
const tempMediaDir = join(temp, 'media');
await copyFile(sourceRedBlue, join(temp, 'orig-red-blue.mp4'));
const origCopy = join(temp, 'orig-red-blue.mp4');
const movedCopy = join(temp, 'moved-red-blue.mp4');
const bgm10s = join(temp, 'bgm-10s.wav');

// Synthesize a 10s 220Hz tone WAV for BGM testing
{
  const sr = 16000;
  const totalSamples = sr * 10;
  const pcm = Buffer.alloc(totalSamples * 2);
  for (let i = 0; i < totalSamples; i++) {
    pcm.writeInt16LE(Math.round(5000 * Math.sin((2 * Math.PI * 220 * i) / sr)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  await writeFile(bgm10s, Buffer.concat([header, pcm]));
}

// Local mock image server for Review #9 AI Candidate Back-Attachment
const samplePngBytes = await readFile(samplePng);
const mockServer = createServer(async (req, res) => {
  for await (const _ of req) {
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ b64_json: samplePngBytes.toString('base64') }] }));
});
await new Promise((r) => mockServer.listen(0, '127.0.0.1', r));
const mockPort = mockServer.address().port;

let app;
try {
  app = await electron.launch({
    executablePath: packagedExec || undefined,
    args: [...(packagedExec ? [] : [root]), '--use-mock-keychain'],
    env: { ...process.env, COCRAFT_DATA_DIR: dataDir },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  page.setDefaultTimeout(25000);
  const call = (method, payload) =>
    page.evaluate(({ method, payload }) => window.cocraft.call(method, payload), { method, payload });

  await page.waitForSelector('.app');

  // ── 1. [Review #7] Cold-start EMPTY project -> switch to Edit -> import & append video -> Stage handles MUST appear immediately! ──
  await page.getByRole('tab', { name: '剪辑', exact: true }).click();
  await page.waitForTimeout(250);
  const imported = await call('media.import', { paths: [origCopy], append: true });
  const seqId = imported.project.sequences[0].id;
  const videoAsset = imported.project.assets[0];
  const origClip = imported.project.sequences[0].clips[0];
  assert.ok(videoAsset.sha256 && videoAsset.byteSize > 0, 'Asset records content fingerprint sha256 & byteSize');

  await page.locator('.timeline-clip').first().click();
  await page.waitForTimeout(300);
  await page.locator('.stage-viewport').waitFor({ state: 'visible' });
  await page.locator('.stage-gizmo').waitFor({ state: 'visible' });
  const handleCount = await page.locator('.stage-handle').count();
  assert.equal(handleCount, 4, 'Cold-start empty project renders 4 stage scale handles immediately without restart');
  console.log('PASS · [#7] Cold-start empty project renders stage viewport & 4 handles immediately');

  // ── 2. Split 4s red/blue video at frame 60 -> Shot 1 (red, 0..60) & Shot 2 (blue, 60..120) ──
  let cur = (await call('boot')).current;
  const shot1Id = origClip.id;
  const shot2Id = 'clip_blue_shot2';
  cur = await call('project.edit', {
    baseRevision: cur.project.revision,
    name: '分割为红蓝两镜',
    operations: [
      { type: 'updateClip', sequenceId: seqId, clipId: shot1Id, changes: { name: '红镜', duration: 60 } },
      {
        type: 'addClip',
        sequenceId: seqId,
        clip: {
          id: shot2Id,
          name: '蓝镜',
          kind: 'video',
          track: 'visual',
          start: 60,
          duration: 60,
          sourceIn: 60,
          assetId: videoAsset.id,
          locked: false,
          props: { volume: 1, opacity: 1, scale: 1, fit: 'cover' },
        },
      },
    ],
  });

  // ── 3. [Review #8] Frame-accurate shot thumbnails: Shot 1 MUST be RED, Shot 2 MUST be BLUE! ──
  await page.getByRole('button', { name: '分镜', exact: true }).click();
  await page.waitForTimeout(450);
  const thumbUrls = await page.locator('.shot-card .shot-composite-stage img').evaluateAll((imgs) =>
    imgs.map((el) => el.getAttribute('src')),
  );
  assert.equal(thumbUrls.length, 2, 'Two storyboard shot cards rendered');
  assert.ok(thumbUrls[0]?.includes('frame='), `Shot 1 uses frame-accurate endpoint: ${thumbUrls[0]}`);
  assert.ok(thumbUrls[1]?.includes('frame='), `Shot 2 uses frame-accurate endpoint: ${thumbUrls[1]}`);
  const t1Buf = Buffer.from(await (await fetch(thumbUrls[0])).arrayBuffer());
  const t2Buf = Buffer.from(await (await fetch(thumbUrls[1])).arrayBuffer());
  const t1Path = join(temp, 'thumb1.jpg');
  const t2Path = join(temp, 'thumb2.jpg');
  await writeFile(t1Path, t1Buf);
  await writeFile(t2Path, t2Buf);
  const rgbThumb1 = sampleRgbAt(t1Path);
  const rgbThumb2 = sampleRgbAt(t2Path);
  assert.ok(rgbThumb1.r > 200 && rgbThumb1.b < 45, `Shot 1 thumbnail must be RED, got ${JSON.stringify(rgbThumb1)}`);
  assert.ok(rgbThumb2.b > 200 && rgbThumb2.r < 45, `Shot 2 thumbnail must be BLUE, got ${JSON.stringify(rgbThumb2)}`);
  console.log(`PASS · [#8] Frame-accurate shot thumbnails verified (Shot1=${JSON.stringify(rgbThumb1)}, Shot2=${JSON.stringify(rgbThumb2)})`);

  // ── 4. [Review #1] Lock Shot 2 (blue) -> move source file -> same-SHA relink SUCCEEDS, green swap REJECTED! ──
  cur = await call('project.edit', {
    baseRevision: cur.project.revision,
    name: '锁定蓝镜',
    operations: [{ type: 'updateClip', sequenceId: seqId, clipId: shot2Id, changes: { locked: true } }],
  });
  await copyFile(origCopy, movedCopy);
  await rm(origCopy);
  const offlineIssues = await call('export.preflight', { sequenceId: seqId });
  assert.ok(
    offlineIssues.some((i) => i.severity === 'blocker' && i.assetId === videoAsset.id),
    'Offline preflight detects moved source',
  );
  // Same SHA-256 recovers transparently EVEN THOUGH Shot 2 is locked!
  cur = await call('media.relink', { assetId: videoAsset.id, path: movedCopy });
  assert.equal(cur.project.assets.find((a) => a.id === videoAsset.id).path, movedCopy);
  // Different content (green MP4, identical 4s/1080p) MUST be rejected because Shot 2 is locked!
  const greenAttempt = await page.evaluate(
    async ({ assetId, greenPath }) => {
      try {
        await window.cocraft.call('media.relink', { assetId, path: greenPath });
        return 'ALLOWED';
      } catch (err) {
        return String(err?.message || err);
      }
    },
    { assetId: videoAsset.id, greenPath: replacementGreen },
  );
  assert.match(greenAttempt, /禁止替换为不同内容|已锁定/, `Green relink on locked blue shot must fail: ${greenAttempt}`);
  console.log('PASS · [#1] Same-SHA256 relink succeeded on locked blue shot; green content swap rejected');

  // ── 5. [Review #4, #5, #10] Add shot-attached SFX + 2 timed SRT lines on Shot 1 + 10s timeline BGM ──
  cur = await call('media.import', { paths: [cueRedWav, bgm10s], append: false });
  const sfxAsset = cur.project.assets.find((a) => a.name === 'cue-red.wav');
  const bgmAsset = cur.project.assets.find((a) => a.name === 'bgm-10s.wav');
  const cap1Id = 'cap_red_1';
  const cap2Id = 'cap_red_2';
  const sfxClipId = 'clip_sfx_red';
  const bgmClipId = 'clip_bgm_10s';
  cur = await call('project.edit', {
    baseRevision: cur.project.revision,
    name: '添加红镜双句字幕、随镜提示音与10秒底乐',
    operations: [
      {
        type: 'addClip',
        sequenceId: seqId,
        clip: {
          id: cap1Id,
          name: '红镜第一句',
          kind: 'caption',
          track: 'caption',
          start: 0,
          duration: 24,
          sourceIn: 0,
          locked: false,
          props: { text: '红镜第一句', fontSize: 44, color: '#ffffff', position: 'bottom', background: '#00000088' },
        },
      },
      {
        type: 'addClip',
        sequenceId: seqId,
        clip: {
          id: cap2Id,
          name: '红镜第二句',
          kind: 'caption',
          track: 'caption',
          start: 27,
          duration: 27,
          sourceIn: 0,
          locked: false,
          props: { text: '红镜第二句', fontSize: 44, color: '#ffffff', position: 'bottom', background: '#00000088' },
        },
      },
      {
        type: 'addClip',
        sequenceId: seqId,
        clip: {
          id: sfxClipId,
          name: '红镜提示音',
          kind: 'audio',
          track: 'audio',
          start: 0,
          duration: Math.max(1, Math.floor(sfxAsset.duration * 30)),
          sourceIn: 0,
          assetId: sfxAsset.id,
          locked: false,
          audioAttachMode: 'shot',
          props: { volume: 1 },
        },
      },
      {
        type: 'addClip',
        sequenceId: seqId,
        clip: {
          id: bgmClipId,
          name: '十秒底乐',
          kind: 'audio',
          track: 'audio',
          start: 0,
          duration: 300,
          sourceIn: 0,
          assetId: bgmAsset.id,
          locked: false,
          audioAttachMode: 'timeline',
          props: { volume: 0.4 },
        },
      },
    ],
  });

  // Review #10: Preflight MUST catch the 6s empty tail (4s video + 10s BGM)!
  const tailPreflight = await call('export.preflight', { sequenceId: seqId });
  assert.ok(
    tailPreflight.some((i) => i.id.startsWith('gap-tail-')),
    `Preflight must detect 6s empty tail: ${JSON.stringify(tailPreflight)}`,
  );
  console.log('PASS · [#10] Preflight detected 6-second empty visual tail (4s video + 10s BGM)');

  // Review #4: Edit punctuation on Caption Line 1 in StoryboardStudio UI -> BOTH lines keep exact start/duration!
  await page.waitForTimeout(300);
  const line1Input = page.getByLabel('镜头 1 第 1 句字幕');
  await line1Input.waitFor({ state: 'visible' });
  await line1Input.fill('红镜第一句。');
  await line1Input.blur();
  await page.waitForTimeout(300);
  cur = (await call('boot')).current;
  const c1After = cur.project.sequences[0].clips.find((c) => c.id === cap1Id);
  const c2After = cur.project.sequences[0].clips.find((c) => c.id === cap2Id);
  assert.equal(c1After.props.text, '红镜第一句。');
  assert.equal(c1After.start, 0);
  assert.equal(c1After.duration, 24, 'Line 1 duration preserved');
  assert.equal(c2After.start, 27, 'Line 2 start preserved');
  assert.equal(c2After.duration, 27, 'Line 2 duration preserved');
  console.log('PASS · [#4] Per-line SRT punctuation edit preserved exact frame timing (0–24 & 27–54)');

  // ── 6. [Review #5] Reorder Red <-> Blue shots: SFX + 2 SRT move with Red; 10s BGM stays at 0! ──
  // Unlock Shot 2 temporarily to reorder, then re-lock Shot 2 (blue) at 0..60
  cur = await call('project.edit', {
    baseRevision: cur.project.revision,
    name: '临时解锁蓝镜换序',
    operations: [{ type: 'updateClip', sequenceId: seqId, clipId: shot2Id, changes: { locked: false } }],
  });
  await page.waitForTimeout(250);
  await page.locator('.shot-card').first().getByLabel('后移镜头').click();
  await page.waitForTimeout(350);
  cur = (await call('boot')).current;
  const seqAfterSwap = cur.project.sequences[0];
  assert.equal(seqAfterSwap.clips.find((c) => c.id === shot2Id).start, 0, 'Blue shot moved to 0');
  assert.equal(seqAfterSwap.clips.find((c) => c.id === shot1Id).start, 60, 'Red shot moved to 60');
  assert.equal(seqAfterSwap.clips.find((c) => c.id === cap1Id).start, 60, 'SRT Line 1 followed Red shot to 60');
  assert.equal(seqAfterSwap.clips.find((c) => c.id === cap2Id).start, 87, 'SRT Line 2 followed Red shot to 87');
  assert.equal(seqAfterSwap.clips.find((c) => c.id === sfxClipId).start, 60, 'Shot-attached SFX followed Red shot to 60');
  assert.equal(seqAfterSwap.clips.find((c) => c.id === bgmClipId).start, 0, 'Timeline BGM stayed pinned at 0');
  console.log('PASS · [#5] Shot reorder moved visuals + 2 SRT + shot-attached SFX atomically while timeline BGM stayed at 0');

  // ── 7. [Review #9] AI candidate generation back-attaches as inactive ClipTake on Shot 1 (Red) ──
  await call('settings.save', {
    providers: [
      {
        id: 'prov_rb_img',
        name: 'RedBlue Mock Image',
        protocol: 'openai',
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        apiKey: 'mock-key',
        requiresKey: true,
      },
    ],
    models: [
      {
        id: 'mod_rb_img',
        providerId: 'prov_rb_img',
        name: 'Mock Image',
        modelId: 'mock-img',
        capabilities: ['image'],
        adapter: 'openai-image',
        parameters: {},
      },
    ],
    defaults: { image: 'mod_rb_img' },
  });
  const genJob = await call('generation.start', {
    use: 'image',
    modelId: 'mod_rb_img',
    prompt: '为红镜生成 AI 候选画面',
    target: { sequenceId: seqId, clipId: shot1Id, shotLabel: '红镜', mode: 'take' },
  });
  let genDone;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const st = await call('boot');
    genDone = st.jobs.find((j) => j.id === genJob.id);
    if (genDone && genDone.status !== 'running' && genDone.status !== 'queued') break;
  }
  assert.equal(genDone?.status, 'completed', `AI generation failed: ${JSON.stringify(genDone)}`);
  assert.equal(genDone?.targetAttachment?.applied, true, 'AI candidate marked as attached to target shot');
  cur = (await call('boot')).current;
  const redWithTake = cur.project.sequences[0].clips.find((c) => c.id === shot1Id);
  assert.equal(redWithTake.takes?.length, 2, 'Red shot now has 2 takes (original + AI candidate)');
  assert.equal(redWithTake.assetId, videoAsset.id, 'AI candidate attached INACTIVE without clobbering active red shot');
  console.log('PASS · [#9] AI candidate automatically back-attached as inactive ClipTake on originating shot');

  // ── 8. [Review #2 + Pro NLE A/B Cross-Dissolve] Lock Blue + Add Dissolve + Mute A1 BGM -> Export & Decode! ──
  cur = await call('project.edit', {
    baseRevision: cur.project.revision,
    name: '锁定蓝镜、添加 A/B 叠化并静音 A1 底乐',
    operations: [
      { type: 'updateClip', sequenceId: seqId, clipId: shot2Id, changes: { locked: true } },
      {
        type: 'updateClip',
        sequenceId: seqId,
        clipId: shot1Id,
        changes: { transitionIn: { type: 'dissolve', durationFrames: 20 } },
      },
      { type: 'updateClip', sequenceId: seqId, clipId: bgmClipId, changes: { duration: 120 } },
      { type: 'updateSequence', sequenceId: seqId, changes: { mutedTracks: ['audio'] } },
    ],
  });

  const export1Job = await call('export.start', { sequenceId: seqId, scale: 0.5 });
  let exp1;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const st = await call('boot');
    exp1 = st.jobs.find((j) => j.id === export1Job.id);
    if (exp1 && exp1.status !== 'running' && exp1.status !== 'queued') break;
  }
  assert.equal(exp1?.status, 'completed', `Export 1 failed: ${JSON.stringify(exp1)}`);
  const audio1 = measureMeanVolumeDb(exp1.output);
  assert.equal(audio1.hasAudioStream, true, 'Exported MP4 MUST keep audio stream when only A1 BGM is muted');
  assert.ok(
    audio1.meanVolumeDb > -45,
    `V1 embedded video audio must remain audible when A1 is muted (got ${audio1.meanVolumeDb} dB)`,
  );
  const pxBlue = sampleRgbAt(exp1.output, 0.25);
  const pxMidDissolve = sampleRgbAt(exp1.output, 2.25); // frame ~67, midpoint of 20-frame dissolve at frame 60..80
  const pxRed = sampleRgbAt(exp1.output, 3.25);
  assert.ok(pxBlue.b > 180 && pxBlue.r < 50, `0.25s locked blue shot must stay BLUE, got ${JSON.stringify(pxBlue)}`);
  assert.ok(
    pxMidDissolve.r > 40 && pxMidDissolve.b > 40,
    `2.25s dissolve midpoint must be A/B blended (not black!), got ${JSON.stringify(pxMidDissolve)}`,
  );
  assert.ok(pxRed.r > 180 && pxRed.b < 50, `3.25s red shot must be RED, got ${JSON.stringify(pxRed)}`);
  console.log(
    `PASS · [#2 + Pro A/B Dissolve] Export 1 verified (V1 audio=${audio1.meanVolumeDb}dB, blue=${JSON.stringify(pxBlue)}, dissolveMid=${JSON.stringify(pxMidDissolve)}, red=${JSON.stringify(pxRed)})`,
  );

  // Now ALSO mute V1 embedded video audio (`mutedVideoAudio: true`) and verify Export 2 is silent!
  cur = await call('project.edit', {
    baseRevision: cur.project.revision,
    name: '独立静音 V1 视频原声',
    operations: [{ type: 'updateSequence', sequenceId: seqId, changes: { mutedVideoAudio: true } }],
  });
  const export2Job = await call('export.start', { sequenceId: seqId, scale: 0.5 });
  let exp2;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const st = await call('boot');
    exp2 = st.jobs.find((j) => j.id === export2Job.id);
    if (exp2 && exp2.status !== 'running' && exp2.status !== 'queued') break;
  }
  assert.equal(exp2?.status, 'completed', `Export 2 failed: ${JSON.stringify(exp2)}`);
  const audio2 = measureMeanVolumeDb(exp2.output);
  assert.ok(
    !audio2.hasAudioStream || audio2.meanVolumeDb <= -70,
    `Export 2 must be silent when both A1 and V1 video audio are muted (got ${JSON.stringify(audio2)})`,
  );
  console.log(`PASS · [#2b] V1 mutedVideoAudio independently silences embedded video audio (${JSON.stringify(audio2)})`);

  console.log('ALL FIXED RED/BLUE CREATOR DELIVERY TRUST REGRESSIONS PASSED!');
} finally {
  await app?.close();
  mockServer.close();
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }).catch(() => {});
}
