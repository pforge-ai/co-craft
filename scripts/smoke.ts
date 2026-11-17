import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../electron/store';
import { newProject, newClip, splitOperations } from '../src/core/project';
const root = await mkdtemp(join(tmpdir(), 'cocraft-core-smoke-'));
const store = new ProjectStore(root);
const p = newProject('Smoke');
const c = newClip('title');
p.sequences[0].clips.push(c);
await store.init(p);
let e = await store.edit({
  baseRevision: 0,
  name: '人工文案',
  operations: [
    {
      type: 'updateClip',
      sequenceId: p.sequences[0].id,
      clipId: c.id,
      changes: { props: { text: '人工保留' } },
    },
  ],
});
assert.equal(e.project.sequences[0].clips[0].props.text, '人工保留');
e = await store.edit({
  baseRevision: e.project.revision,
  name: '锁定',
  operations: [
    { type: 'updateClip', sequenceId: p.sequences[0].id, clipId: c.id, changes: { locked: true } },
  ],
});
await assert.rejects(
  () =>
    store.edit({
      baseRevision: e.project.revision,
      name: 'Agent 改写',
      author: 'agent',
      operations: [
        {
          type: 'updateClip',
          sequenceId: p.sequences[0].id,
          clipId: c.id,
          changes: { props: { text: '覆盖' } },
        },
      ],
    }),
  /锁定/,
);
await assert.rejects(() => store.edit({ baseRevision: 0, name: '过期', operations: [] }), /新修改/);
await assert.rejects(
  () => store.edit({ baseRevision: e.project.revision, name: '已停止', operations: [] }, () => false),
  /停止/,
);
e = await store.undo();
assert.equal(e.project.sequences[0].clips[0].locked, false);
e = await store.redo();
assert.equal(e.project.sequences[0].clips[0].locked, true);
const reopened = await new ProjectStore(root).envelope();
assert.equal(reopened.project.sequences[0].clips[0].props.text, '人工保留');
assert.equal(reopened.project.sequences[0].clips[0].locked, true);
console.log('PASS · edit → lock → stale/late publication rejected → undo/redo → reopen');
console.log(root);
