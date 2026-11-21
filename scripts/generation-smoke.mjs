// Local HTTP contracts + real Electron, Pi, ffmpeg, and macOS synthesis. All projects and keys are fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { dir as mediaTools } from '@remotion/compositor-darwin-arm64';

const root = resolve('.');
const temp = await mkdtemp(join(tmpdir(), 'cocraft-model-smoke-'));
const dataDir = join(temp, 'profile');
const pngPath = join(temp, 'reference.png'),
  jpegPath = join(temp, 'shot.jpg'),
  videoPath = join(temp, 'shot.mp4');
execFileSync('/usr/bin/sips', [
  '-Z',
  '96',
  '-s',
  'format',
  'png',
  join(root, 'resources/public/coast.svg'),
  '--out',
  pngPath,
]);
execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', pngPath, '--out', jpegPath]);
execFileSync(
  join(mediaTools, 'ffmpeg'),
  [
    '-v',
    'error',
    '-loop',
    '1',
    '-framerate',
    '12',
    '-i',
    pngPath,
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    videoPath,
  ],
  { env: { ...process.env, DYLD_LIBRARY_PATH: mediaTools } },
);
const [png, jpeg, video, wav] = await Promise.all(
  [pngPath, jpegPath, videoPath, join(root, 'resources/public/coast-ambient.wav')].map((path) =>
    readFile(path),
  ),
);
const secrets = Object.fromEntries(
  ['open', 'agent', 'google', 'anthropic', 'ark', 'dash'].map((id) => [id, 'fixture-' + randomUUID()]),
);
const failures = [];
const submissions = new Map();
let unlocked = false,
  assetsDownloaded = 0,
  redirectVisits = 0,
  agentStep = 0,
  mode = 'edit',
  scene,
  prepared,
  staged,
  speechAsset,
  initialRevision,
  googleAgentCalls = 0;
