import React, { useState } from 'react';
import {
  Check,
  ArrowUpRight,
  KeyRound,
  Terminal,
  Film,
  Code2,
  Layers,
  Type,
  AudioLines,
  Search,
  Download,
  ExternalLink,
  FolderOpen,
} from 'lucide-react';
import { Modal, Spinner, Field } from './ui';
import type { Settings, Sequence, Project, StockVideo, CodeComponent } from '../core/types';
import { durationOf, uid } from '../core/project';
export { SettingsDialog } from './SettingsDialog';
export function ExportDialog({
  sequence,
  revision,
  onExport,
  onClose,
}: {
  sequence: Sequence;
  revision: number;
  onExport: (scale: number, choose: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1),
    [choose, setChoose] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title="导出成片"
      subtitle={`${sequence.name} · 固定版本 v${revision}`}
      onClose={onClose}
    >
      <div className="export-hero">
        <div className="export-film">
          <Film size={34} />
          <span>MP4</span>
        </div>
        <div>
          <h3>{sequence.name}</h3>
          <p>H.264 · AAC · SDR</p>
          <div className="export-specs">
            <span>
              {Math.round(sequence.width * scale)} × {Math.round(sequence.height * scale)}
            </span>
            <span>{sequence.fps} fps</span>
            <span>{(durationOf(sequence) / sequence.fps).toFixed(1)} s</span>
          </div>
        </div>
      </div>
      <label className="field">
        <span>输出尺寸</span>
        <select aria-label="输出尺寸" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
          <option value={1}>
            原始尺寸 · {sequence.width} × {sequence.height}
          </option>
          <option value={0.5}>
            轻量预览 · {sequence.width / 2} × {sequence.height / 2}
          </option>
        </select>
      </label>
      <label className="check-field">
        <input type="checkbox" checked={choose} onChange={(e) => setChoose(e.target.checked)} /> 选择保存位置
      </label>
      <p className="help-copy">默认保存到工程的 exports 文件夹。导出使用当前版本快照，你可以继续编辑。</p>
      {error && <p className="error-copy">{error}</p>}
      <footer className="modal-footer">
        <button className="button subtle" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onExport(scale, choose);
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : <ArrowUpRight size={15} />} 导出成片
        </button>
      </footer>
    </Modal>
  );
}
const starter = `import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';

export default function Scene({text='每一个想法，都值得成为画面。', color='#e8e2d6'}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = interpolate(frame, [0, fps * 0.6], [0, 1], {extrapolateRight:'clamp'});
  const y = interpolate(frame, [0, fps], [32, 0], {extrapolateRight:'clamp'});
  return (
    <AbsoluteFill style={{justifyContent:'center', alignItems:'center', color, fontFamily:'sans-serif'}}>
      <div style={{fontSize:76, opacity, transform:\x60translateY(\x24{y}px)\x60}}>{text}</div>
    </AbsoluteFill>
  );
}`;
export function CodeDialog({
  component,
  onApply,
  onClose,
}: {
  component?: CodeComponent;
  onApply: (c: CodeComponent) => Promise<void>;
  onClose: () => void;
}) {
  const [source, setSource] = useState(component?.source || starter),
    [name, setName] = useState(component?.name || '自定义画面'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title="可编程画面"
      subtitle="React + Remotion。把创意变成可复用、可编辑的组件。"
      onClose={onClose}
      wide
    >
      <div className="code-toolbar">
        <span>
          <Code2 size={14} /> components /{' '}
        </span>
        <input aria-label="组件名称" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="badge">TSX</span>
      </div>
      <textarea
        className="code-editor"
        aria-label="组件源码"
        spellCheck={false}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget,
              a = el.selectionStart,
              b = el.selectionEnd;
            setSource(source.slice(0, a) + '  ' + source.slice(b));
            requestAnimationFrame(() => {
              el.selectionStart = el.selectionEnd = a + 2;
            });
          }
        }}
      />
      {error && <pre className="code-error">{error}</pre>}
      <footer className="modal-footer">
        <span className="help-copy">编译通过后发布为一个可撤销版本。</span>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const c = await window.cocraft.call<CodeComponent>('code.compile', {
                source,
                id: component?.id || uid('component'),
                name,
                props: component?.props || { text: '每一个想法，都值得成为画面。', color: '#e8e2d6' },
              });
              await onApply(c);
              onClose();
            } catch (e) {
              setError(String(e).replace(/^Error:.*?Error: /, ''));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : <Check size={14} />} 编译并应用
        </button>
      </footer>
    </Modal>
  );
}
export function StockDialog({
  onImport,
  onClose,
  onSettings,
}: {
  onImport: (id: number) => Promise<void>;
  onClose: () => void;
  onSettings: () => void;
}) {
  const [q, setQ] = useState('coast'),
    [items, setItems] = useState<StockVideo[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [importing, setImporting] = useState<number | null>(null);
  const search = async () => {
    setBusy(true);
    setError('');
    try {
      setItems(await window.cocraft.call('stock.search', { query: q }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="搜索视频素材"
      subtitle="视频由 Pexels 提供 · 素材导入后保留来源"
      onClose={onClose}
      wide
    >
      <form
        className="stock-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Search size={16} />
        <input
          aria-label="搜索视频素材"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索海岸、城市、人物…"
        />
        <button className="button primary" disabled={busy}>
          {busy ? <Spinner /> : '搜索'}
        </button>
      </form>
      {error && (
        <div className="stock-error">
          <p>{error}</p>
          <button className="button" onClick={onSettings}>
            设置素材服务
          </button>
        </div>
      )}
      <div className="stock-grid">
        {items.map((item) => (
          <div className="stock-card" key={item.id}>
            <img src={item.thumbnail} alt={item.name} />
            <span>{item.duration}s</span>
            <footer>
              <button
                className="text-button"
                onClick={() => window.cocraft.call('link.open', { url: item.url })}
              >
                {item.author} <ExternalLink size={11} />
              </button>
              <button
                className="icon-button"
                aria-label={`导入 ${item.name}`}
                disabled={importing !== null}
                onClick={async () => {
                  setImporting(item.id);
                  try {
                    await onImport(item.id);
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setImporting(null);
                  }
                }}
              >
                {importing === item.id ? <Spinner /> : <Download size={15} />}
              </button>
            </footer>
          </div>
        ))}
      </div>
      {!items.length && !busy && !error && (
        <div className="stock-empty">
          <Film size={32} />
          <p>从一个画面开始寻找。</p>
          <span>试试 coast、city night、forest</span>
        </div>
      )}
      <footer className="modal-footer">
        <button
          className="text-button"
          onClick={() => window.cocraft.call('link.open', { url: 'https://www.pexels.com' })}
        >
          Photos & videos provided by Pexels <ExternalLink size={12} />
        </button>
      </footer>
    </Modal>
  );
}
