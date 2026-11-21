// Protocol fixture: exercises the real Pi SDK and tools, not live model quality.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.'),
  dataDir = await mkdtemp(join(tmpdir(), 'cocraft-agent-smoke-'));
let step = 0,
  project,
  component,
  toolResults = [],
  dashscopeChatUrl = '',
  dashscopeEnableThinking = undefined;
const source = `import React from 'react';import {AbsoluteFill,useCurrentFrame} from 'remotion';export default function Scene({text='真实工具链',color='#ffffff'}){const f=useCurrentFrame();return <AbsoluteFill style={{justifyContent:'center',alignItems:'center',fontSize:80,color,opacity:Math.min(1,f/15)}}>{text}</AbsoluteFill>}`;
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (req.url?.startsWith('/dash/')) {
    dashscopeChatUrl = req.url;
    dashscopeEnableThinking = body.enable_thinking;
    assert.equal(
      req.url,
      '/dash/compatible-mode/v1/chat/completions',
      'DashScope Agent preset must route to /compatible-mode/v1/chat/completions (never 404 on /api/v1)',
    );
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(
      'data: ' +
        JSON.stringify({
          id: 'chat_dash',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'qwen3.5-plus',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'DashScope 兼容端点连通正常。' }, finish_reason: null }],
        }) +
        '\n\n',
    );
    res.write(
      'data: ' +
        JSON.stringify({
          id: 'chat_dash',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }) +
        '\n\n',
    );
    res.end('data: [DONE]\n\n');
    return;
  }
  // Wave A regression: non-reasoning models must NEVER receive reasoning_effort or developer role.
  assert.equal(body.reasoning_effort, undefined, 'Non-reasoning model must not receive reasoning_effort');
  assert.equal(
    body.messages.some((m) => m.role === 'developer'),
    false,
    'Custom/non-OpenAI provider must not receive developer role',
  );
  toolResults = body.messages.filter((m) => m.role === 'tool');
  let name, args;
  if (step === 0) {
    name = 'read_project';
    args = {};
  }
  if (step === 1) {
    name = 'write';
    args = { path: 'components/smoke.tsx', content: source };
  }
  if (step === 2) {
    name = 'compile_component';
    args = {
      path: 'components/smoke.tsx',
      id: 'component_smoke',
      name: 'Smoke 标题',
      props: { text: '真实工具链', color: '#ffffff' },
    };
  }
  if (step === 3) {
    const tool = toolResults.at(-1);
    const value =
      typeof tool.content === 'string' ? tool.content : tool.content.find((c) => c.type === 'text').text;
    component = JSON.parse(value);
    name = 'publish_edit';
    args = {
      baseRevision: project.revision,
      name: 'Pi 工具链 Smoke',
      operations: [
        { type: 'putComponent', component },
        {
          type: 'addClip',
          sequenceId: project.sequences[0].id,
          clip: {
            id: 'clip_smoke',
            name: 'Pi 编码标题',
            kind: 'code',
            track: 'overlay',
            start: 0,
            duration: 60,
            sourceIn: 0,
            componentId: 'component_smoke',
            locked: false,
            props: { text: '真实工具链' },
          },
        },
      ],
    };
  }
  if (step === 4) {
    name = 'write';
    args = { path: '/tmp/cocraft-outside-scope.txt', content: 'must be rejected' };
  }
  if (step === 5) {
    name = 'bash';
    args = {
      command:
        'printf script-ok; touch /tmp/cocraft-shell-escape; ln -sf /tmp/cocraft-symlink-escape.txt escape-link.txt',
      timeout: 10,
    };
  }
  if (step === 6) {
    // Wave A security regression: dangling symlink write escape MUST be blocked!
    name = 'write';
    args = { path: 'escape-link.txt', content: 'escaped via dangling symlink' };
  }
  if (step === 7) {
    // Wave A security regression: relinkAsset via Agent publish_edit MUST be blocked!
    name = 'publish_edit';
    args = {
      baseRevision: project.revision + 1,
      name: '越权重连素材',
      operations: [{ type: 'relinkAsset', assetId: 'any_asset', path: '/etc/hosts' }],
    };
  }
  if (step === 8) {
    name = 'search_assets';
    args = { scope: 'studio', kind: 'style' };
  }
  if (step === 9) {
    name = 'publish_edit';
    args = {
      baseRevision: project.revision + 1,
      name: '应用内置视觉风格',
      operations: [{ type: 'setActiveBrand', itemId: 'gstyle_cobalt_night' }],
    };
  }
  if (step === 10) {
    name = 'preview_frame';
    args = { sequenceId: project.sequences[0].id, frame: 5 };
  }
  const delta =
    step < 11
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_' + step,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        }
      : { role: 'assistant', content: 'Smoke fixture completed.' };
  console.log('fixture', step, name || 'done');
  step++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(
    'data: ' +
      JSON.stringify({
        id: 'chat_smoke',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'smoke-model',
        choices: [{ index: 0, delta, finish_reason: null }],
      }) +
      '\n\n',
  );
  res.write(
    'data: ' +
      JSON.stringify({
        id: 'chat_smoke',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: step <= 11 ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }) +
      '\n\n',
  );
  res.end('data: [DONE]\n\n');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let desktop;