const authlessHeaders = ['authorization', 'x-api-key', 'x-goog-api-key'];
const servers = [];
let desktop, page;
let packEntry, bundledAsset;
async function serve(handler) {
  const server = createServer((req, res) =>
    Promise.resolve(handler(req, res)).catch((error) => {
      failures.push(error.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fixture contract failed' } }));
    }),
  );
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  servers.push(server);
  return 'http://127.0.0.1:' + server.address().port;
}
function json(res, value, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  const bytes = [];
  for await (const chunk of req) bytes.push(chunk);
  const data = Buffer.concat(bytes);
  if ((req.headers['content-type'] || '').includes('multipart/form-data'))
    return new Response(data, { headers: { 'content-type': req.headers['content-type'] } }).formData();
  return data.length ? JSON.parse(data) : {};
}
function assistant(res, index, name, args, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = name
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'fixture-' + index,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      }
    : { role: 'assistant', content: text };
  for (const [part, reason] of [
    [delta, null],
    [{}, name ? 'tool_calls' : 'stop'],
  ])
    res.write(
      'data: ' +
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: part, finish_reason: reason }],
        }) +
        '\n\n',
    );
  res.end('data: [DONE]\n\n');
}
function editingAgent(req, res, request) {
  assert.equal(request.model, 'fixture-text');
  assert.ok(
    !JSON.stringify(request.messages).includes('data:image/'),
    'text-only Agent received binary images',
  );
  if (mode === 'stop')
    return assistant(res, 0, 'generate_media', { use: 'video', prompt: 'agent-stop', modelId: 'video-ark' });
  const lastMessage = request.messages.filter((m) => m.role === 'tool').at(-1);
  let last;
  if (lastMessage) {
    const raw =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : lastMessage.content.find((c) => c.type === 'text').text;
    try {
      last = JSON.parse(raw);
    } catch {
      last = raw;
    }
  }
  const step = agentStep++;
  if (step === 0) {
    const names = request.tools.map((t) => t.function.name);
    for (const name of [
      'list_models',
      'generate_media',
      'inspect_media',
      'transcribe_asset',
      'prepare_preset',
      'list_presets',
      'list_studio_media',
      'prepare_studio_media',
      'write',
      'compile_component',
      'preview_frame',
    ])
      assert.ok(names.includes(name), name);
    return assistant(res, step, 'read_project', {});
  }
  if (step === 1) {
    initialRevision = last.revision;
    scene = last.sequences[0].id;
    packEntry = last.components.find((c) => c.pack?.entry).workspaceEntry;
    return assistant(res, step, 'list_models', {});
  }
  if (step === 2) {
    assert.equal(last.defaults.vision, 'google-vision');
    return assistant(res, step, 'list_presets', { category: 'titles' });
  }
  if (step === 3)
    return assistant(res, step, 'prepare_preset', {
      presetId: last[0].id,
      start: 1,
      duration: 12,
      props: { text: '协议验收' },
    });
  if (step === 4) {
    prepared = last.operation;
    assert.equal(prepared.clip.props.text, '协议验收');
    return assistant(res, step, 'generate_media', {
      use: 'image',
      prompt: 'agent-image',
      modelId: 'image-open',
    });
  }
  if (step === 5) {
    staged = last.asset;
    assert.equal(staged.kind, 'image');
    return assistant(res, step, 'inspect_media', { assetId: staged.id, prompt: 'staged-frame' });
  }
  if (step === 6) {
    assert.match(last.text, /fixture vision/);
    return assistant(res, step, 'transcribe_asset', {
      assetId: speechAsset.id,
      modelId: 'asr',
      language: 'zh',
    });
  }
  if (step === 7) {
    assert.equal(last.segments.length, 1);
    return assistant(res, step, 'publish_edit', {
      baseRevision: initialRevision,
      name: '采用生成图像与可编辑预设',
      operations: [{ type: 'addAsset', asset: { id: staged.id } }, prepared],
    });
  }
  if (step === 8) {
    assert.equal(last.revision, initialRevision + 1);
    return assistant(res, step, 'preview_frame', { sequenceId: scene, frame: 1, prompt: 'preview-frame' });
  }
  if (step === 9) {
    assert.match(last.text, /fixture vision/);
    return assistant(res, step, 'list_studio_media', { kind: 'audio' });
  }
  if (step === 10) return assistant(res, step, 'prepare_studio_media', { id: last[0].id });
  if (step === 11) {
    bundledAsset = last.asset;
    return assistant(res, step, 'write', {
      path: join(dirname(packEntry), 'tone.ts'),
      content: "export const color = '#d2b493'",
    });
  }
  if (step === 12)
    return assistant(res, step, 'write', {
      path: packEntry,
      content:
        "import React from 'react';import {color} from './tone';export default function Updated(){return <div style={{color}}>素材包工作副本</div>}",
    });
  if (step === 13)
    return assistant(res, step, 'compile_component', {
      path: packEntry,
      id: 'fixture-pack-edit',
      name: '工作副本',
    });
  if (step === 14) {
    assert.ok(last.compiled.includes('#d2b493'));
    return assistant(res, step, 'publish_edit', {
      baseRevision: initialRevision + 1,
      name: '采用随附声音与修改的素材包源码',
      operations: [
        { type: 'addAsset', asset: { id: bundledAsset.id } },
        { type: 'putComponent', component: { id: last.id } },
      ],
    });
  }
  assert.equal(last.revision, initialRevision + 2);
  assistant(res, step, undefined, undefined, '协议夹具已完成');
}
async function until(read, check, description, timeout = 40000) {
  const start = Date.now();
  do {
    if (failures.length) throw new Error(failures.join('\n'));
    const value = await read();
    if (check(value)) return value;
    await delay(100);
  } while (Date.now() - start < timeout);
  throw new Error('Timeout: ' + description);
}
const cdn = await serve((req, res) => {
  if (req.url === '/redirected') {
    redirectVisits++;
    return json(res, { data: [] });
  }
  for (const key of authlessHeaders)
    assert.equal(req.headers[key], undefined, 'credential sent to media download');
  assetsDownloaded++;
  res.end(req.url === '/video.mp4' ? video : png);
});
const endpoint = await serve(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const google = path.startsWith('/v1beta/');
  const provider = google ? 'google' : path.split('/')[1];
  const expected = secrets[provider];
  const header = google ? 'x-goog-api-key' : provider === 'anthropic' ? 'x-api-key' : 'authorization';
  if (provider === 'redirect') {
    res.writeHead(307, { location: cdn + '/redirected' });
    return res.end();
  }
  assert.ok(expected, 'unknown route ' + path);
  assert.equal(
    req.headers[header],
    header === 'authorization' ? 'Bearer ' + expected : expected,
    'wrong credential at ' + path,
  );
  for (const key of authlessHeaders.filter((h) => h !== header)) assert.equal(req.headers[key], undefined);
  if (path.endsWith('/models')) {
    if (provider === 'dash') {
      assert.equal(path, '/dash/compatible-mode/v1/models');
      return json(res, { data: [{ id: 'qwen3.5-plus' }] });
    }
    return json(
      res,
      google
        ? { models: [{ name: 'models/gemini-fixture', displayName: 'Gemini fixture' }] }
        : { data: [{ id: 'fixture-model' }] },
    );
  }
  const data = await body(req);
  if (path.endsWith('/images/generations')) {
    assert.ok(data.prompt);
    if (provider === 'ark') {
      assert.equal(data.model, 'ark-image-id');
      assert.equal(data.response_format, 'b64_json');
      assert.match(data.image, /^data:image\/png;base64,/);
      return json(res, { data: [{ b64_json: jpeg.toString('base64') }] });
    }
    assert.equal(data.model, 'custom/image-id');
    if (data.prompt === 'ssrf-alibaba')
      return json(res, { data: [{ url: 'http://100.100.100.200/latest/meta-data/' }] });
    if (data.prompt === 'ssrf-v6')
      return json(res, { data: [{ url: 'https://[::ffff:127.0.0.1]/secret' }] });
    return json(res, { data: [{ url: cdn + '/image.png' }] });
  }
  if (path.endsWith('/images/edits')) {
    assert.equal(data.get('model'), 'custom/image-id');
    assert.equal(data.get('image').type, 'image/png');
    assert.equal(data.get('size'), '1024x1024');
    return json(res, { data: [{ b64_json: png.toString('base64') }] });
  }
  if (path.endsWith('/audio/speech')) {
    assert.equal(data.response_format, 'wav');
    assert.equal(data.voice, 'fixture-voice');
    res.end(wav);
    return;
  }
  if (path.endsWith('/audio/transcriptions')) {
    assert.equal(data.get('file').type, 'audio/wav');
    assert.ok(data.get('file').size > 1000);
    if (data.get('model') === 'custom/plain-transcript') {
      assert.equal(data.get('timestamp_granularities[]'), null);
      return json(res, { text: '无时间戳文稿' });
    }
    assert.equal(data.get('language'), 'zh');
    assert.equal(data.get('timestamp_granularities[]'), 'segment');
    return json(res, { text: '从海岸出发', segments: [{ start: 0.05, end: 0.3, text: '从海岸出发' }] });
  }
  if (path.endsWith('/contents/generations/tasks') || path === '/open/v1/videos') {
    const ark = provider === 'ark';
    const prompt = ark ? data.content[0].text : data.get('prompt');
    assert.ok(prompt);
    if (!ark) {
      assert.equal(data.get('input_reference').type, 'image/png');
      assert.equal(data.get('seconds'), '4');
    } else if (prompt === 'recover') {
      assert.equal(data.duration, 5);
      assert.equal(data.ratio, '16:9');
      assert.equal(data.content[1].role, 'first_frame');
    }
    submissions.set(prompt, (submissions.get(prompt) || 0) + 1);
    if (prompt === 'recover' || prompt === 'agent-stop') await delay(500);
    return json(res, { id: prompt });
  }
  if (path.includes('/contents/generations/tasks/')) {
    const id = path.split('/').at(-1);
    if (id === 'failed')
      return json(res, { status: 'failed', error: { message: 'fixture secret error ' + secrets.ark } });
    if (id === 'recover' && !unlocked) return json(res, { status: 'running', progress: 5 });
    return json(res, { status: 'succeeded', content: { video_url: cdn + '/video.mp4' } });
  }
  if (path === '/open/v1/videos/compat') return json(res, { status: 'completed' });
  if (path === '/open/v1/videos/compat/content') {
    res.end(video);
    return;
  }
  if (path === '/agent/v1/chat/completions') return editingAgent(req, res, data);
  if (path.startsWith('/v1beta/models/gemini-fixture:streamGenerateContent')) {
    googleAgentCalls++;
    assert.ok(data.contents.length && data.tools.length);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      'data: ' +
        JSON.stringify({
          candidates: [
            {
              index: 0,
              content: { role: 'model', parts: [{ text: 'Google fixture finished.' }] },
              finishReason: 'STOP',
            },
          ],
        }) +
        '\n\n',
    );
    return;
  }
  if (path === '/v1beta/models/gemini-fixture:generateContent') {
    const parts = data.contents[0].parts;
    if (parts[0].text.includes('video-sample')) assert.equal(parts.length, 4);
    for (const part of parts.slice(1)) assert.match(part.inlineData.mimeType, /^image\//);
    return json(res, { candidates: [{ content: { parts: [{ text: 'fixture vision' }] } }] });
  }
  if (path === '/anthropic/v1/messages') {
    assert.equal(data.model, 'custom-anthropic');
    assert.equal(data.messages[0].content[1].source.type, 'base64');
    return json(res, { content: [{ type: 'text', text: 'fixture anthropic' }] });
  }
  if (path === '/open/v1/chat/completions') {
    assert.equal(data.model, 'custom/vision');
    assert.match(data.messages[0].content[1].image_url.url, /^data:image/);
    return json(res, { choices: [{ message: { content: 'fixture open vision' } }] });
  }
  if (path === '/dash/compatible-mode/v1/chat/completions') {
    if (data.model === 'qwen3-asr-flash') {
      const part = data.messages.at(-1).content[0];
      assert.equal(part.type, 'input_audio');
      assert.match(part.input_audio.data, /^data:audio\/wav;base64,/);
      assert.equal(data.asr_options.language, 'zh');
      return json(res, { choices: [{ message: { content: '千问语音识别成功' } }] });
    }
    assert.equal(data.model, 'qwen3.5-plus');
    assert.match(data.messages[0].content[1].image_url.url, /^data:image/);
    return json(res, { choices: [{ message: { content: 'fixture dashscope vision' } }] });
  }
  if (path === '/dash/api/v1/services/aigc/multimodal-generation/generation') {
    if (data.model === 'qwen-image-plus') {
      const content = data.input.messages[0].content;
      assert.ok(content.some((c) => typeof c.image === 'string' && c.image.startsWith('data:image/png;base64,')));
      assert.ok(content.some((c) => c.text === '水墨海岸'));
      return json(res, { output: { choices: [{ message: { content: [{ image: cdn + '/image.png' }] } }] } });
    }
    if (data.model === 'qwen3-tts-flash') {
      assert.equal(data.input.voice, 'Cherry');
      assert.ok(data.input.text);
      return json(res, { output: { audio: { data: wav.toString('base64') } } });
    }
  }
  if (path === '/dash/api/v1/services/aigc/video-generation/video-synthesis') {
    assert.equal(req.headers['x-dashscope-async'], 'enable');
    assert.equal(data.model, 'wan2.6-i2v');
    assert.match(data.input.img_url, /^data:image\/png;base64,/);
    assert.equal(data.parameters.duration, 5);
    assert.equal(data.parameters.size, '1280*720');
    return json(res, { output: { task_id: 'dash-vid-1', task_status: 'PENDING' } });
  }
  if (path === '/dash/api/v1/tasks/dash-vid-1') {
    return json(res, {
      output: { task_id: 'dash-vid-1', task_status: 'SUCCEEDED', video_url: cdn + '/video.mp4' },
    });
  }
  throw new Error('unexpected route ' + path);
});
const connect = (id, protocol, baseUrl) => ({
  id,
  name: id,
  protocol,
  baseUrl,
  apiKey: secrets[id],
  requiresKey: true,
  hasApiKey: false,
});
const providers = [
  connect('ark', 'ark', endpoint + '/ark/api/v3'),
  connect('dash', 'dashscope', endpoint + '/dash/api/v1'),
  connect('open', 'openai', endpoint + '/open/v1'),
  connect('agent', 'openai', endpoint + '/agent/v1'),
  connect('google', 'google', endpoint),
  connect('anthropic', 'anthropic', endpoint + '/anthropic/v1'),
];
function model(id, providerId, adapter, modelId, capabilities, parameters = {}) {
  return { id, providerId, adapter, modelId, capabilities, parameters, name: id };
}
const models = [
  model('text-agent', 'agent', 'chat', 'fixture-text', ['agent']),
  model('google-agent', 'google', 'chat', 'models/gemini-fixture', ['agent']),
  model('google-vision', 'google', 'chat', 'models/gemini-fixture', ['vision']),
  model('anth-vision', 'anthropic', 'chat', 'custom-anthropic', ['vision']),
  model('open-vision', 'open', 'chat', 'custom/vision', ['vision']),
  model('dash-vision', 'dash', 'chat', 'qwen3.5-plus', ['vision']),
  model('image-open', 'open', 'openai-image', 'custom/image-id', ['image']),
  model('image-ark', 'ark', 'ark-image', 'ark-image-id', ['image']),
  model('image-dash', 'dash', 'dashscope-image', 'qwen-image-plus', ['image']),
  model('video-ark', 'ark', 'ark-video', 'ark-endpoint-id', ['video']),
  model('video-dash', 'dash', 'dashscope-video', 'wan2.6-i2v', ['video']),
  model('video-open', 'open', 'openai-video', 'compat-video-id', ['video']),
  model('cloud-speech', 'open', 'openai-speech', 'voice-model', ['speech']),
  model('speech-dash', 'dash', 'dashscope-speech', 'qwen3-tts-flash', ['speech']),
  model('asr', 'open', 'openai-transcription', 'whisper-1', ['transcription']),
  model('plain-asr', 'open', 'openai-transcription', 'custom/plain-transcript', ['transcription']),
  model('asr-dash', 'dash', 'dashscope-transcription', 'qwen3-asr-flash', ['transcription']),
];
async function launch() {
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING'].flatMap(
      (key) => (process.env[key] ? [[key, process.env[key]]] : []),
    ),
  );
  desktop = await electron.launch({
    executablePath: process.env.COCRAFT_SMOKE_EXECUTABLE,
    args: [...(process.env.COCRAFT_SMOKE_EXECUTABLE ? [] : [root]), '--use-mock-keychain'],
    env: { ...env, COCRAFT_DATA_DIR: dataDir },
    timeout: 30000,
  });
  page = await desktop.firstWindow();
  await page.waitForSelector('.app');
}
const call = (method, payload) =>
  page.evaluate(([method, payload]) => window.cocraft.call(method, payload), [method, payload]);
