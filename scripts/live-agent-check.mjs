// Explicit opt-in. Only an encrypted settings copy and a fresh example project enter this run.
import { _electron as electron } from 'playwright';
import { copyFile, mkdtemp, chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (!process.argv.includes('--deepseek')) throw new Error('实模验收需显式传入 --deepseek');
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'cocraft-live-'));
const evidence = join(root, 'docs', 'verification', 'v2');
const custom = process.argv.includes('--component');
const label = custom ? '立体声电平' : '现场录音';
const recordName = custom ? 'deepseek-component' : 'deepseek-edit';
const prompt = custom
  ? '为当前横版的声音实验写一个全新的可编程透明叠加画面。放在第 8 秒，持续 3 秒，右上角安全区内做一块紧凑的录音电平表，名称「立体声电平」，有 L/R 通道和按帧运动的电平格，琥珀色峰值。让中文文案和强调色能在属性里调节，底层画面要看得见。请用一个独立 TSX 文件完成，编译后直接发布，只增加这一个片段。发布后用一句话报告实际结果。静帧由工作台导出检查。'
  : '在当前主片的第 8 秒加入一条持续 3 秒的动态角标，主文案为「现场录音」，用内置可编辑模板制作。请读取工程和素材目录并直接发布到时间线，只新增这一个片段，保留其他片段和竖版。完成后说明实际时间与模板。';
