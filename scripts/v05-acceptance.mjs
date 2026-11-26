import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright';

const execFileAsync = promisify(execFile);
const root = resolve('.');
const compositorDir = resolve('node_modules/@remotion/compositor-darwin-arm64');
const ffmpegBin = join(compositorDir, 'ffmpeg');
const ffprobeBin = join(compositorDir, 'ffprobe');
const ffEnv = { ...process.env, DYLD_LIBRARY_PATH: compositorDir };

const dataDir = await mkdtemp(join(tmpdir(), 'cocraft-v05-accept-'));
const auditDir = process.env.COCRAFT_AUDIT_DIR || resolve('docs/verification/v5');
await mkdir(auditDir, { recursive: true });

// Synthesize a REAL 5.0s H.264 + AAC MP4 video & a reference PNG image via ffmpeg
const sampleMp4 = join(dataDir, 'real-sample-5s.mp4');
const samplePng = join(dataDir, 'linxia-ref.png');

await execFileAsync(
  ffmpegBin,
  [
    '-y',
    '-loop',
    '1',
    '-t',
    '5',
    '-i',
    resolve('resources/public/studio/ridge.jpg'),
    '-t',
    '5',
    '-i',
    resolve('resources/public/studio/pulse-bed.wav'),
    '-vf',
    'scale=1280:720',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    sampleMp4,
  ],
  { env: ffEnv },
);

const samplePngSource = resolve('resources/public/studio/tram.jpg');

// Local OpenAI-compatible SSE server to verify real Pi SDK Agent branch isolation on existing session
let agentStep = 0;
let mainSeqIdForAttempt = '';
let forkedSeqIdFromContext = '';
let latestBaseRev = 0;
let agentToolResults = [];