const boot = () => call('boot');
const readJob = async (id) => (await boot()).jobs.find((job) => job.id === id);
const complete = async (id) => {
  const job = await until(
    () => readJob(id),
    (job) => job && job.status !== 'running',
    'job ' + id,
  );
  assert.equal(job.status, 'completed', job.error);
  return job.result;
};
async function generate(input) {
  return complete((await call('generation.start', input)).id);
}
async function task(text, modelId) {
  const sequenceId = (await boot()).current.project.sequences[0].id;
  const created = await call('tasks.create', { name: text, sequenceId });
  await call('agent.start', { taskId: created.id, prompt: text, modelId });
  return created.id;
}
const finishedTask = (id) =>
  until(
    async () => (await boot()).current.tasks.find((t) => t.id === id),
    (t) => t.status !== 'running',
    'Pi session ' + id,
    80000,
  );
async function checkSecrets(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await checkSecrets(path);
    else if (entry.isFile() && /\.(jsonl?|md|txt)$/.test(entry.name)) {
      const value = await readFile(path, 'utf8');
      for (const key of Object.values(secrets))
        assert.ok(!value.includes(key), 'plain credential in ' + basename(path));
    }
  }
}
try {
  await launch();
  const { settings } = await boot();
  const registry = {
    providers: [...settings.providers, ...providers],
    models: [...settings.models, ...models],
    defaults: {
      agent: 'text-agent',
      image: 'image-open',
      speech: 'system-speech',
      video: 'video-ark',
      vision: 'google-vision',
      transcription: 'asr',
    },
  };
  const saved = await call('settings.save', registry);
  for (const p of saved.providers) assert.equal(p.apiKey, undefined);
  const discovery = await call('providers.inspect', { providerId: 'google' });
  assert.equal(discovery.models[0].id, 'gemini-fixture');
  const dashDiscovery = await call('providers.inspect', { providerId: 'dash' });
  assert.equal(dashDiscovery.models[0].id, 'qwen3.5-plus');
  const arkPublic = saved.providers.find((p) => p.id === 'ark');
  await assert.rejects(call('providers.inspect', { provider: { ...arkPublic, baseUrl: cdn } }), /API Key/);
  await assert.rejects(
    call('providers.inspect', { provider: { ...providers[0], baseUrl: endpoint + '/redirect' } }),
  );
  assert.equal(redirectVisits, 0);
  console.log('PASS provider detection, credential scoping, redirects');
  const imported = await call('media.import', { paths: [pngPath, videoPath] });
  const img = imported.project.assets.find((a) => a.path === pngPath),
    movie = imported.project.assets.find((a) => a.path === videoPath);
  assert.ok(img && movie?.duration > 0 && movie?.thumbnail);
  speechAsset = (await generate({ use: 'speech', prompt: '从海岸出发。' })).asset;
  assert.ok(speechAsset.duration > 0 && speechAsset.waveform.some((v) => v > 0));
  assert.equal(
    (await generate({ use: 'speech', modelId: 'cloud-speech', voice: 'fixture-voice', prompt: '云配音协议' }))
      .asset.kind,
    'audio',
  );
  const artwork = (await generate({ use: 'image', prompt: '海岸插画' })).asset;
  assert.equal(artwork.width, 96);
  await generate({ use: 'image', referenceAssetId: img.id, prompt: '修改构图', size: '1024x1024' });
  const arkImage = (
    await generate({ use: 'image', modelId: 'image-ark', referenceAssetId: img.id, prompt: '近景' })
  ).asset;
  assert.equal(extname(arkImage.path), '.jpg');
  const transcript = await generate({ use: 'transcription', assetId: speechAsset.id, language: 'zh' });
  assert.deepEqual(transcript.segments, [{ start: 0.05, end: 0.3, text: '从海岸出发' }]);
  assert.deepEqual(
    (await generate({ use: 'transcription', assetId: speechAsset.id, modelId: 'plain-asr' })).segments,
    [],
  );
  for (const [modelId, expected] of [
    ['anth-vision', 'fixture anthropic'],
    ['open-vision', 'fixture open vision'],
    ['dash-vision', 'fixture dashscope vision'],
  ])
    assert.equal((await generate({ use: 'vision', assetId: img.id, modelId })).text, expected);
  assert.equal(
    (
      await generate({
        use: 'speech',
        modelId: 'speech-dash',
        voice: 'Cherry',
        prompt: '千问配音测试',
      })
    ).asset.kind,
    'audio',
  );
  const dashImage = (
    await generate({ use: 'image', modelId: 'image-dash', referenceAssetId: img.id, prompt: '水墨海岸' })
  ).asset;
  assert.equal(dashImage.width, 96);
  const dashTranscript = await generate({
    use: 'transcription',
    modelId: 'asr-dash',
    assetId: speechAsset.id,
    language: 'zh',
  });
  assert.equal(dashTranscript.text, '千问语音识别成功');
  assert.equal(dashTranscript.segments.length, 1);
  const dashVideo = (
    await generate({
      use: 'video',
      modelId: 'video-dash',
      referenceAssetId: img.id,
      prompt: '海岸起风镜头',
      seconds: 5,
      size: '1280x720',
    })
  ).asset;
  assert.ok(dashVideo.duration > 0 && dashVideo.thumbnail);
  await assert.rejects(
    call('generation.start', { use: 'video', modelId: 'video-dash', prompt: 'missing-ref' }),
    /参考图片/,
  );
  assert.match(
    (await generate({ use: 'vision', assetId: movie.id, prompt: 'video-sample' })).text,
    /采样位置/,
  );
  console.log(
    'PASS real media import, system voice, Images generation/edit, speech, timed/plain transcription, independent vision',
  );
  const seqBefore = (await boot()).current.project;
  const cloud = await call('generation.start', {
    use: 'video',
    prompt: 'recover',
    referenceAssetId: img.id,
    seconds: 5,
    size: '1280x720',
  });
  await until(
    () => submissions.get('recover'),
    (n) => n === 1,
    'creation',
  );
  await call('jobs.cancel', { id: cloud.id });
  await until(
    () => readJob(cloud.id),
    (j) => j?.status === 'cancelled' && j.remote?.id === 'recover',
    'cancelled submission acknowledgement',
  );
  assert.equal((await boot()).current.project.revision, seqBefore.revision);
  await call('generation.resume', { id: cloud.id });
  await until(
    () => readJob(cloud.id),
    (j) => j?.remote?.status === 'running',
    'first poll',
  );
  await desktop.close();
  desktop = undefined;
  await launch();
  const restored = await readJob(cloud.id);
  assert.equal(restored.status, 'failed');
  assert.equal(restored.remote.id, 'recover');
  unlocked = true;
  await Promise.all([
    call('generation.resume', { id: cloud.id }),
    call('generation.resume', { id: cloud.id }),
  ]);
  const recovered = (await complete(cloud.id)).asset;
  assert.ok(recovered.duration > 0 && recovered.thumbnail);
  assert.equal(submissions.get('recover'), 1);
  const after = (await boot()).current.project;
  assert.equal(after.assets.filter((a) => a.id === recovered.id).length, 1);
  assert.equal(after.revision, seqBefore.revision + 1);
  await call('generation.resume', { id: cloud.id });
  assert.equal((await boot()).current.project.revision, after.revision);
  await generate({
    use: 'video',
    modelId: 'video-open',
    prompt: 'compat',
    seconds: 4,
    referenceAssetId: img.id,
  });
  const failed = await call('generation.start', { use: 'video', prompt: 'failed' });
  const terminal = await until(
    () => readJob(failed.id),
    (j) => j?.status === 'failed',
    'terminal status',
  );
  assert.equal(terminal.remote.status, 'failed');
  assert.ok(!terminal.error.includes(secrets.ark));
  await assert.rejects(call('generation.resume', { id: failed.id }), /终止/);
  const ssrfAliJob = await call('generation.start', {
    use: 'image',
    modelId: 'image-open',
    prompt: 'ssrf-alibaba',
  });
  const ssrfAliDone = await until(
    () => readJob(ssrfAliJob.id),
    (j) => j?.status === 'failed',
    'ssrf alibaba blocked',
  );
  assert.match(ssrfAliDone.error, /云元数据|内网|拦截/);
  const ssrfV6Job = await call('generation.start', {
    use: 'image',
    modelId: 'image-open',
    prompt: 'ssrf-v6',
  });
  const ssrfV6Done = await until(
    () => readJob(ssrfV6Job.id),
    (j) => j?.status === 'failed',
    'ssrf v6 blocked',
  );
  assert.match(ssrfV6Done.error, /本机|内网|拦截/);
  console.log(
    'PASS cancel during submission, restart and concurrent resume with one POST, terminal statuses, multipart Videos compatibility, SSRF blocks (100.100.100.200 & ::ffff:127.0.0.1)',
  );
  const packBaseline = await call('packs.import', { example: true });
  const original = packBaseline.project.components.find((c) => c.pack?.entry);
  const originalSource = await readFile(join(original.pack.sourceDirectory, original.pack.entry), 'utf8');
  const t = await finishedTask(await task('实际 Pi 工具组合的本地协议验收'));
  assert.equal(t.status, 'idle', JSON.stringify(t.messages.filter((m) => m.role === 'system')));
  assert.equal(agentStep, 16);
  const edited = (await boot()).current.project;
  const copy = edited.components.find((c) => c.id === 'fixture-pack-edit');
  assert.notEqual(copy.pack.sourceDirectory, original.pack.sourceDirectory);
  assert.match(await readFile(join(copy.pack.sourceDirectory, 'tone.ts'), 'utf8'), /#d2b493/);
  assert.equal(
    await readFile(join(original.pack.sourceDirectory, original.pack.entry), 'utf8'),
    originalSource,
  );
  assert.ok(edited.assets.some((a) => a.id === bundledAsset.id));
  assert.ok((await boot()).current.project.assets.some((a) => a.id === staged.id));
  const g = await finishedTask(await task('Google 主 Agent 协议验收', 'google-agent'));
  assert.equal(g.status, 'idle', JSON.stringify(g.messages.filter((m) => m.role === 'system')));
  assert.equal(googleAgentCalls, 1);
  mode = 'stop';
  const startRevision = (await boot()).current.project.revision;
  const stopping = await task('停止生成中的 Agent');
  await until(
    () => submissions.get('agent-stop'),
    (n) => n === 1,
    'agent video submission',
  );
  assert.equal(
    (await call('agent.start', { taskId: stopping, prompt: '追加说明', modelId: 'does-not-exist' })).queued,
    true,
  );
  await call('agent.stop', { taskId: stopping });
  await until(
    async () => (await boot()).jobs.find((j) => j.remote?.id === 'agent-stop'),
    (j) => j?.status === 'cancelled',
    'revoked Agent',
  );
  assert.equal((await boot()).current.project.revision, startRevision);
  await checkSecrets(dataDir);
  assert.ok(assetsDownloaded >= 2);
  assert.deepEqual(failures, []);
  console.log(
    'PASS real Pi tools, studio audio, editable pack dependencies, text-only preview analysis, Google main model, steer, stop and credential-free persistence',
  );
} finally {
  await desktop?.close();
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}