let app;
try {
  await chmod(profile, 0o700);
  const settingsFile = join(homedir(), 'Library', 'Application Support', 'CoCraft', 'settings.json');
  await copyFile(settingsFile, join(profile, 'settings.json'));
  await chmod(join(profile, 'settings.json'), 0o600);
  const executablePath =
    process.env.COCRAFT_SMOKE_EXECUTABLE ||
    join(root, 'release', '0.2', 'mac-arm64', 'CoCraft.app', 'Contents', 'MacOS', 'CoCraft');
  app = await electron.launch({
    executablePath,
    args: executablePath ? [] : [root],
    env: { ...process.env, COCRAFT_DATA_DIR: profile },
    timeout: 45000,
  });
  const page = await app.firstWindow();
  await page.locator('.app').waitFor({ timeout: 45000 });
  const call = (method, payload) =>
    page.evaluate(({ method, payload }) => window.cocraft.call(method, payload), { method, payload });
  const start = await call('boot'),
    before = start.current.project,
    seq = before.sequences[0];
  const model = start.settings.models.find(
    (m) => m.id === (before.modelDefaults?.agent || start.settings.defaults.agent),
  );
  assert.ok(model && /deepseek/i.test(model.modelId), '默认 Agent 模型应为已配置的 DeepSeek');
  assert.ok(
    start.settings.providers.find((p) => p.id === model.providerId)?.hasApiKey,
    '已配置模型需要保存凭据',
  );
  const beginning = Date.now();
  await page.getByRole('button', { name: '新建 Agent 任务' }).click();
  const composer = page.getByRole('textbox', { name: '给 Agent 的指令' });
  await composer.fill(prompt);
  await composer.press('Enter');
  const waitForState = async (predicate, timeout = custom ? 540000 : 240000) => {
    const until = Date.now() + timeout;
    let state;
    do {
      state = await call('boot');
      const error = await page
        .locator('.toast.error')
        .first()
        .textContent({ timeout: 80 })
        .catch(() => null);
      if (error) throw new Error(error);
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } while (Date.now() < until);
    throw new Error(
      '等待任务超时，状态 ' +
        JSON.stringify(
          state.current.tasks.map((t) => ({ status: t.status, roles: t.messages.map((m) => m.role) })),
        ),
    );
  };
  const finish = await waitForState((state) => {
    const task = state.current.tasks.find((t) =>
      t.messages.some((m) => m.role === 'user' && m.text === prompt),
    );
    const published =
      state.current.project.revision > before.revision &&
      state.current.project.sequences
        .find((s) => s.id === seq.id)
        ?.clips.some((c) => !seq.clips.some((old) => old.id === c.id));
    return (
      published ||
      (task &&
        task.status !== 'running' &&
        task.messages.some((m) => m.role === 'assistant' || m.role === 'system'))
    );
  });
  const final = finish.current.project;
  const task = finish.current.tasks.find((t) => t.messages.some((m) => m.text === prompt));
  assert.ok(
    task && task.status !== 'error',
    task?.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.text)
      .join(' ') || '模型执行失败',
  );
  const after = final.sequences.find((s) => s.id === seq.id),
    newClips = after.clips.filter((c) => !seq.clips.some((old) => c.id === old.id));
  let last = task.messages.filter((m) => m.role === 'assistant').at(-1)?.text || '';
  assert.equal(
    newClips.length,
    1,
    '实模应发布一个新片段，实际 ' + newClips.length + '。' + last.slice(0, 220),
  );
  const clip = newClips[0];
  assert.equal(clip.start, seq.fps * 8);
  assert.equal(clip.duration, seq.fps * 3);
  assert.ok(
    JSON.stringify(clip.props).includes(label) ||
      JSON.stringify(final.components.find((c) => c.id === clip.componentId)?.props || {}).includes(label),
  );
  const component = final.components.find((c) => c.id === clip.componentId);
  if (custom) {
    assert.ok(
      component && clip.kind === 'code' && component.compiled && component.hash,
      '新图形应通过组件编译',
    );
    assert.ok(component.source.includes('useCurrentFrame'), '电平应有逐帧动画');
  }
  assert.deepEqual(
    after.clips.filter((c) => c.id !== clip.id),
    seq.clips,
  );
  assert.deepEqual(final.sequences.slice(1), before.sequences.slice(1));
  const job = await call('export.still', { sequenceId: seq.id, frame: 9 * seq.fps });
  const rendered = (
    await waitForState(
      (s) => s.jobs.some((j) => j.id === job.id && ['completed', 'failed'].includes(j.status)),
      100000,
    )
  ).jobs.find((j) => j.id === job.id);
  assert.equal(rendered.status, 'completed', rendered.error);
  await mkdir(evidence, { recursive: true });
  await copyFile(rendered.output, join(evidence, recordName + '.png'));
  if (custom) {
    const dir = join(root, 'artifacts', 'Stereo-Meter');
    await mkdir(dir, { recursive: true });
    const template = {
      id: 'stereo-meter',
      name: component.name,
      entry: 'StereoMeter.tsx',
      durationSeconds: 3,
      defaultProps: component.props,
    };
    const manifest = {
      schemaVersion: 1,
      id: 'stereo-meter',
      name: '立体声电平',
      version: '1.0.0',
      author: 'CoCraft · ' + model.modelId,
      license: 'CC0-1.0',
      templates: [template],
    };
    await writeFile(join(dir, 'StereoMeter.tsx'), component.source);
    await writeFile(join(dir, 'cocraft-pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  let finishedTask = (await call('boot')).current.tasks.find((t) => t.id === task.id);
  if (finishedTask?.status === 'running') {
    await new Promise((r) => setTimeout(r, 3500));
    finishedTask = (await call('boot')).current.tasks.find((t) => t.id === task.id);
    if (finishedTask.status === 'running') {
      await call('agent.stop', { taskId: task.id });
      finishedTask = (await call('boot')).current.tasks.find((t) => t.id === task.id);
    }
  }
  last = finishedTask?.messages.filter((m) => m.role === 'assistant').at(-1)?.text || last;
  const record = {
    verifiedAt: new Date().toISOString(),
    model: model.modelId,
    version: finish.version,
    prompt,
    before: before.revision,
    after: final.revision,
    clip: {
      title: clip.name,
      start: clip.start,
      duration: clip.duration,
      fps: seq.fps,
      preset: clip.props.presetId,
      text: label,
    },
    tools: (finishedTask?.messages || task.messages)
      .filter((m) => m.role === 'tool')
      .map((m) => m.tool || m.text),
    response: last,
    seconds: Math.round((Date.now() - beginning) / 1000),
  };
  await writeFile(join(evidence, recordName + '.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(
    '实模发布已验证',
    JSON.stringify({
      model: model.modelId,
      start: clip.start,
      duration: clip.duration,
      seconds: record.seconds,
    }),
  );
} finally {
  await app?.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}
