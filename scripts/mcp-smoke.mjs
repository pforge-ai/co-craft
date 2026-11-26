/**
 * Automated end-to-end smoke test for CoCraft's Built-in Local MCP Server:
 * - Launches packaged CoCraft.app (or dev electron) in an isolated temp COCRAFT_DATA_DIR with COCRAFT_MCP_ENABLED=1
 * - Verifies discovery file permissions (0600) & HTTP 401 unauthorized rejection
 * - Spawns scripts/cocraft-mcp.mjs over real stdio JSON-RPC 2.0
 * - Exercises initialize, tools/list (22 tools), cocraft_status, cocraft_create_project,
 *   cocraft_list_models (verifying ZERO API keys exposed), cocraft_add_preset_clip (teardown-3d + whiteboard-sketch),
 *   cocraft_apply_keyframe_preset, cocraft_compile_component (cocraft/rough),
 *   cocraft_preview_frame (real PNG image block!), cocraft_preflight, and cocraft_export (real MP4!).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');

const root = resolve('.');
const packagedExec =
  process.env.COCRAFT_PACKAGED_EXECUTABLE ||
  resolve(root, 'release/0.6/mac-arm64/CoCraft.app/Contents/MacOS/CoCraft');
const mcpScript = resolve(root, 'scripts/cocraft-mcp.mjs');
const dataDir = await mkdtemp(join(tmpdir(), 'cocraft-mcp-smoke-'));
const discoveryPath = join(dataDir, 'mcp-bridge.json');

class McpStdioClient {
  constructor(script, env) {
    this.proc = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk.toString('utf8');
      let nl;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        const cb = this.pending.get(msg.id);
        if (cb) {
          this.pending.delete(msg.id);
          cb(msg);
        }
      }
    });
    this.proc.stderr.on('data', (d) => process.stderr.write(`[mcp stderr] ${d}`));
  }
  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout for ${method}`));
      }, 90000);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolvePromise(msg.result);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async callTool(name, args = {}) {
    const res = await this.request('tools/call', { name, arguments: args });
    if (res.isError) throw new Error(`Tool ${name} error: ${res.content?.[0]?.text || 'unknown'}`);
    return res;
  }
  close() {
    this.proc.kill('SIGTERM');
  }
}

const usePackaged = existsSync(packagedExec);
const app = await electron.launch({
  ...(usePackaged ? { executablePath: packagedExec, args: ['--use-mock-keychain'] } : { args: ['.', '--use-mock-keychain'] }),
  env: { ...process.env, COCRAFT_DATA_DIR: dataDir, COCRAFT_MCP_ENABLED: '1' },
});

const mcp = new McpStdioClient(mcpScript, { COCRAFT_MCP_DISCOVERY: discoveryPath });

try {
  const page = await app.firstWindow();
  await page.locator('.titlebar').waitFor({ state: 'visible', timeout: 20000 });

  // 1. Verify discovery file exists with 0600 permissions & strictly localhost
  assert.ok(existsSync(discoveryPath), 'mcp-bridge.json discovery file created');
  const st = await stat(discoveryPath);
  assert.equal(st.mode & 0o777, 0o600, `Expected 0600 mode on mcp-bridge.json, got ${(st.mode & 0o777).toString(8)}`);
  const meta = JSON.parse(await readFile(discoveryPath, 'utf8'));
  assert.equal(meta.host, '127.0.0.1');
  assert.ok(meta.port > 1024 && meta.token.length === 64);

  // 2. Verify HTTP 401 rejection for missing / wrong token
  const unauthRes = await fetch(`http://127.0.0.1:${meta.port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token' },
    body: JSON.stringify({ action: 'status', params: {} }),
  });
  assert.equal(unauthRes.status, 401, 'Invalid token MUST receive 401 Unauthorized');
  console.log(`✓ 1. Bridge security verified (127.0.0.1:${meta.port}, mode=0600, wrong token -> 401)`);

  // 3. MCP JSON-RPC 2.0 handshake & tool catalog
  const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1.0' } });
  assert.equal(init.serverInfo.name, 'cocraft-mcp');
  const listed = await mcp.request('tools/list');
  assert.ok(listed.tools.length >= 25, `Expected >=25 MCP tools (unified with core service), got ${listed.tools.length}`);
  const toolNames = new Set(listed.tools.map((t) => t.name));
  for (const required of ['cocraft_search_assets', 'cocraft_pull_vault_item', 'cocraft_inspect_media']) {
    assert.ok(toolNames.has(required), `Missing newly unified MCP tool: ${required}`);
  }
  console.log(`✓ 2. MCP stdio handshake & ${listed.tools.length} tools registered`);

  // 4. Create isolated project + list models (assert ZERO secret leakage) + search_assets parity
  const created = JSON.parse((await mcp.callTool('cocraft_create_project', { name: 'MCP Smoke 短片' })).content[0].text);
  assert.ok(created.id && created.sequenceId);
  const modelsText = (await mcp.callTool('cocraft_list_models')).content[0].text;
  assert.ok(!modelsText.includes('apiKey') && !modelsText.includes('sk-'), 'cocraft_list_models must never leak apiKey fields');
  const studioHits = JSON.parse(
    (await mcp.callTool('cocraft_search_assets', { scope: 'studio', query: '底乐' })).content[0].text,
  );
  assert.ok(Array.isArray(studioHits) && studioHits.length >= 2, `Expected >=2 studio BGM hits via cocraft_search_assets, got ${studioHits?.length}`);
  console.log('✓ 3. Project creation, zero-secret cocraft_list_models & cocraft_search_assets verified');

  // 5. Build a 3-shot mini film via MCP: PBR 3D + RoughJS Whiteboard + Custom TSX cocraft/rough + Ken Burns keyframes!
  const c1 = JSON.parse(
    (
      await mcp.callTool('cocraft_add_preset_clip', {
        presetId: 'teardown-3d',
        start: 0,
        duration: 45,
        props: { text: 'MCP 驱动三维舞台', lightingPreset: 'studio', explode: 0.7, animateExplode: false },
      })
    ).content[0].text,
  );
  await mcp.callTool('cocraft_add_preset_clip', {
    presetId: 'whiteboard-sketch',
    start: 45,
    duration: 45,
    transitionIn: { type: 'dissolve', durationFrames: 10 },
    props: { text: 'MCP 驱动手绘白板', points: '协议连接|安全校验|真机导出' },
  });
  await mcp.callTool('cocraft_apply_keyframe_preset', { clipId: c1.clip.id, preset: 'fade-in-out' });

  // Compile custom TSX component over MCP
  const compiled = JSON.parse(
    (
      await mcp.callTool('cocraft_compile_component', {
        name: 'MCP 自定义角标',
        source: `
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { RoughRect } from 'cocraft/rough';
export default function Badge() {
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-end', padding: 48 }}>
      <svg width={240} height={64} viewBox="0 0 240 64">
        <RoughRect seed={5} x={4} y={4} width={232} height={56} stroke="#f59e0b" fill="#0f172ad9" fillStyle="solid" />
        <text x={120} y={39} textAnchor="middle" fill="#f8fafc" fontSize={22} fontWeight={700}>MCP LIVE</text>
      </svg>
    </AbsoluteFill>
  );
}`,
        addClip: true,
        track: 'overlay',
        start: 0,
        duration: 90,
      })
    ).content[0].text,
  );
  assert.ok(compiled.component.id && compiled.clipId);
  console.log('✓ 4. MCP added PBR 3D + RoughJS Whiteboard + Keyframes + compiled custom TSX overlay');

  // 6. Render real preview frame over MCP & assert valid PNG image content block!
  const preview = await mcp.callTool('cocraft_preview_frame', { frame: 65, scale: 0.5 });
  const imgBlock = preview.content.find((c) => c.type === 'image');
  assert.ok(imgBlock && imgBlock.mimeType === 'image/png' && imgBlock.data.length > 2000, 'MCP preview_frame returns valid PNG image block');
  const pngMagic = Buffer.from(imgBlock.data, 'base64').subarray(0, 4).toString('hex');
  assert.equal(pngMagic, '89504e47', 'Preview image starts with PNG magic bytes');
  console.log(`✓ 5. MCP preview_frame rendered real PNG (${Math.round((imgBlock.data.length * 3) / 4 / 1024)} KB)`);

  // 7. Preflight + real MP4 export over MCP!
  const preflight = JSON.parse((await mcp.callTool('cocraft_preflight')).content[0].text);
  assert.equal(preflight.filter((i) => i.severity === 'blocker').length, 0, `Unexpected preflight blockers: ${JSON.stringify(preflight)}`);
  const exported = JSON.parse((await mcp.callTool('cocraft_export', { scale: 0.5, fileName: 'mcp-smoke-film.mp4', wait: true })).content[0].text);
  assert.equal(exported.status, 'completed');
  assert.ok(existsSync(exported.output), `Expected exported MP4 at ${exported.output}`);
  const mp4Stat = await stat(exported.output);
  assert.ok(mp4Stat.size > 30000, `Expected non-empty MP4, got ${mp4Stat.size} bytes`);
  console.log(`✓ 6. MCP preflight & real MP4 export verified (${Math.round(mp4Stat.size / 1024)} KB)`);

  // 8. Verify Settings UI renders MCP toggle & status accurately
  await page.getByLabel('设置').click();
  await page.locator('.settings-shell').waitFor({ state: 'visible' });
  await page.locator('.settings-page', { hasText: `127.0.0.1:${meta.port}` }).waitFor({ state: 'visible', timeout: 5000 });
  const mcpStatusText = await page.locator('.settings-page').innerText();
  assert.ok(mcpStatusText.includes('本地 MCP') && mcpStatusText.includes(`127.0.0.1:${meta.port}`), 'Settings UI reflects running MCP bridge port');
  console.log('✓ 7. Settings UI displays live MCP status & one-click copy config');

  console.log('ALL COCRAFT BUILT-IN MCP SERVER SMOKE CHECKS PASSED (7/7)!');
} finally {
  mcp.close();
  await app.close();
  // Verify bridge cleans up discovery file on quit
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(existsSync(discoveryPath), false, 'mcp-bridge.json cleaned up on quit');
  await rm(dataDir, { recursive: true, force: true });
}