const mockLlmServer = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  agentToolResults = body.messages.filter((m) => m.role === 'tool');
  const userText = JSON.stringify(body.messages.filter((m) => m.role === 'user'));
  const seqMatch = userText.match(/"sequenceId":"(seq_[^"]+)"/);
  if (seqMatch) forkedSeqIdFromContext = seqMatch[1];

  let toolName = '';
  let toolArgs = {};
  if (agentStep === 0) {
    // Step 0: Deliberately try to edit MAIN branch even though user invoked /新建分支试剪 -> MUST BE BLOCKED!
    toolName = 'publish_edit';
    toolArgs = {
      baseRevision: latestBaseRev,
      name: '越界尝试改主片',
      operations: [
        {
          type: 'updateSequence',
          sequenceId: mainSeqIdForAttempt,
          changes: { name: '主片被污染' },
        },
      ],
    };
  } else if (agentStep === 1) {
    toolName = 'read_project';
    toolArgs = {};
  } else if (agentStep === 2) {
    const lastTool = agentToolResults.at(-1);
    const txt =
      typeof lastTool.content === 'string'
        ? lastTool.content
        : lastTool.content.find((c) => c.type === 'text').text;
    const parsed = JSON.parse(txt);
    const targetSeq = parsed.sequences.find((s) => !s.isMainBranch);
    const firstVisual = targetSeq.clips.find((c) => c.track === 'visual');
    toolName = 'publish_edit';
    toolArgs = {
      baseRevision: parsed.revision,
      name: '仅在新建实验分支精修首镜',
      operations: [
        {
          type: 'updateClip',
          sequenceId: targetSeq.id,
          clipId: firstVisual.id,
          changes: { name: '实验分支已优化首镜' },
        },
      ],
    };
  }

  const delta =
    agentStep < 3
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call_v05_${agentStep}`,
              type: 'function',
              function: { name: toolName, arguments: JSON.stringify(toolArgs) },
            },
          ],
        }
      : { role: 'assistant', content: '已在新建实验分支完成试剪，原主干未受影响。' };

  agentStep++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(
    `data: ${JSON.stringify({
      id: 'chat_v05',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'v05-verify-model',
      choices: [{ index: 0, delta, finish_reason: null }],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      id: 'chat_v05',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: agentStep <= 3 ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    })}\n\n`,
  );
  res.end('data: [DONE]\n\n');
});

await new Promise((r) => mockLlmServer.listen(0, '127.0.0.1', r));
const llmPort = mockLlmServer.address().port;

const packagedExec = process.env.COCRAFT_PACKAGED_EXECUTABLE;
const app = await electron.launch({
  executablePath: packagedExec || undefined,
  args: [...(packagedExec ? [] : [root]), '--use-mock-keychain'],
  env: { ...process.env, COCRAFT_DATA_DIR: dataDir },
});

try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  page.setDefaultTimeout(25000);

  // ── 1. Clean Monochrome IDE Shell & Infinite Creation Canvas ──
  await page.locator('.create-canvas-viewport').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.right-panel').count(), 0, 'Empty Create mode hides right panel by default');
  await page.locator('.cc-ai-omnibar').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(auditDir, '01-create-empty-dark.png') });

  // Import reference PNG & create Character Node 林夏 on Infinite Canvas
  await page.evaluate((p) => window.cocraft.call('media.import', { paths: [p] }), samplePngSource);
  const bootAfterPng = await page.evaluate(() => window.cocraft.call('boot'));
  const pngAsset = bootAfterPng.current.project.assets.find((a) => a.kind === 'image');
  assert.ok(pngAsset, 'Reference PNG imported');

  // Open canvas context menu on blank area -> 添加角色 / 设定
  await page.locator('.create-canvas-viewport').click({ button: 'right', position: { x: 860, y: 260 } });
  await page.locator('.cc-context-menu').getByRole('button', { name: /添加角色 \/ 设定/ }).click();
  await page.getByLabel('主体名称').fill('林夏');
  await page.getByLabel('状态分支名称').fill('雨夜风衣态');
  await page.getByLabel('绑定参考图片').selectOption(pngAsset.id);
  await page.getByLabel('外观特征锁定描述').fill('深灰防雨风衣，冷蓝边缘光');
  await page.getByRole('button', { name: '保存节点' }).click();
  await page.locator('.cc-node.upstream').filter({ hasText: '林夏' }).waitFor();

  // Left Tool Rail -> Text Node -> Multi-line Script -> 拆为分镜序列 -> Select Shot 1 -> Bind @林夏
  await page.getByLabel('新建脚本文本节点').click();
  const scriptArea = page.getByLabel('画布文本内容').last();
  await scriptArea.waitFor({ state: 'visible' });
  await scriptArea.fill(
    '第一镜：雨夜街角独自驻足的开场\n第二镜：转身推开书店木门的暖光反差\n第三镜：书架前翻开旧信封的特写收尾',
  );
  await page.locator('.cc-node.text-note .cc-node-header').last().click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: /拆为分镜序列/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.cc-node.shot').length === 3);

  // Click Shot 1 to open binding drawer -> Bind @林夏 -> verify SVG Bezier wire pill appears!
  const linXiaEnt = (await page.evaluate(() => window.cocraft.call('boot'))).current.project.vault.find(
    (v) => v.name === '林夏',
  );
  await page.locator('.cc-node.shot').first().click();
  await page.getByLabel('镜头 1 绑定主体').selectOption(linXiaEnt.id);
  await page.locator('.cc-wire-pill').filter({ hasText: '林夏' }).first().waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: '剪辑' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: join(auditDir, '02-create-nodes-wires-dark.png') });
  console.log('PASS · [1/5] Monochrome IDE Shell + TapNow Text Node, Shot Nodes & SVG Bezier Wires verified');

  // ── 2. [P1 #5 + v0.5.2 Fixed Modal Size] AI Candidate Entry Preserves Shot Script + Ref Image + Fixed 5-Tab Dialog Bounds ──
  await page.locator('.cc-node.shot').first().click();
  await page.getByLabel('镜头 1 AI 生成候选').click();
  await page.locator('.generation-shell').waitFor({ state: 'visible' });
  await page.waitForTimeout(220);
  const modalBox0 = await page.locator('.generation-shell').boundingBox();
  assert.ok(modalBox0 && modalBox0.width >= 500 && modalBox0.height >= 420, 'GenerationDialog shell has fixed base dimensions');
  const genPromptVal = await page.locator('.generation-shell textarea').inputValue();
  assert.ok(genPromptVal.includes('第一镜：雨夜街角独自驻足的开场'), 'Shot script passed into AI Generation dialog');
  assert.ok(genPromptVal.includes('@林夏:雨夜风衣态'), 'Bound @Entity:Variant passed into AI Generation dialog');
  const singleRefSel = page.locator('.generation-shell').getByLabel('参考图', { exact: true });
  if (await singleRefSel.count()) {
    assert.equal(await singleRefSel.inputValue(), pngAsset.id, 'Bound subject image written into referenceAssetId field');
  } else {
    const refChipsText = await page.locator('.generation-ref-chips').innerText();
    assert.ok(refChipsText.includes(pngAsset.name), 'Bound subject image shown in multi-ref chips');
  }
  // Switch across all remaining tabs and verify prompt + modal size remain fixed!
  await page.locator('.generation-modes').getByRole('button', { name: '视频' }).click();
  assert.equal(await page.locator('.generation-shell textarea').inputValue(), genPromptVal, 'Prompt preserved on Video tab');
  const modalBoxVideo = await page.locator('.generation-shell').boundingBox();
  assert.ok(
    modalBoxVideo &&
      Math.abs(modalBoxVideo.width - modalBox0.width) <= 1 &&
      Math.abs(modalBoxVideo.height - modalBox0.height) <= 1,
    `GenerationDialog keeps exact same width/height on 视频 tab (${JSON.stringify(modalBox0)} vs ${JSON.stringify(modalBoxVideo)})`,
  );
  for (const tabName of ['配音', '转录', '画面分析']) {
    await page.locator('.generation-modes').getByRole('button', { name: tabName }).click();
    const box = await page.locator('.generation-shell').boundingBox();
    assert.ok(
      box && Math.abs(box.width - modalBox0.width) <= 1 && Math.abs(box.height - modalBox0.height) <= 1,
      `GenerationDialog keeps exact fixed size on ${tabName} tab (${JSON.stringify(modalBox0)} vs ${JSON.stringify(box)})`,
    );
  }
  await page.screenshot({ path: join(auditDir, '08-studio-modal-fixed.png') });
  await page.keyboard.press('Escape');
  console.log('PASS · [2/5] AI Candidate entry & fixed 5-tab GenerationDialog bounds verified');

  // ── 3. [P1 #2] Reordering Shots Moves Visuals AND Subtitles in Lockstep ──
  await page.locator('.cc-node.shot').first().click();
  await page.getByLabel('后移镜头').click();
  await page.waitForTimeout(250);
  const afterReorder = await page.evaluate(() => window.cocraft.call('boot'));
  const seqAfterReorder = afterReorder.current.project.sequences[0];
  const vSorted = seqAfterReorder.clips.filter((c) => c.track === 'visual').sort((a, b) => a.start - b.start);
  const cSorted = seqAfterReorder.clips.filter((c) => c.kind === 'caption').sort((a, b) => a.start - b.start);
  assert.ok(vSorted[0].name.includes('第二镜'), 'Shot 2 visual is now first at 00:00');
  assert.equal(cSorted[0].start, vSorted[0].start, 'First caption aligned to 00:00');
  assert.ok(
    String(cSorted[0].props.text).includes('转身推开书店木门的暖光反差'),
    `Shot 2 subtitle moved to 00:00 with Shot 2 visual (got ${cSorted[0].props.text})`,
  );
  assert.ok(vSorted[1].name.includes('第一镜'), 'Shot 1 visual moved to second slot');
  assert.equal(cSorted[1].start, vSorted[1].start, 'Second caption aligned to Shot 1 new start');
  assert.ok(
    String(cSorted[1].props.text).includes('雨夜街角独自驻足的开场'),
    `Shot 1 subtitle moved to second slot with Shot 1 visual (got ${cSorted[1].props.text})`,
  );
  console.log('PASS · [3/5] Shot reorder keeps visuals and subtitles 100% matched');

  // ── 4. [P1 #3] Existing Session + /新建分支试剪 Strictly Targets Forked Branch & Protects Main ──
  await page.evaluate(
    (port) =>
      window.cocraft.call('settings.save', {
        provider: 'custom',
        model: 'v05-verify-model',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'local-test-key',
      }),
    llmPort,
  );
  // Pre-create an existing session initially bound to MAIN sequence!
  mainSeqIdForAttempt = seqAfterReorder.id;
  const existingTask = await page.evaluate(
    (seqId) => window.cocraft.call('tasks.create', { name: '已有主片会话', sequenceId: seqId }),
    mainSeqIdForAttempt,
  );
  // Open right Agent drawer (which automatically hides bottom Omnibar to prevent dual inputs) & select session
  if (!(await page.locator('.right-tabs').isVisible())) {
    await page.getByLabel('切换右侧协作栏').click();
  }
  await page.locator('.right-tabs').getByRole('button', { name: 'Agent', exact: true }).click();
  assert.equal(await page.locator('.cc-ai-omnibar').count(), 0, 'Omnibar hides when right Agent drawer is open');
  // Trigger state sync by making a tiny no-op or selecting via tasks dropdown after project event
  await page.evaluate(
    ({ projectId, baseRevision }) =>
      window.cocraft.call('project.edit', {
        projectId,
        baseRevision,
        name: '准备分支试剪测试',
        operations: [{ type: 'upsertCustomTag', tag: { name: '验收', color: '#94a3b8' } }],
      }),
    { projectId: afterReorder.current.project.id, baseRevision: afterReorder.current.project.revision },
  );
  await page.getByLabel('切换对话会话').click();
  await page.locator('.agent-session-popover').waitFor({ state: 'visible' });
  await page.locator('.session-pop-main').filter({ hasText: '已有主片会话' }).click();
  latestBaseRev = (await page.evaluate(() => window.cocraft.call('boot'))).current.project.revision + 1;

  // Send /新建分支试剪 on the EXISTING session!
  const agentInput = page.getByLabel('给 Agent 的指令');
  await agentInput.fill('/新建分支试剪 请在这条实验分支精修首镜名称');
  await agentInput.press('Enter');

  // Wait for Agent run to finish
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => window.cocraft.call('boot'));
    const t = st.current.tasks.find((x) => x.id === existingTask.id);
    if (t && t.status === 'idle' && agentStep >= 4) break;
  }

  const afterAgent = await page.evaluate(() => window.cocraft.call('boot'));
  const mainBranch = afterAgent.current.project.sequences.find((s) => s.id === mainSeqIdForAttempt);
  const trialBranch = afterAgent.current.project.sequences.find((s) => s.id !== mainSeqIdForAttempt);
  assert.ok(trialBranch, 'Experimental branch forked by /新建分支试剪');
  assert.equal(mainBranch.name, '主片', 'Main branch was NOT polluted by unauthorized edit attempt');
  assert.ok(
    !mainBranch.clips.some((c) => c.name === '实验分支已优化首镜'),
    'Main branch clips remained 100% untouched',
  );
  assert.ok(
    trialBranch.clips.some((c) => c.name === '实验分支已优化首镜'),
    'Agent published edit onto the newly forked experimental branch',
  );
  assert.ok(
    agentToolResults.some((m) => JSON.stringify(m).includes('超出当前锁定的成片修改范围')),
    'Server scope gate rejected attempt to edit main branch during /新建分支试剪',
  );

  // Verify v0.5.3 Agent Conversation Grouping (.agent-tool-group) & Composer Redesign (Session Popover, Tight Model/Thinking Pills, Pasted Image Chip, Circular 28x28 Send Button)
  assert.ok((await page.locator('.agent-tool-group').count()) >= 1, 'Agent tool calls grouped cleanly into .agent-tool-group');
  const sendBtnBox = await page.locator('.send-button').boundingBox();
  assert.ok(
    sendBtnBox && Math.round(sendBtnBox.width) === 28 && Math.round(sendBtnBox.height) === 28,
    `Circular 28x28 .send-button rendered (got ${sendBtnBox?.width}x${sendBtnBox?.height})`,
  );
  // Select Thinking Depth via custom upward popover pill
  await page.getByLabel('思考深度').click();
  await page.locator('.composer-popover').getByRole('button', { name: /高/ }).click();
  assert.ok((await page.getByLabel('思考深度').innerText()).includes('高'), 'Thinking depth updated to 高');
  // Stage an image attachment into Composer (simulating paste screenshot / file attach) and open Session Popover for screenshot 13
  const attPngBytes = await readFile(samplePngSource);
  const pastedAtt = await page.evaluate(
    (b64) =>
      window.cocraft.call('agent.attachPaste', {
        dataBase64: b64,
        mimeType: 'image/jpeg',
        ext: 'jpg',
        name: '参考分镜.jpg',
      }),
    attPngBytes.toString('base64'),
  );
  assert.ok(pastedAtt?.previewDataUrl, 'agent.attachPaste returned image previewDataUrl');
  // Trigger paste via ClipboardEvent in renderer to populate Composer attachment chip + open Model popover for visual inspection
  await page.getByLabel('给 Agent 的指令').focus();
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'clip-ref.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ta = document.querySelector('[aria-label="给 Agent 的指令"]');
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, attPngBytes.toString('base64'));
  await page.locator('.composer-att-chip').first().waitFor({ state: 'visible' });
  await page.getByLabel('切换对话会话').click();
  await page.locator('.agent-session-popover').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(auditDir, '13-agent-session-and-composer.png') });
  // Close popover & remove temporary attachment chip so state stays clean
  await page.keyboard.press('Escape');
  await page.locator('.composer-att-chip button').first().click();

  // Also verify Historical Revision Fork button in Versions modal!
  await page.locator('.version-chip-btn').click();
  await page.getByRole('button', { name: /派生分支/ }).last().click();
  await page.waitForTimeout(250);
  const afterHistFork = await page.evaluate(() => window.cocraft.call('boot'));
  assert.equal(afterHistFork.current.project.sequences.length, 3, 'Forked 3rd branch from historical revision');
  // Switch back to trialBranch so Light/Composer canvas screenshots display the full connected graph
  await page.getByLabel('当前成片分支').selectOption(trialBranch.id);
  await page.waitForTimeout(150);
  console.log('PASS · [4/5] Existing session /新建分支试剪 branch isolation & historical revision fork verified');

  // Collapse right drawer -> single bottom Omnibar returns cleanly -> capture Dark & Light canvas screenshots
  await page.getByLabel('切换右侧协作栏').click();
  await page.locator('.cc-ai-omnibar').waitFor({ state: 'visible' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(auditDir, '03-create-codex-composer-dark.png') });

  await page.evaluate(async () => {
    await window.cocraft.call('settings.save', { theme: 'light' });
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(auditDir, '04-create-canvas-light.png') });

  // Switch back to Dark for Real MP4 Full Unbroken Path Acceptance!
  await page.evaluate(async () => {
    await window.cocraft.call('settings.save', { theme: 'dark' });
    document.documentElement.dataset.theme = 'dark';
  });

  // ── 4.5 Product Redesign Acceptance: Zero Emoji, Focused Flow, CapCut/Figma Assets, Figma Canvas Inspector, Immersive State, Stage Direct Click & NLE ──
  if (!(await page.locator('.asset-explorer').isVisible())) {
    await page.getByLabel('切换左侧资产栏').click();
  }
  await page.locator('.asset-explorer').waitFor({ state: 'visible' });
  const createBodyText = await page.evaluate(() => document.body.innerText);
  assert.equal(/[\u{1F300}-\u{1FAFF}✦]/u.test(createBodyText), false, 'Zero emojis or decorative stars across UI');

  // 1) No .ae-style-strip, CapCut 5-cat rail, conditional Figma source tabs & Personal Library Publish/List
  assert.equal(await page.locator('.ae-style-strip').count(), 0, 'Useless .ae-style-strip removed from AssetExplorer');
  const catTabs = await page.locator('.ae-cat-rail [role="tab"]').allInnerTexts();
  for (const label of ['媒体', '音频', '文本', '转场', '组件']) {
    assert.ok(catTabs.some((t) => t.includes(label)), `Category tab ${label} exists`);
  }
  await page.locator('.ae-cat-rail').getByRole('tab', { name: '转场' }).click();
  assert.equal(await page.locator('.ae-lib-tabs').count(), 0, 'Library source filter hidden when browsing Transitions');
  await page.locator('.ae-cat-rail').getByRole('tab', { name: '媒体' }).click();
  const libTabs = await page.locator('.ae-lib-tabs [role="tab"]').allInnerTexts();
  assert.ok(libTabs.includes('当前项目') && libTabs.includes('个人库') && libTabs.includes('官方内置'), 'Figma source tabs present on Media');
  // Publish 林夏 to Personal Library & verify it appears under 个人库!
  const linXiaCard = page.locator('.ae-card').filter({ hasText: '林夏' }).first();
  await linXiaCard.locator('.ae-card-pub').focus();
  await linXiaCard.locator('.ae-card-pub').click();
  await page.waitForTimeout(200);
  await page.locator('.ae-lib-tabs').getByRole('tab', { name: '个人库' }).click();
  await page.locator('.ae-card').filter({ hasText: '林夏' }).first().waitFor({ state: 'visible' });
  await page.locator('.ae-lib-tabs').getByRole('tab', { name: '全部' }).click();

  // 2) Permanent Unified AI Omnibar real mouse click + typing, Audio Asset Node on Canvas, drag persistence, & click wire pill unbind
  await page.locator('.cc-ai-omnibar').waitFor({ state: 'visible' });
  const omniInput = page.locator('.cc-ai-omnibar textarea');
  const omniBox = await omniInput.boundingBox();
  assert.ok(omniBox, 'Omnibar textarea bounding box visible');
  await page.mouse.click(omniBox.x + omniBox.width * 0.5, omniBox.y + omniBox.height * 0.5);
  await page.keyboard.type('真实鼠标点击输入已打通');
  assert.equal(await omniInput.inputValue(), '真实鼠标点击输入已打通', 'Omnibar textarea accepts focus and typing via real mouse click');
  await omniInput.fill('');

  // Import studio WAV audio & verify Canvas renders it as a seekable Audio Asset Node!
  const sampleWavSource = resolve('resources/public/studio/pulse-bed.wav');
  await page.evaluate((p) => window.cocraft.call('media.import', { paths: [p] }), sampleWavSource);
  await page.locator('.cc-node.asset.audio').first().waitFor({ state: 'visible' });
  await page.locator('.cc-node.asset.audio .cc-audio-play-btn').first().waitFor({ state: 'visible' });

  // Drag seekable waveform slider -> verify live audio timecode updates!
  const waveBox = await page.locator('.cc-node.asset.audio .cc-audio-wave').first().boundingBox();
  assert.ok(waveBox, 'Audio waveform seek slider visible');
  const timeBeforeSeek = await page.locator('.cc-node.asset.audio .cc-audio-timecode').first().innerText();
  await page.mouse.move(waveBox.x + waveBox.width * 0.25, waveBox.y + waveBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(waveBox.x + waveBox.width * 0.65, waveBox.y + waveBox.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const timeAfterSeek = await page.locator('.cc-node.asset.audio .cc-audio-timecode').first().innerText();
  assert.notEqual(timeAfterSeek, timeBeforeSeek, 'Dragging waveform updates live audio timecode');

  // TapNow Multi-select (Shift+Click Subject + Audio nodes) -> 添加到对话 -> 成组 -> 打成素材包 -> 离线 packs.export/import roundtrip -> Blank canvas deselect!
  await page.locator('.cc-node.upstream:not(.text-note) .cc-node-header').first().click();
  await page.keyboard.down('Shift');
  await page.locator('.cc-node.asset.audio .cc-node-header').first().click();
  await page.keyboard.up('Shift');
  await page.locator('.cc-multi-bar').waitFor({ state: 'visible' });
  await page.locator('.cc-multi-bar').getByRole('button', { name: /添加到对话/ }).click();
  assert.ok((await page.locator('.cc-omni-ctx').count()) >= 1, '添加到对话 attached multi-selected refs into AI context');
  await page.locator('.cc-multi-bar').getByRole('button', { name: /成组/ }).click();
  await page.locator('.cc-group-frame').first().waitFor({ state: 'visible' });
  await page.screenshot({ path: join(auditDir, '09-tapnow-canvas-multiselect-audio.png') });
  await page.locator('.cc-multi-bar').getByRole('button', { name: /打成素材包/ }).click();
  await page.waitForTimeout(250);
  const globalItems = await page.evaluate(() => window.cocraft.call('vault.list'));
  assert.ok(
    globalItems.some((item) => item.entityKind === 'pack' && item.subkind === 'material-pack'),
    '打成素材包 persisted bundle into Personal Library',
  );
  // Offline packs.export -> packs.import roundtrip test
  const packOutRoot = join(dataDir, 'exported-pack');
  const expPackRes = await page.evaluate(
    ({ targetDir, assetId }) =>
      window.cocraft.call('packs.export', { targetDir, name: '画布验证素材包', assetIds: [assetId] }),
    { targetDir: packOutRoot, assetId: pngAsset.id },
  );
  assert.ok(expPackRes?.directory, 'packs.export created portable pack directory');
  const expManifest = JSON.parse(await readFile(join(expPackRes.directory, 'cocraft-pack.json'), 'utf8'));
  assert.equal(expManifest.name, '画布验证素材包', 'Exported cocraft-pack.json has valid manifest metadata');
  const reimpEnv = await page.evaluate(
    (directory) => window.cocraft.call('packs.import', { directory }),
    expPackRes.directory,
  );
  assert.ok(reimpEnv?.project, 'packs.import roundtrip imported exported pack cleanly');

  // Blank canvas click cleanly deselects everything!
  await page.locator('.create-canvas-viewport').click({ position: { x: 20, y: 200 } });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.cc-node.selected').count(), 0, 'Clicking blank canvas clears all node selection');

  // Verify dragging anywhere on .cc-node-card moves node cleanly + bidirectional port-to-card wiring works!
  const beforeCardDragBoot = await page.evaluate(() => window.cocraft.call('boot'));
  const shotCard = page.locator('.cc-node.shot .cc-node-card').first();
  const cardBox = await shotCard.boundingBox();
  if (cardBox) {
    await page.mouse.move(cardBox.x + cardBox.width * 0.5, cardBox.y + cardBox.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width * 0.5 + 64, cardBox.y + cardBox.height * 0.35 + 26, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const afterDragBoot = await page.evaluate(() => window.cocraft.call('boot'));
    assert.ok(
      afterDragBoot.current.project.canvasLayout &&
        JSON.stringify(afterDragBoot.current.project.canvasLayout) !==
          JSON.stringify(beforeCardDragBoot.current.project.canvasLayout),
      'Dragging .cc-node-card body persisted node position into project.canvasLayout',
    );
  }
  // Test universal Ent -> Asset wiring via .cc-port.out -> .cc-node.asset card body!
  const entOutPort = page.locator('.cc-node.upstream:not(.text-note) .cc-port.out').first();
  const audioAssetCard = page.locator('.cc-node.asset.audio .cc-node-card').first();
  const portBox = await entOutPort.boundingBox();
  const assetBox = await audioAssetCard.boundingBox();
  if (portBox && assetBox) {
    const lineageBefore = await page.locator('.cc-wire-path.lineage').count();
    await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(assetBox.x + assetBox.width * 0.5, assetBox.y + assetBox.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(
      (prev) => document.querySelectorAll('.cc-wire-path.lineage').length > prev,
      lineageBefore,
    );
    await page.screenshot({ path: join(auditDir, '12-canvas-universal-wires.png') });
  }
  // Focus on 林夏 so its binding wire pill surfaces cleanly in Focus Wire Mode, then click pill to unbind
  await page.locator('.cc-node.upstream:not(.text-note) .cc-node-header').first().click();
  await page.waitForTimeout(150);
  const wiresBeforeUnbind = await page.locator('.cc-wire-path:not(.lineage)').count();
  await page.locator('.cc-wire-pill').filter({ hasText: '林夏' }).first().click({ force: true });
  await page.waitForFunction(
    (prev) => document.querySelectorAll('.cc-wire-path:not(.lineage)').length < prev,
    wiresBeforeUnbind,
  );

  // 3) Switch to Edit mode: Inspector opens by default (without redundant 4 style cards), Light theme title contrast/visibility, real DOM gizmo bounds, Figma×CapCut high-density Inspector
  await page.getByRole('tab', { name: '剪辑' }).click();
  assert.equal(await page.locator('.selection-bar').count(), 0, 'Duplicate .selection-bar removed and merged into statusbar');
  const editBodyText = await page.evaluate(() => document.body.innerText);
  assert.equal(/[\u{1F300}-\u{1FAFF}✦]/u.test(editBodyText), false, 'Zero emojis or decorative stars in Edit mode');
  const backCanvasBtn = page.getByRole('button', { name: '← 画布设置' });
  if (await backCanvasBtn.isVisible()) await backCanvasBtn.click();
  await page.locator('.canvas-inspector .aspect-pill').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('.inspector-style-card').count(), 0, 'Redundant 4 style cards removed from Canvas Inspector');
  const bgHexInput = page.getByLabel('画布底色 Hex');
  await bgHexInput.fill('#fbf9f3');
  await bgHexInput.press('Enter');
  await page.waitForTimeout(200);
  const afterStyleBoot = await page.evaluate(() => window.cocraft.call('boot'));
  const curBgSeq = afterStyleBoot.current.project.sequences.find((s) => s.id === trialBranch.id) || afterStyleBoot.current.project.sequences[0];
  assert.equal(curBgSeq.background, '#fbf9f3', 'Updated sequence background hex cleanly via Canvas Inspector');

  // Insert 默认标题 under 暖米纸白 light theme: assert visible (opacity >= 0.85), high-contrast dark color, zero CREATED WITH COCRAFT, and DOM-measured gizmo match!
  await page.locator('.ae-cat-rail').getByRole('tab', { name: '文本' }).click();
  await page.locator('.ae-card').filter({ hasText: '默认标题' }).locator('.ae-card-thumb').click();
  await page.waitForTimeout(350);
  const afterTitleBoot = await page.evaluate(() => window.cocraft.call('boot'));
  const addedTitleClip = afterTitleBoot.current.project.sequences
    .flatMap((s) => s.clips)
    .find((c) => c.name === '默认标题');
  assert.ok(addedTitleClip, 'Inserted 默认标题 clip');
  assert.equal(addedTitleClip.props.animation, 'none', 'Inserted title uses animation=none so frame 0 is immediately visible');
  assert.ok(!addedTitleClip.props.subtitle, 'Inserted title has no CREATED WITH COCRAFT watermark');
  assert.notEqual(String(addedTitleClip.props.color).toLowerCase(), '#f5f2e9', 'Inserted title on light paper adapts to high-contrast ink');

  await page.locator('.ins-subtabs').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.ins-align-bar button').count(), 6, 'Figma 6-button alignment bar present');
  assert.ok((await page.locator('.ins-scrub').count()) >= 4, 'Figma X/Y/S/R scrub inputs present');
  assert.equal(
    await page.locator('.inspector input[type="range"]').count(),
    0,
    'Figma Inspector replaces chunky fontSize/bg range sliders with ScrubInput controls',
  );
  await page.getByLabel('启用描边').click();
  await page.getByLabel('描边颜色').waitFor({ state: 'visible' });

  await page.locator('.stage-gizmo').waitFor({ state: 'visible' });
  await page.waitForTimeout(150);
  const iframeBox = await page.locator('iframe[title="成片预览"]').boundingBox();
  const previewFrame = page.frames().find((f) => f.url().includes('preview.html'));
  assert.ok(iframeBox && previewFrame, 'Preview iframe ready for real DOM measurement');
  const domTitleRect = await previewFrame.evaluate((cid) => {
    const el = document.querySelector(`[data-clip-box="${cid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { left: r.left, top: r.top, width: r.width, height: r.height, opacity: parseFloat(cs.opacity) };
  }, addedTitleClip.id);
  assert.ok(domTitleRect, 'Real DOM [data-clip-box] rendered inside preview iframe');
  assert.ok(domTitleRect.opacity >= 0.85, `Inserted title is clearly visible on frame 0 (opacity=${domTitleRect.opacity})`);

  const gizmoRect = await page.locator('.stage-gizmo').boundingBox();
  assert.ok(gizmoRect, 'Stage gizmo box visible');
  assert.ok(
    Math.abs(gizmoRect.y - (iframeBox.y + domTitleRect.top)) < 8 &&
      Math.abs(gizmoRect.height - domTitleRect.height) < 8,
    `Stage gizmo aligns with real preview DOM box within 8px (gizmoY=${gizmoRect.y}, domY=${iframeBox.y + domTitleRect.top})`,
  );
  await page.screenshot({ path: join(auditDir, '07-edit-figma-inspector-light.png') });

  // Delete temporary 默认标题 via Inspector header action before Stage overlapping test
  await page.locator('.inspector').getByLabel('删除片段', { exact: true }).click();
  await page.waitForTimeout(200);
  await page.locator('.ae-cat-rail').getByRole('tab', { name: '媒体' }).click();

  // 4) Immersive Theater button toggles state, active highlight & restores all 3 panes
  await page.getByLabel('沉浸预览').click();
  await page.locator('.asset-explorer').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.right-panel').isVisible(), false, 'Right pane hidden in immersive mode');
  assert.equal(await page.locator('.editor-panel').isVisible(), false, 'Bottom timeline hidden in immersive mode');
  const exitImmersiveBtn = page.getByLabel('退出沉浸预览 (Esc)');
  assert.equal(await exitImmersiveBtn.getAttribute('aria-pressed'), 'true', 'Immersive button shows active pressed state');
  await exitImmersiveBtn.click();
  await page.locator('.asset-explorer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.editor-panel').isVisible(), true, 'Bottom timeline restored cleanly');

  // 5) Stage direct click across overlapping titles & double-click inline editing
  const preStageBoot = await page.evaluate(() => window.cocraft.call('boot'));
  const activeSeq =
    preStageBoot.current.project.sequences.find((s) => s.id === trialBranch.id) ||
    preStageBoot.current.project.sequences[0];
  await page.evaluate(
    ({ projectId, baseRevision, seqId }) =>
      window.cocraft.call('project.edit', {
        projectId,
        baseRevision,
        name: '添加双标题验证直击选择与双击改字',
        operations: [
          {
            type: 'addClip',
            sequenceId: seqId,
            clip: {
              id: 'clip_title_top',
              name: '顶部测试标题',
              kind: 'title',
              track: 'overlay',
              layer: 2,
              start: 0,
              duration: 90,
              sourceIn: 0,
              locked: false,
              props: { text: '上方第一标题', fontSize: 64, color: '#14171f', y: -240, position: 'center', align: 'center', animation: 'none' },
            },
          },
          {
            type: 'addClip',
            sequenceId: seqId,
            clip: {
              id: 'clip_title_mid',
              name: '中部测试标题',
              kind: 'title',
              track: 'overlay',
              layer: 3,
              start: 0,
              duration: 90,
              sourceIn: 0,
              locked: false,
              props: { text: '点击直接切过来', fontSize: 64, color: '#14171f', y: 120, position: 'center', align: 'center', animation: 'none' },
            },
          },
        ],
      }),
    { projectId: preStageBoot.current.project.id, baseRevision: preStageBoot.current.project.revision, seqId: activeSeq.id },
  );
  await page.waitForTimeout(250);
  const svBox = await page.locator('.stage-viewport').boundingBox();
  assert.ok(svBox, 'Stage viewport visible');
  // Click Top title (around 50% X, 27% Y), then directly click Mid title (around 50% X, 61% Y) WITHOUT holding Alt!
  await page.mouse.click(svBox.x + svBox.width * 0.5, svBox.y + svBox.height * 0.27);
  await page.waitForTimeout(100);
  assert.ok((await page.locator('.stage-gizmo-badge').innerText()).includes('顶部测试标题'), 'Clicked Top title selected immediately');
  await page.mouse.click(svBox.x + svBox.width * 0.5, svBox.y + svBox.height * 0.61);
  await page.waitForTimeout(100);
  assert.ok((await page.locator('.stage-gizmo-badge').innerText()).includes('中部测试标题'), 'Direct click switched selection to Mid title without Alt');
  // Double click Mid title -> inline textarea -> update text & commit
  await page.mouse.dblclick(svBox.x + svBox.width * 0.5, svBox.y + svBox.height * 0.61);
  const inlineEd = page.locator('.stage-inline-editor');
  await inlineEd.waitFor({ state: 'visible' });
  await inlineEd.fill('直击双击改字已生效');
  await inlineEd.evaluate((el) => el.blur());
  await page.waitForTimeout(250);
  const afterInline = await page.evaluate(() => window.cocraft.call('boot'));
  const updatedMidTitle = afterInline.current.project.sequences
    .flatMap((s) => s.clips)
    .find((c) => c.id === 'clip_title_mid');
  assert.equal(updatedMidTitle?.props.text, '直击双击改字已生效', 'Stage double-click inline edit saved text');

  // 6) Unique NLE overlay track numbering (V3, V2), non-fragmented Create Canvas shots, Razor blade tool B click-split, & Dissolve Transition apply
  const overlayCodes = await page.locator('.track-label.overlay .track-code').allInnerTexts();
  assert.deepEqual(overlayCodes, ['V2', 'V2·2'], 'Overlay sub-lanes receive unique track codes without duplicate V2');

  const visualShotTotal = activeSeq.clips.filter((c) => c.track === 'visual').length;
  await page.getByRole('tab', { name: '创造' }).click();
  await page.locator('.cc-node.shot').first().waitFor({ state: 'visible' });
  assert.equal(await page.locator('.cc-node.shot').count(), visualShotTotal, 'Overlay titles do not fragment primary Create Canvas shots');
  await page.getByRole('tab', { name: '剪辑' }).click();
  await page.locator('.timeline-clip').first().waitFor({ state: 'visible' });
  assert.ok((await page.getByLabel('隐藏叠加轨').count()) === 1, 'Visual track uses Eye hide/show button');
  assert.ok((await page.getByLabel('静音声音轨').count()) === 1, 'Audio track keeps Mute button');
  const countBeforeRazor = await page.locator('.timeline-clip').count();
  await page.getByLabel('刀片切割工具 B').click();
  const titleClipBox = await page.locator('.timeline-clip').filter({ hasText: '中部测试标题' }).first().boundingBox();
  assert.ok(titleClipBox, 'Mid title clip bar visible on timeline');
  await page.mouse.click(titleClipBox.x + titleClipBox.width * 0.45, titleClipBox.y + titleClipBox.height * 0.5);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.timeline-clip').count(), countBeforeRazor + 1, 'Razor mode click split clip directly');
  await page.getByLabel('选择工具 V').click();

  // Apply dissolve transition via CapCut Transitions tab!
  await page.locator('.ae-cat-rail').getByRole('tab', { name: '转场' }).click();
  await page.locator('.ae-card').filter({ hasText: '叠化过渡' }).locator('.ae-card-thumb').click();
  await page.waitForTimeout(250);
  await page.locator('.clip-transition-badge').first().waitFor({ state: 'visible' });

  console.log('PASS · [4.5/5] CapCut/Figma Assets, Figma Canvas Inspector, AI Omnibar, Immersive state, Stage multi-layer click & inline edit, Razor blade & Transitions verified');

  // ── 5. [P0 + Full Unbroken Acceptance Path]
  // Real 5s H.264/AAC MP4 Import -> Shot Reorder w/ Subtitle Sync -> Agent /新建分支试剪 Branch Isolation -> Export & ffprobe ──
  await page.locator('.project-menu-btn').click();
  await page.getByRole('button', { name: /新建空白工程/ }).click();
  await page.getByLabel('项目名称').fill('实机MP4全链路验收');
  await page.getByRole('button', { name: /创建/ }).click();
  await page.waitForTimeout(250);

  // Switch to Edit mode (剪辑) & import real 5s H.264/AAC MP4 onto timeline!
  await page.getByRole('tab', { name: '剪辑' }).click();
  const afterMp4Import = await page.evaluate(
    (mp4) => window.cocraft.call('media.import', { paths: [mp4], append: true }),
    sampleMp4,
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(auditDir, '05-edit-ide-shell-dark.png') });

  // Capture Light theme Edit Mode screenshot
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(auditDir, '06-edit-ide-shell-light.png') });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });

  // Split the 5.0s MP4 into 2 shots (0..75 and 75..150) + add 2 synced subtitles, then reorder Shot 1 -> Shot 2!
  const mp4Proj = afterMp4Import.project;
  const mp4Seq = mp4Proj.sequences[0];
  const origMp4Clip = mp4Seq.clips[0];
  await page.evaluate(
    ({ projectId, baseRevision, sequenceId, origClip }) =>
      window.cocraft.call('project.edit', {
        projectId,
        baseRevision,
        name: '切分实机MP4双镜头并配双字幕',
        operations: [
          {
            type: 'updateClip',
            sequenceId,
            clipId: origClip.id,
            changes: { name: 'MP4前半镜', start: 0, sourceIn: 0, duration: 75 },
          },
          {
            type: 'addClip',
            sequenceId,
            clip: {
              ...origClip,
              id: 'clip_mp4_part2',
              name: 'MP4后半镜',
              start: 75,
              sourceIn: 75,
              duration: 75,
              transitionIn: { type: 'dissolve', durationFrames: 15 },
            },
          },
          {
            type: 'addClip',
            sequenceId,
            clip: {
              id: 'clip_cap_part1',
              kind: 'caption',
              track: 'caption',
              name: '前半段实机字幕',
              start: 0,
              duration: 75,
              sourceIn: 0,
              volume: 1,
              locked: false,
              props: { text: '前半段实机字幕', color: '#f4f4f6', background: 'rgba(12,13,16,0.72)' },
            },
          },
          {
            type: 'addClip',
            sequenceId,
            clip: {
              id: 'clip_cap_part2',
              kind: 'caption',
              track: 'caption',
              name: '后半段实机字幕',
              start: 75,
              duration: 75,
              sourceIn: 0,
              volume: 1,
              locked: false,
              props: { text: '后半段实机字幕', color: '#f4f4f6', background: 'rgba(12,13,16,0.72)' },
            },
          },
        ],
      }),
    { projectId: mp4Proj.id, baseRevision: mp4Proj.revision, sequenceId: mp4Seq.id, origClip: origMp4Clip },
  );

  // Rapid Timeline Scrubbing test + Post-edit Compound Asset Save & Re-insert!
  const rulerBox = await page.locator('.timeline-content .ruler').boundingBox();
  assert.ok(rulerBox, 'Timeline ruler visible for scrubbing');
  const tcBeforeScrub = await page.locator('.playback-time b').innerText();
  await page.mouse.move(rulerBox.x + rulerBox.width * 0.12, rulerBox.y + rulerBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(rulerBox.x + rulerBox.width * 0.65, rulerBox.y + rulerBox.height * 0.5, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.notEqual(
    await page.locator('.playback-time b').innerText(),
    tcBeforeScrub,
    'Rapid ruler scrub smoothly updated PlayheadTimecode',
  );

  await page.locator('.timeline-clip').filter({ hasText: 'MP4后半镜' }).first().click();
  await page.locator('.inspector').getByLabel('保存为项目资产').click();
  await page.waitForTimeout(250);
  const afterCompoundSave = await page.evaluate(() => window.cocraft.call('boot'));
  const savedCompItem = (afterCompoundSave.current.project.vault || []).find((v) => v.entityKind === 'compound');
  assert.ok(savedCompItem, '保存为项目资产 persisted compound clip bundle into project.vault');
  assert.equal(savedCompItem.compound?.clips[0]?.transitionIn?.type, 'dissolve', 'Saved compound preserved dissolve transitionIn');
  await page.locator('.ae-cat-rail').getByRole('tab', { name: '媒体' }).click();
  await page.locator('.ae-lib-tabs').getByRole('tab', { name: '当前项目' }).click();
  const compoundCard = page.locator('.ae-card').filter({ hasText: 'MP4后半镜' }).first();
  await compoundCard.waitFor({ state: 'visible' });
  const clipCountBeforeCompoundInsert = await page.locator('.timeline-clip').count();
  await compoundCard.locator('.ae-card-thumb').click();
  await page.waitForTimeout(250);
  assert.ok(
    (await page.locator('.timeline-clip').count()) > clipCountBeforeCompoundInsert,
    'Re-inserting saved compound asset adds trimmed/transitioned clip back onto timeline',
  );
  // Undo extra test insertion so MP4 duration stays ~5.0s for final [5/5] ffprobe check
  await page.evaluate(() => window.cocraft.call('project.undo'));
  await page.waitForTimeout(150);

  // Switch dock tab to 分镜, verify script textarea is usable in compact dock, and click 后移镜头 on Shot 1!
  await page.locator('.editor-tabs').getByRole('button', { name: '分镜' }).click();
  await page.locator('.storyboard-studio.compact .shot-script-input').first().waitFor({ state: 'visible' });
  await page.locator('.shot-card').first().getByLabel('后移镜头').click();
  await page.waitForTimeout(200);

  const afterMp4Reorder = await page.evaluate(() => window.cocraft.call('boot'));
  const reorderedSeq = afterMp4Reorder.current.project.sequences[0];
  const mp4Vis = reorderedSeq.clips.filter((c) => c.track === 'visual').sort((a, b) => a.start - b.start);
  const mp4Cap = reorderedSeq.clips.filter((c) => c.kind === 'caption').sort((a, b) => a.start - b.start);
  assert.equal(mp4Vis[0].name, 'MP4后半镜', 'Real MP4 Shot 2 moved to 00:00');
  assert.equal(mp4Cap[0].props.text, '后半段实机字幕', 'Real MP4 Shot 2 caption stayed matched at 00:00');
  assert.equal(mp4Vis[1].name, 'MP4前半镜', 'Real MP4 Shot 1 moved to 02:15');
  assert.equal(mp4Cap[1].props.text, '前半段实机字幕', 'Real MP4 Shot 1 caption stayed matched at 02:15');

  // Run Agent /新建分支试剪 on this Real MP4 project and verify ONLY forked branch changes!
  agentStep = 0;
  agentToolResults = [];
  mainSeqIdForAttempt = reorderedSeq.id;
  latestBaseRev = afterMp4Reorder.current.project.revision + 1;
  // Switch back to Timeline -> open Inspector -> 引用给 Agent -> verify slim Agent composer (zero .composer-note) & capture final pro screenshot!
  await page.locator('.editor-tabs').getByRole('button', { name: '时间线' }).click();
  await page.locator('.timeline-clip').first().click();
  await page.locator('.inspector').getByLabel('引用给 Agent').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.composer-note').count(), 0, 'Obsolete .composer-note footer removed cleanly');
  await page.locator('.composer .scope-chip').first().waitFor({ state: 'visible' });
  await page.screenshot({ path: join(auditDir, '10-pro-inspector-composer-titlebar.png') });
  // Clear clip scope so [5/5] /新建分支试剪 branch isolation test runs cleanly
  await page.getByLabel('移除片段引用').click();

  await page.getByLabel('给 Agent 的指令').fill('/新建分支试剪 在实验分支微调实机MP4首镜标题');
  await page.getByLabel('给 Agent 的指令').press('Enter');

  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => window.cocraft.call('boot'));
    if (st.current.tasks.every((x) => x.status === 'idle') && agentStep >= 4) break;
  }

  const afterMp4Agent = await page.evaluate(() => window.cocraft.call('boot'));
  const mp4MainAfter = afterMp4Agent.current.project.sequences.find((s) => s.id === mainSeqIdForAttempt);
  const mp4TrialAfter = afterMp4Agent.current.project.sequences.find((s) => s.id !== mainSeqIdForAttempt);
  assert.ok(mp4TrialAfter, 'Agent forked experimental branch on Real MP4 project');
  assert.ok(!mp4MainAfter.clips.some((c) => c.name === '实验分支已优化首镜'), 'Real MP4 main branch untouched');
  assert.ok(mp4TrialAfter.clips.some((c) => c.name === '实验分支已优化首镜'), 'Real MP4 trial branch updated');

  // Click Export -> verify Preflight passes -> Start Default MP4 Export of the trial branch!
  await page.locator('.export-button').click();
  await page.getByText(/交付预检通过/).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /导出成片/ }).click();

  let exportJob = null;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => window.cocraft.call('boot'));
    exportJob = st.jobs.find((j) => j.type === 'export');
    if (exportJob && exportJob.status !== 'running') break;
  }
  assert.ok(exportJob, 'Export job started');
  assert.equal(
    exportJob.status,
    'completed',
    `Real MP4 export MUST succeed (got ${exportJob.status}: ${exportJob.error || ''})`,
  );
  const outStat = await stat(exportJob.output);
  assert.ok(outStat.size > 10000, `Exported MP4 file size (${outStat.size} bytes) > 10KB`);

  const { stdout: probeOut } = await execFileAsync(
    ffprobeBin,
    ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', exportJob.output],
    { env: ffEnv },
  );
  const probe = JSON.parse(probeOut);
  const codecs = probe.streams.map((s) => s.codec_name);
  assert.ok(codecs.includes('h264'), 'Exported MP4 contains valid H.264 video stream');
  assert.ok(codecs.includes('aac'), 'Exported MP4 contains valid AAC audio stream');
  const durSec = Number(probe.format.duration);
  assert.ok(durSec >= 4.8 && durSec <= 5.3, `Exported MP4 duration is ~5.0s (got ${durSec}s)`);

  console.log(`PASS · [5/5] Real 5s H.264/AAC MP4 exported & ffprobe-verified (${outStat.size} bytes, ${durSec.toFixed(2)}s)`);

  // ── 6. Settings Switch Geometry, Alibaba Suite One-Click & Skills Workbench ──
  await page.getByLabel('设置 ⌘,').click();
  await page.locator('.settings-shell').waitFor({ state: 'visible' });
  await page.locator('.settings-nav').getByRole('button', { name: '外观' }).click();
  const swGeom = await page.evaluate(() => {
    const sw = document.querySelector('.settings-shell .switch');
    const r = sw.getBoundingClientRect();
    const cs = getComputedStyle(sw);
    return { width: Math.round(r.width), height: Math.round(r.height), overflow: cs.overflow };
  });
  assert.deepEqual(swGeom, { width: 36, height: 20, overflow: 'hidden' }, 'Toggle .switch fits strictly inside 36x20px clip bounds');

  await page.locator('.settings-nav').getByRole('button', { name: '提供商' }).click();
  await page.getByLabel('添加提供商').selectOption({ label: '阿里百炼 / 千问 (DashScope)' });
  await page.getByRole('button', { name: /一键添加百炼推荐全模态套件/ }).click();
  await page.locator('.settings-nav').getByRole('button', { name: '模型' }).click();
  const modelListText = await page.locator('.settings-shell .connection-list').innerText();
  for (const mId of ['qwen3.5-plus', 'qwen-image-3.0-pro', 'wan2.7-t2v', 'wan2.7-i2v', 'qwen3-tts-flash', 'qwen3-asr-flash']) {
    assert.ok(modelListText.includes(mId), `Alibaba suite populated ${mId}`);
  }

  await page.locator('.settings-nav').getByRole('button', { name: 'Skills 与工具' }).click();
  await page.locator('.skill-row').filter({ hasText: '多模态生图生视频与配音规范' }).waitFor({ state: 'visible' });
  await page.locator('.skill-toolbar-actions').getByRole('button', { name: '新建', exact: true }).click();
  await page.getByLabel('Skill 标识').fill('my-pacing-rule');
  await page.getByLabel('Skill 正文').fill('# 自定义节奏规则\n每镜不超过 4 秒，优先保留人声停顿。');
  await page.getByRole('button', { name: '保存 Skill' }).click();
  await page.locator('.skill-row').filter({ hasText: 'my-pacing-rule' }).waitFor({ state: 'visible' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(auditDir, '11-settings-alibaba-and-skills.png') });
  await page.getByLabel('删除自定义 Skill').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.skill-row').filter({ hasText: 'my-pacing-rule' }).count(), 0, 'Custom skill deleted cleanly');
  await page.locator('.settings-shell .modal-head button').click();
  console.log('PASS · [6/6] Switch geometry, Alibaba 6-model suite & Skills Workbench verified');
} finally {
  await app.close();
  mockLlmServer.close();
  await rm(dataDir, { recursive: true, force: true });
}
