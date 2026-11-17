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
export function SettingsDialog({
  settings,
  onSave,
  onClose,
  skills,
  onOpenSkills,
}: {
  settings: Settings;
  onSave: (s: Partial<Settings>) => Promise<void>;
  onClose: () => void;
  skills: { name: string; description: string }[];
  onOpenSkills: () => void;
}) {
  const [tab, setTab] = useState('model'),
    [draft, setDraft] = useState<Partial<Settings>>({ ...settings }),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const field = (key: keyof Settings, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <Modal title="设置" subtitle="把你熟悉的模型和工具，带进创作工作台。" onClose={onClose} wide>
      <div className="settings-layout">
        <nav>
          {[
            ['model', '模型连接'],
            ['assets', '素材服务'],
            ['workspace', '工作台'],
            ['skills', 'Skills 与执行'],
          ].map(([id, title]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {title}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {tab === 'model' && (
            <>
              <div className="setting-intro">
                <KeyRound size={22} />
                <h3>连接你的模型</h3>
                <p>Agent 使用 Pi 运行。密钥由 macOS 安全存储加密保存在本机。</p>
              </div>
              <label className="field">
                <span>服务商</span>
                <select
                  aria-label="模型服务商"
                  value={draft.provider}
                  onChange={(e) => {
                    const provider = e.target.value;
                    setDraft((d) => ({
                      ...d,
                      provider,
                      model:
                        provider === 'anthropic'
                          ? 'claude-sonnet-4-6'
                          : provider === 'deepseek'
                            ? 'deepseek-chat'
                            : provider === 'openrouter'
                              ? 'anthropic/claude-sonnet-4.6'
                              : 'gpt-5.4',
                      baseUrl:
                        provider === 'deepseek'
                          ? 'https://api.deepseek.com/v1'
                          : provider === 'openrouter'
                            ? 'https://openrouter.ai/api/v1'
                            : '',
                    }));
                  }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="custom">OpenAI 兼容接口</option>
                </select>
              </label>
              <label className="field">
                <span>模型 ID</span>
                <input
                  aria-label="模型 ID"
                  value={draft.model}
                  onChange={(e) => field('model', e.target.value)}
                />
              </label>
              <label className="field">
                <span>API Key {settings.hasApiKey && <em>已保存 · 留空保留</em>}</span>
                <input
                  aria-label="模型 API Key"
                  type="password"
                  autoComplete="off"
                  placeholder={settings.hasApiKey ? '•••••••• 已安全保存' : '粘贴 API Key'}
                  value={draft.apiKey || ''}
                  onChange={(e) => field('apiKey', e.target.value)}
                />
              </label>
              <label className="field">
                <span>
                  自定义接口地址 <em>可选</em>
                </span>
                <input
                  aria-label="模型接口地址"
                  placeholder="https://api.example.com/v1"
                  value={draft.baseUrl || ''}
                  onChange={(e) => field('baseUrl', e.target.value)}
                />
              </label>
              <p className="help-copy">
                发送指令时，项目约定、时间线、任务对话及 Agent
                读取的内容会交给所选模型。开发对话的登录态不会自动用于此应用。
              </p>
            </>
          )}
          {tab === 'assets' && (
            <>
              <div className="setting-intro">
                <Film size={22} />
                <h3>更多素材，随手可得</h3>
                <p>内置画面组件与 macOS 配音可以直接使用。连接 Pexels 后可搜索并导入视频。</p>
              </div>
              <label className="field">
                <span>Pexels API Key {settings.hasPexelsKey && <em>已保存</em>}</span>
                <input
                  aria-label="Pexels API Key"
                  type="password"
                  autoComplete="off"
                  placeholder="用于搜索视频素材"
                  value={draft.pexelsKey || ''}
                  onChange={(e) => field('pexelsKey', e.target.value)}
                />
              </label>
              <button
                className="text-button"
                onClick={() => window.cocraft.call('link.open', { url: 'https://www.pexels.com/api/' })}
              >
                申请 Pexels API Key <ExternalLink size={12} />
              </button>
              <p className="help-copy">
                素材导入后保留摄影师、来源链接和许可信息。使用范围以素材来源条款为准。
              </p>
            </>
          )}
          {tab === 'workspace' && (
            <>
              <div className="setting-intro">
                <Layers size={22} />
                <h3>让工作台适合你</h3>
              </div>
              <label className="field">
                <span>外观</span>
                <select
                  aria-label="外观"
                  value={draft.theme}
                  onChange={(e) => field('theme', e.target.value)}
                >
                  <option value="dark">深色 · Graphite</option>
                  <option value="light">浅色 · Paper</option>
                  <option value="system">跟随系统</option>
                </select>
              </label>
              <div className="shortcuts-list">
                {[
                  ['播放 / 暂停', 'Space'],
                  ['分割片段', '⌘ B'],
                  ['撤销 / 重做', '⌘ Z / ⇧ ⌘ Z'],
                  ['导入素材', '⌘ I'],
                  ['命令面板', '⌘ K'],
                  ['逐帧移动', '← / →'],
                  ['锁定片段', 'L'],
                ].map(([a, b]) => (
                  <div key={a}>
                    <span>{a}</span>
                    <kbd>{b}</kbd>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === 'skills' && (
            <>
              <div className="setting-intro">
                <Code2 size={22} />
                <h3>把能力留给生态</h3>
                <p>
                  支持标准 SKILL.md、脚本和可编程画面。项目 Skill 放入工程的 skills 文件夹，下次运行即可发现。
                </p>
              </div>
              <div className="skill-list">
                {skills.map((s) => (
                  <div key={s.name}>
                    <span className="skill-icon">
                      <Code2 size={15} />
                    </span>
                    <div>
                      <b>{s.name}</b>
                      <p>{s.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button className="button subtle" onClick={onOpenSkills}>
                <FolderOpen size={14} /> 打开项目 Skills 文件夹
              </button>
              <label className="permission-setting">
                <input
                  type="checkbox"
                  checked={!!draft.allowShell}
                  onChange={(e) => field('allowShell', e.target.checked)}
                />
                <div>
                  <b>允许 Agent 运行项目脚本</b>
                  <p>
                    启用 bash，支持 FFmpeg、Python
                    等本机工具。脚本可写入任务工作区。原素材与已发布工程不允许直接改写。
                  </p>
                </div>
              </label>
              <label className="permission-setting">
                <input
                  type="checkbox"
                  checked={!!draft.allowNetwork}
                  disabled={!draft.allowShell}
                  onChange={(e) => field('allowNetwork', e.target.checked)}
                />
                <div>
                  <b>允许项目脚本联网</b>
                  <p>
                    用于安装 npm / Python
                    依赖或调用服务。启用后，脚本可以把已授权读取的素材与项目内容发送到外部服务。
                  </p>
                </div>
              </label>
            </>
          )}
          {error && <p className="error-copy">{error}</p>}
        </div>
      </div>
      <footer className="modal-footer">
        <span className="muted">
          <Check size={12} /> 本机存储
        </span>
        <button
          className="button primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              const next = { ...draft };
              for (const k of ['apiKey', 'pexelsKey', 'transcriptionKey'] as const)
                if (!next[k]) delete next[k];
              await onSave(next);
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Spinner /> : <Check size={14} />} 保存设置
        </button>
      </footer>
    </Modal>
  );
}
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
      title="让作品，走出工作台。"
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
      title="为故事，寻找下一个镜头。"
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