try {
  desktop = await electron.launch({
    executablePath: process.env.COCRAFT_SMOKE_EXECUTABLE,
    args: [...(process.env.COCRAFT_SMOKE_EXECUTABLE ? [] : [root]), '--use-mock-keychain'],
    env: { ...process.env, COCRAFT_DATA_DIR: dataDir },
    timeout: 30000,
  });
  desktop.process().stderr.on('data', (d) => {
    if (String(d).includes('Error')) console.log(String(d).slice(0, 1000));
  });
  const page = await desktop.firstWindow();
  await page.waitForSelector('.app');
  const call = (method, payload) =>
    page.evaluate(({ method, payload }) => window.cocraft.call(method, payload), { method, payload });
  project = (await call('boot')).current.project;
  await call('settings.save', {
    provider: 'custom',
    model: 'smoke-model',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: 'fixture-only',
    allowShell: true,
  });
  const task = await call('tasks.create', { name: '协议夹具验证', sequenceId: project.sequences[0].id });
  await call('agent.start', { taskId: task.id, prompt: 'Run protocol fixture', context: '' });
  let state;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 500));
    state = await call('boot');
    const t = state.current.tasks.find((t) => t.id === task.id);
    if (t.status !== 'running') {
      console.log('task', t.status, JSON.stringify(t.messages.filter((m) => m.role === 'system')));
      break;
    }
  }
  const t = state.current.tasks.find((t) => t.id === task.id);
  assert.equal(t.status, 'idle');
  assert.equal(step, 12);
  assert.ok(state.current.project.components.find((c) => c.id === 'component_smoke'));
  assert.ok(state.current.project.sequences[0].clips.find((c) => c.id === 'clip_smoke'));
  assert.equal(state.current.project.activeBrandId, 'gstyle_cobalt_night', 'setActiveBrand applied built-in style');
  assert.ok(
    toolResults.some((m) => JSON.stringify(m).includes('gstyle_cobalt_night') && JSON.stringify(m).includes('built-in-style')),
    'search_assets studio style returned BUILT_IN_STYLES',
  );
  assert.ok(toolResults.some((m) => JSON.stringify(m).includes('renderedOk')), 'preview_frame succeeded without vision model');
  assert.equal(state.jobs.filter((j) => j.type === 'export').length, 0, 'preview_frame silent render did NOT pollute jobs');
  assert.ok(toolResults.some((m) => JSON.stringify(m).includes('路径超出任务工作区')));
  assert.ok(toolResults.some((m) => JSON.stringify(m).includes('Operation not permitted')));
  assert.ok(
    toolResults.some((m) => JSON.stringify(m).includes('Agent 不能直接重连素材路径')),
    'relinkAsset escape rejected for Agent',
  );
  assert.equal(existsSync('/tmp/cocraft-symlink-escape.txt'), false, 'dangling symlink write escape blocked');
  assert.equal(existsSync('/tmp/cocraft-shell-escape'), false, 'sandbox-exec outside write blocked');

  // Wave A regression: DashScope protocol preset routes Pi Agent to /compatible-mode/v1 and maps thinking to enable_thinking
  await call('settings.save', {
    providers: [
      {
        id: 'prov_dash_smoke',
        name: '阿里百炼 Smoke',
        protocol: 'dashscope',
        baseUrl: `http://127.0.0.1:${server.address().port}/dash/api/v1`,
        apiKey: 'dash-fixture-key',
        requiresKey: true,
      },
    ],
    models: [
      {
        id: 'model_qwen_smoke',
        providerId: 'prov_dash_smoke',
        name: 'Qwen3.5 Plus',
        modelId: 'qwen3.5-plus',
        capabilities: ['agent', 'vision'],
        adapter: 'chat',
        parameters: {},
      },
    ],
    defaults: { agent: 'model_qwen_smoke' },
  });
  const dashTask = await call('tasks.create', { name: '百炼主模型连通验证', sequenceId: project.sequences[0].id });
  await call('agent.start', {
    taskId: dashTask.id,
    prompt: '你好',
    context: '',
    thinkingLevel: 'low',
  });
  let dashState;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    dashState = await call('boot');
    const dt = dashState.current.tasks.find((x) => x.id === dashTask.id);
    if (dt.status !== 'running') break;
  }
  const dt = dashState.current.tasks.find((x) => x.id === dashTask.id);
  assert.equal(dt.status, 'idle', 'DashScope Agent run completed without 404');
  assert.equal(dashscopeChatUrl, '/dash/compatible-mode/v1/chat/completions');
  assert.equal(dashscopeEnableThinking, true, 'Qwen3 thinking maps to enable_thinking=true');

  console.log('PASS · real Pi SDK → read/write/compile/publish + search_assets(style)/setActiveBrand + silent preview_frame fallback + DashScope Agent compat routing; symlink/relink/sandbox escapes blocked');
  await rm('/tmp/cocraft-symlink-escape.txt', { force: true }).catch(() => {});
  await mkdir(join(root, 'docs/verification'), { recursive: true });
  console.log('DATA', dataDir);
} finally {
  await desktop?.close();
  server.close();
}
