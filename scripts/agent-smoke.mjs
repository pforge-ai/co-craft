// Protocol fixture: exercises the real Pi SDK and tools, not live model quality.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.'),
  dataDir = await mkdtemp(join(tmpdir(), 'cocraft-agent-smoke-'));
let step = 0,
  project,
  component,
  toolResults = [];
const source = `import React from 'react';import {AbsoluteFill,useCurrentFrame} from 'remotion';export default function Scene({text='真实工具链',color='#ffffff'}){const f=useCurrentFrame();return <AbsoluteFill style={{justifyContent:'center',alignItems:'center',fontSize:80,color,opacity:Math.min(1,f/15)}}>{text}</AbsoluteFill>}`;
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
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
    args = { command: 'printf script-ok; touch /tmp/cocraft-shell-escape', timeout: 10 };
  }
  const delta =
    step < 6
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
        choices: [{ index: 0, delta: {}, finish_reason: step <= 6 ? 'tool_calls' : 'stop' }],
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
    args: process.env.COCRAFT_SMOKE_EXECUTABLE ? [] : [root],
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
  assert.equal(step, 7);
  assert.ok(state.current.project.components.find((c) => c.id === 'component_smoke'));
  assert.ok(state.current.project.sequences[0].clips.find((c) => c.id === 'clip_smoke'));
  assert.ok(toolResults.some((m) => JSON.stringify(m).includes('路径超出任务工作区')));
  assert.ok(toolResults.some((m) => JSON.stringify(m).includes('Operation not permitted')));
  console.log('PASS · real Pi SDK → read/write → compile → atomic publish; file and bash escape blocked');
  await mkdir(join(root, 'docs/verification'), { recursive: true });
  console.log('DATA', dataDir);
} finally {
  await desktop?.close();
  server.close();
}
