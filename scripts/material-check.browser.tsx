import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PresetFrame } from '../src/composition/Presets';
import { presetCatalog, type PresetDefinition } from '../src/core/presets';
import { PresetControls, ResourceLibrary } from '../src/components/ResourceLibrary';
import type { Asset, CodeComponent } from '../src/core/types';

const root = createRoot(document.querySelector('#root')!);
function values(p: PresetDefinition, stress: boolean) {
  if (!stress) return p.defaultProps;
  const long = '当两道波形在同一个节拍里对齐，我们听见了这段旋律里一直隐藏着的变化。';
  const extra: Record<string, string | number> = {
    text: long,
    subtitle: '录音室里的第三次对照实验，保留同样的时间和振幅，再听一次波形相遇的声音。',
    label: '城市声音设计研究室',
    chapter: '第十二章',
    suffix: '毫秒',
    labelA: '第一次独立采样的基准数据',
    labelB: '调整相位差以后测得的数值',
    items: '准备显示相位与振幅的仪器|缓慢改变通道之间的相位差|对照最终输出与原始波形',
    value: 999999,
    valueA: 1000000,
    valueB: 0,
  };
  return {
    ...p.defaultProps,
    ...Object.fromEntries(p.parameters.filter((k) => k.key in extra).map((k) => [k.key, extra[k.key]])),
  };
}
function frame(p: PresetDefinition, w: number, h: number, stress: boolean, at?: number) {
  const duration = Math.round(p.durationSeconds * 30);
  return (
    <PresetFrame
      presetId={p.id}
      width={w}
      height={h}
      fps={30}
      duration={duration}
      frame={at ?? Math.round(duration * 0.52)}
      props={values(p, stress)}
    />
  );
}
function problems(w: number, h: number) {
  const stage = document.querySelector('[data-preset]')!;
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT),
    textRects: { text: string; rect: DOMRect }[] = [];
  const issues: string[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode,
      text = node.textContent?.trim();
    if (!text || node.parentElement?.closest('style,svg')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (!r.width || !r.height) continue;
      if (r.left < -1 || r.top < -1 || r.right > w + 1 || r.bottom > h + 1)
        issues.push('边界 ' + text.slice(0, 15));
      for (const previous of textRects) {
        const old = previous.rect;
        const overlap =
          Math.max(0, Math.min(old.right, r.right) - Math.max(old.left, r.left)) *
          Math.max(0, Math.min(old.bottom, r.bottom) - Math.max(old.top, r.top));
        if (overlap > Math.min(r.width * r.height, old.width * old.height) * 0.22)
          issues.push('重叠 ' + previous.text.slice(0, 10) + ' / ' + text.slice(0, 10));
      }
      textRects.push({ text, rect: r });
    }
  }
  return [...new Set(issues)];
}
Object.assign(window, {
  mountEditing() {
    const commits: { key: string; value: string | number }[] = [];
    Object.assign(window, { getCommits: () => commits });
    flushSync(() =>
      root.render(
        <>
          <PresetControls
            presetId="studio-title"
            values={{}}
            commitOnBlur
            onChange={(key, value) => commits.push({ key, value })}
          />
          <button>下一项</button>
        </>,
      ),
    );
  },
  mountLibrary(component: CodeComponent, assets: Asset[], previewOrigin: string, stockMedia: Asset[]) {
    const additions: { id: string; props?: Record<string, unknown> }[] = [];
    Object.assign(window, { getAdditions: () => additions });
    flushSync(() =>
      root.render(
        <div
          className="modal"
          style={{ position: 'relative', width: 1100, height: 780, background: '#e0e3df' }}
        >
          <ResourceLibrary
            components={[component]}
            assets={assets}
            previewOrigin={previewOrigin}
            stockMedia={stockMedia}
            onAddStock={(id) => {
              additions.push({ id });
            }}
            onAddComponent={(id, props) => {
              additions.push({ id, props });
            }}
            onAdd={() => {}}
            onGenerate={() => {}}
            onImportPack={() => {}}
          />
        </div>,
      ),
    );
  },
  inspectMaterials() {
    const result: { id: string; aspect: string; stress: boolean; issues: string[] }[] = [];
    for (const p of presetCatalog)
      for (const [w, h] of [
        [960, 540],
        [540, 960],
      ])
        for (const stress of [false, true]) {
          flushSync(() =>
            root.render(
              <div style={{ position: 'relative', width: w, height: h }}>{frame(p, w, h, stress)}</div>,
            ),
          );
          result.push({ id: p.id, aspect: w > h ? 'landscape' : 'portrait', stress, issues: problems(w, h) });
        }
    return result;
  },
  board(portrait: boolean, stress: boolean) {
    const w = portrait ? 540 : 960,
      h = portrait ? 960 : 540,
      cardW = portrait ? 176 : 288,
      cardH = (cardW * h) / w;
    flushSync(() =>
      root.render(
        <section
          id="board"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${portrait ? 6 : 4}, ${cardW}px)`,
            padding: 16,
            gap: 12,
            width: 'max-content',
            background: '#263030',
            fontFamily: '-apple-system,sans-serif',
          }}
        >
          {presetCatalog.map((p) => (
            <article key={p.id} style={{ width: cardW, color: '#f5efe5' }}>
              <div
                style={{
                  width: cardW,
                  height: cardH,
                  overflow: 'hidden',
                  background: 'linear-gradient(130deg,#58615c,#1c3335)',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: w,
                    height: h,
                    transform: `scale(${cardW / w})`,
                    transformOrigin: '0 0',
                  }}
                >
                  {frame(p, w, h, stress)}
                </div>
              </div>
              <div style={{ padding: '6px 0', fontSize: 12 }}>{p.name}</div>
            </article>
          ))}
        </section>,
      ),
    );
  },
});
