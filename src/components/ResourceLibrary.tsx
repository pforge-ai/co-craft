import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Play,
  Pause,
  Sparkles,
  FolderInput,
  Bookmark,
  Check,
  Layers,
  ArrowUpRight,
  Code2,
  PackageOpen,
  Images,
  Music2,
} from 'lucide-react';
import {
  presetCatalog,
  presetCategories,
  getPreset,
  normalizePresetProps,
  type PresetParameter,
} from '../core/presets';
import { newClip, newProject } from '../core/project';
import { PresetFrame } from '../composition/Presets';
import type { Asset, CodeComponent } from '../core/types';
import './ResourceLibrary.css';

const posterFrame = (duration: number) => Math.min(duration - 1, Math.round(Math.min(72, duration * 0.48)));
const thumbnailCrop: Record<string, { x: number; y: number; zoom: number }> = {
  'lower-third': { x: 0.34, y: 0.82, zoom: 1.65 },
  'glass-caption': { x: 0.5, y: 0.84, zoom: 1.6 },
  'kinetic-caption': { x: 0.5, y: 0.83, zoom: 1.55 },
  'focus-callout': { x: 0.56, y: 0.37, zoom: 1.33 },
};
export function PresetPreview({
  presetId,
  values,
  portrait = false,
  playing = false,
  thumbnail = false,
  backdrop,
  className = '',
}: {
  presetId: string;
  values?: Record<string, unknown>;
  portrait?: boolean;
  playing?: boolean;
  thumbnail?: boolean;
  backdrop?: string;
  className?: string;
}) {
  const element = useRef<HTMLDivElement>(null),
    preset = getPreset(presetId)!;
  const duration = Math.max(1, Math.round(preset.durationSeconds * 30)),
    initial = posterFrame(duration);
  const [width, setWidth] = useState(0),
    [frame, setFrame] = useState(initial),
    current = useRef(initial);
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    current.current = initial;
    setFrame(initial);
  }, [presetId, initial]);
  useEffect(() => {
    if (!playing) {
      if (thumbnail) {
        current.current = initial;
        setFrame(initial);
      }
      return;
    }
    let token = 0;
    const begin = performance.now(),
      offset = thumbnail ? 0 : current.current;
    const tick = (now: number) => {
      const next = (offset + Math.floor((now - begin) * 0.03)) % duration;
      if (next !== current.current) {
        current.current = next;
        setFrame(next);
      }
      token = requestAnimationFrame(tick);
    };
    token = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(token);
  }, [playing, thumbnail, presetId, duration, initial]);
  const cw = portrait ? 675 : 1200,
    ch = portrait ? 1200 : 675;
  const crop = thumbnail ? thumbnailCrop[presetId] : undefined;
  const showsPhoto = backdrop && (values?.surface ?? preset.defaultProps.surface) === 'transparent';
  return (
    <div
      ref={element}
      className={`preset-preview ${portrait ? 'portrait' : 'landscape'} ${className}`}
      style={{ aspectRatio: `${cw}/${ch}` }}
      aria-label={`${preset.name}动态预览`}
    >
      {width > 0 && (
        <div
          className="preset-preview-stage"
          style={{ width: cw, height: ch, transform: `scale(${width / cw})` }}
        >
          {showsPhoto && (
            <img
              src={backdrop}
              alt=""
              style={{ width: cw, height: ch, objectFit: 'cover', filter: 'brightness(.72)' }}
            />
          )}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transformOrigin: '0 0',
              transform: crop
                ? `translate(${cw * (0.5 - crop.zoom * crop.x)}px, ${ch * (0.5 - crop.zoom * crop.y)}px) scale(${crop.zoom})`
                : undefined,
            }}
          >
            <PresetFrame
              presetId={presetId}
              frame={frame}
              fps={30}
              duration={duration}
              width={cw}
              height={ch}
              props={values}
            />
          </div>
        </div>
      )}
    </div>
  );
}

type ParameterValue = string | number | boolean;
function ParameterField({
  parameter,
  value,
  onChange,
  commitOnBlur = false,
  disabled = false,
}: {
  parameter: PresetParameter;
  value: unknown;
  onChange: (key: string, value: ParameterValue) => void;
  commitOnBlur?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const raw = String(value ?? ''),
    display = draft ?? raw,
    t = parameter.type;
  const parse = (s: string): ParameterValue | null => {
    if (t !== 'number') return s;
    if (s.trim() === '' || !Number.isFinite(Number(s))) return null;
    return Math.max(parameter.min ?? -Infinity, Math.min(parameter.max ?? Infinity, Number(s)));
  };
  const change = (s: string) => {
    if (commitOnBlur || t === 'number') setDraft(s);
    const parsed = parse(s);
    if ((!commitOnBlur || t === 'select') && parsed !== null && String(parsed) !== raw)
      onChange(parameter.key, parsed);
    if (t === 'select') setDraft(null);
  };
  const blur = (s: string) => {
    const parsed = parse(s);
    if (draft !== null && parsed !== null && String(parsed) !== raw) onChange(parameter.key, parsed);
    setDraft(null);
  };
  const attributes = {
    disabled,
    'aria-label': parameter.label,
    value: display,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      change(e.currentTarget.value),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      blur(e.currentTarget.value),
  };
  return (
    <label className={`preset-field ${t === 'color' ? 'color-field' : ''}`}>
      <span>{parameter.label}</span>
      {t === 'boolean' ? (
        <input
          disabled={disabled}
          type="checkbox"
          checked={value === true}
          aria-label={parameter.label}
          onChange={(e) => onChange(parameter.key, e.currentTarget.checked)}
        />
      ) : t === 'select' ? (
        <select {...attributes}>
          {parameter.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : t === 'text' ? (
        <textarea {...attributes} rows={parameter.key === 'text' ? 2 : 1} maxLength={500} />
      ) : (
        <div className="preset-value">
          <input {...attributes} type={t} min={parameter.min} max={parameter.max} step={parameter.step} />
          {t === 'color' && <span>{display.toUpperCase()}</span>}
        </div>
      )}
    </label>
  );
}
export function ParameterControls({
  parameters,
  values,
  onChange,
  commitOnBlur = false,
  disabled = false,
}: {
  parameters: PresetParameter[];
  values: Record<string, unknown>;
  onChange: (key: string, value: ParameterValue) => void;
  commitOnBlur?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="preset-controls">
      {parameters.map((parameter) => (
        <ParameterField
          key={parameter.key}
          parameter={parameter}
          value={values[parameter.key]}
          onChange={onChange}
          commitOnBlur={commitOnBlur}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
export function PresetControls({
  presetId,
  values,
  onChange,
  commitOnBlur = false,
  disabled = false,
}: {
  presetId: string;
  values: Record<string, unknown>;
  onChange: (key: string, value: ParameterValue) => void;
  commitOnBlur?: boolean;
  disabled?: boolean;
}) {
  const preset = getPreset(presetId);
  return preset ? (
    <ParameterControls
      parameters={preset.parameters}
      values={{ ...preset.defaultProps, ...values }}
      onChange={onChange}
      commitOnBlur={commitOnBlur}
      disabled={disabled}
    />
  ) : null;
}

// Transport only. Downloaded modules never execute in the workbench React tree.
function ComponentPreview({
  component,
  assets,
  mediaOrigin,
  values,
  portrait,
  playing,
}: {
  component: CodeComponent;
  assets: Asset[];
  mediaOrigin: string;
  values: Record<string, unknown>;
  portrait: boolean;
  playing: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const revision = useRef(0);
  const origin = new URL(mediaOrigin).origin;
  const state = useRef({ playing });
  state.current = { playing };
  const project = useMemo(() => {
    const p = newProject('组件预览'),
      s = p.sequences[0];
    p.revision = ++revision.current;
    p.components = [component];
    p.assets = assets.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      duration: a.duration,
      createdAt: '',
      path: '',
    }));
    s.width = portrait ? 675 : 1200;
    s.height = portrait ? 1200 : 675;
    s.id = 'preview';
    s.clips = [
      {
        ...newClip('code'),
        componentId: component.id,
        duration: Math.max(1, Math.round((component.pack?.durationSeconds ?? 5) * s.fps)),
        props: { ...values },
      },
    ];
    return p;
  }, [component, assets, values, portrait]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== origin ||
        event.data?.source !== 'cocraft-preview'
      )
        return;
      const post = (type: string, data: Record<string, unknown> = {}) =>
        frame.current?.contentWindow?.postMessage({ source: 'cocraft-workbench', type, ...data }, origin);
      if (event.data.event === 'ready') setReady(true);
      if (event.data.event === 'loaded') {
        post('mute', { muted: true });
        if (state.current.playing) post('play');
      }
      if (event.data.event === 'ended' && state.current.playing) {
        post('seek', { frame: 0 });
        post('play');
      }
      if (event.data.event === 'error') setError(String(event.data.message));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [origin]);
  useEffect(() => {
    if (!ready) return;
    setError('');
    frame.current?.contentWindow?.postMessage(
      {
        source: 'cocraft-workbench',
        type: 'load',
        props: { project, sequenceId: 'preview', mediaOrigin },
        frame: posterFrame(project.sequences[0].clips[0].duration),
      },
      origin,
    );
  }, [ready, project, mediaOrigin, origin]);
  useEffect(() => {
    if (ready)
      frame.current?.contentWindow?.postMessage(
        { source: 'cocraft-workbench', type: playing ? 'play' : 'pause' },
        origin,
      );
  }, [ready, playing, origin]);
  if (origin === window.location.origin) return <span className="preview-message">独立预览服务不可用</span>;
  return (
    <>
      {error && (
        <span className="preview-message" role="alert">
          {error}
        </span>
      )}
      <iframe
        ref={frame}
        title="项目组件独立预览"
        className={`project-resource-frame ${portrait ? 'portrait' : 'landscape'}`}
        hidden={!!error}
        sandbox="allow-scripts allow-same-origin"
        allow="autoplay"
        src={mediaOrigin + '/ui/preview.html'}
      />
    </>
  );
}

function savedFavorites(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem('cc-preset-favorites') || '[]');
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string' && getPreset(id)) : [];
  } catch {
    return [];
  }
}
const noAssets: Asset[] = [];
function StockWave({ asset }: { asset: Asset }) {
  const wave = asset.waveform || [];
  return (
    <div className="stock-wave">
      <Music2 size={18} />
      {wave.length > 0 && (
        <svg viewBox="0 0 128 50" aria-hidden="true" preserveAspectRatio="none">
          {Array.from({ length: 48 }, (_, i) => {
            const amp = Math.max(1, 22 * wave[Math.floor((i * wave.length) / 48)]);
            return (
              <line
                key={i}
                x1={i * 2.7 + 1}
                x2={i * 2.7 + 1}
                y1={25 - amp}
                y2={25 + amp}
                stroke="currentColor"
                strokeWidth="1.55"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
export function ResourceLibrary({
  onAdd,
  onGenerate,
  onImportPack,
  onImportExample,
  components = [],
  onAddComponent,
  assets = noAssets,
  previewOrigin,
  stockMedia = noAssets,
  onAddStock,
}: {
  onAdd: (id: string, overrides?: Record<string, unknown>) => Promise<void> | void;
  onGenerate: (prompt: string) => void;
  onImportPack: () => Promise<void> | void;
  onImportExample?: () => Promise<void> | void;
  components?: CodeComponent[];
  assets?: Asset[];
  previewOrigin?: string;
  stockMedia?: Asset[];
  onAddStock?: (assetId: string) => Promise<void> | void;
  onAddComponent?: (id: string, overrides?: Record<string, unknown>) => Promise<void> | void;
}) {
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('all'),
    [selected, setSelected] = useState(presetCatalog[0].id);
  const [componentId, setComponentId] = useState(''),
    [stockId, setStockId] = useState(''),
    [values, setValues] = useState<Record<string, unknown>>({});
  const [portrait, setPortrait] = useState(false),
    [playing, setPlaying] = useState(false),
    [hovered, setHovered] = useState('');
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [added, setAdded] = useState('');
  const [favorites, setFavorites] = useState<string[]>(savedFavorites);
  const isComponent = category === 'components',
    isStock = category === 'stock',
    q = query.trim().toLocaleLowerCase();
  const items = presetCatalog.filter(
    (p) =>
      (category === 'all' ||
        category === p.category ||
        (category === 'favorites' && favorites.includes(p.id))) &&
      [p.name, p.description, ...p.keywords, p.id].join(' ').toLocaleLowerCase().includes(q),
  );
  const projectItems = components.filter((c) =>
    [c.name, c.pack?.name, c.pack?.author].join(' ').toLocaleLowerCase().includes(q),
  );
  const stockItems = stockMedia.filter((a) =>
    [a.name, a.kind === 'audio' ? '声音 音频 音乐 音效' : '图片 摄影', a.source?.provider]
      .join(' ')
      .toLocaleLowerCase()
      .includes(q),
  );
  const stock = stockItems.find((a) => a.id === stockId) ?? stockItems[0];
  const preset = items.find((p) => p.id === selected) ?? items[0],
    component = projectItems.find((c) => c.id === componentId) ?? projectItems[0];
  const itemId = isStock ? stock?.id : isComponent ? component?.id : preset?.id,
    itemName = isStock ? stock?.name : isComponent ? component?.name : preset?.name;
  const media = (a: Asset, thumb = false) =>
    previewOrigin + `/media/${encodeURIComponent(a.id)}` + (thumb && a.thumbnail ? '?thumbnail=1' : '');
  const previewPhoto =
    stockMedia.find((a) => a.id === 'studio-v1-tram') ?? stockMedia.find((a) => a.kind === 'image');
  const backdrop = previewPhoto && previewOrigin ? media(previewPhoto) : undefined;
  const defaults = isComponent ? component?.props : preset?.defaultProps;
  const edited = useMemo(() => ({ ...defaults, ...values }), [defaults, values]);
  useEffect(() => {
    setValues({});
    setPlaying(false);
    setError('');
    setAdded('');
  }, [itemId]);
  const changeCategory = (id: string) => {
    setCategory(id);
    setError('');
    setAdded('');
  };
  const favorite = () => {
    if (!preset) return;
    const next = favorites.includes(preset.id)
      ? favorites.filter((id) => id !== preset.id)
      : [...favorites, preset.id];
    setFavorites(next);
    try {
      localStorage.setItem('cc-preset-favorites', JSON.stringify(next));
    } catch {}
  };
  const add = async () => {
    if (!itemId) return;
    setBusy('add');
    setError('');
    try {
      if (isStock) await onAddStock?.(itemId);
      else if (isComponent) await onAddComponent?.(itemId, edited);
      else await onAdd(itemId, normalizePresetProps(itemId, edited));
      setAdded(itemId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  const importPack = async (loader: () => Promise<void> | void) => {
    setBusy('import');
    setError('');
    try {
      await loader();
      setQuery('');
      changeCategory('components');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  const edit = (key: string, value: ParameterValue) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setAdded('');
  };
  const duration = isComponent ? (component?.pack?.durationSeconds ?? 5) : (preset?.durationSeconds ?? 0);
  return (
    <div className="resource-library">
      <nav className="resource-nav" aria-label="素材分类">
        {presetCategories.map((c) => (
          <button
            key={c.id}
            className={category === c.id ? 'active' : ''}
            onClick={() => changeCategory(c.id)}
          >
            {c.id === 'all' ? <Layers size={15} /> : <span className={`resource-category-dot ${c.id}`} />}
            <span>{c.name}</span>
            <small>
              {c.id === 'all'
                ? presetCatalog.length
                : presetCatalog.filter((p) => p.category === c.id).length}
            </small>
          </button>
        ))}
        <div className="resource-nav-divider" />
        <button className={isStock ? 'active' : ''} onClick={() => changeCategory('stock')}>
          <Images size={15} />
          <span>摄影与声音</span>
          <small>{stockMedia.length}</small>
        </button>
        <button
          className={category === 'favorites' ? 'active' : ''}
          onClick={() => changeCategory('favorites')}
        >
          <Bookmark size={15} />
          <span>收藏</span>
          <small>{favorites.length}</small>
        </button>
        <button className={isComponent ? 'active' : ''} onClick={() => changeCategory('components')}>
          <Code2 size={15} />
          <span>项目组件</span>
          <small>{components.length}</small>
        </button>
        <div className="resource-nav-bottom">
          {onImportExample && (
            <button disabled={!!busy} onClick={() => void importPack(onImportExample)}>
              <PackageOpen size={15} />
              载入随附素材包
            </button>
          )}
          <button disabled={!!busy} onClick={() => void importPack(onImportPack)}>
            <FolderInput size={15} />
            导入素材包
          </button>
        </div>
      </nav>
      <section className="resource-browser">
        <div className="resource-browser-head">
          <div>
            <h3>
              {isStock
                ? '摄影与声音'
                : isComponent
                  ? '项目组件'
                  : category === 'favorites'
                    ? '收藏的素材'
                    : presetCategories.find((c) => c.id === category)?.name}
            </h3>
          </div>
          <label className="resource-search">
            <Search size={14} />
            <input
              aria-label="搜索素材库"
              placeholder="搜索名称、用途…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="resource-browser-scroll">
          {isStock && stockItems.length > 0 ? (
            <div className="resource-grid">
              {stockItems.map((a) => (
                <button
                  className={`resource-card stock-card ${a.id === stock?.id ? 'selected' : ''}`}
                  key={a.id}
                  onClick={() => setStockId(a.id)}
                  aria-pressed={a.id === stock?.id}
                >
                  <div className="stock-thumb">
                    {a.kind === 'audio' ? <StockWave asset={a} /> : <img alt={a.name} src={media(a, true)} />}
                  </div>
                  <div className="resource-card-caption">
                    <b>{a.name}</b>
                    <small>{a.kind === 'audio' ? `${a.duration.toFixed(1)}s` : '摄影'}</small>
                  </div>
                </button>
              ))}
            </div>
          ) : isComponent && projectItems.length > 0 ? (
            <div className="component-library-list">
              {projectItems.map((c) => (
                <button
                  className={`component-library-item ${component?.id === c.id ? 'selected' : ''}`}
                  key={c.id}
                  onClick={() => setComponentId(c.id)}
                  aria-pressed={component?.id === c.id}
                >
                  <div className="component-library-icon">
                    <Code2 size={22} />
                  </div>
                  <div>
                    <b>{c.name}</b>
                    <p>{c.pack ? `${c.pack.name} · v${c.pack.version}` : '工程内代码组件'}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : !isComponent && items.length > 0 ? (
            <div className="resource-grid">
              {items.map((item) => (
                <button
                  className={`resource-card ${item.id === preset?.id ? 'selected' : ''}`}
                  key={item.id}
                  onClick={() => setSelected(item.id)}
                  onMouseEnter={() => setHovered(item.id)}
                  onMouseLeave={() => setHovered('')}
                  onFocus={() => setHovered(item.id)}
                  onBlur={() => setHovered('')}
                  aria-pressed={item.id === preset?.id}
                >
                  <PresetPreview
                    presetId={item.id}
                    playing={hovered === item.id}
                    thumbnail
                    backdrop={backdrop}
                  />
                  <div className="resource-card-caption">
                    <b>{item.name}</b>
                    <small>{item.durationSeconds}s</small>
                  </div>
                  <span className="resource-card-keywords">{item.keywords.slice(0, 3).join(' · ')}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="resource-empty">
              {isComponent ? <Code2 size={24} /> : <Search size={24} />}
              <b>
                {q
                  ? '没有匹配的素材'
                  : isStock
                    ? '当前没有随附媒体'
                    : isComponent
                      ? '项目中还没有代码组件'
                      : '还没有收藏素材'}
              </b>
              <button
                className="button subtle"
                onClick={() =>
                  onGenerate(
                    `为当前工程创作${query || '一段可编辑的画面包装'}。先阅读 cocraft-motion Skill，按照工程的叙事和画幅选择方案，完成后查看实际预览帧。`,
                  )
                }
              >
                让 Agent 创作 <ArrowUpRight size={13} />
              </button>
            </div>
          )}
        </div>
        {busy === 'import' && (
          <div className="resource-status" role="status">
            正在复制素材并检查组件画面…
          </div>
        )}
        {error && (
          <div className="resource-error" role="alert">
            {error}
          </div>
        )}
      </section>
      <aside className="resource-detail" aria-label="素材预览与参数">
        {isStock && stock ? (
          <>
            <div className="resource-detail-head">
              <span>{stock.kind === 'audio' ? '声音试听' : '摄影预览'}</span>
            </div>
            <div className="resource-preview-box stock-preview">
              {stock.kind === 'audio' ? (
                <StockWave asset={stock} />
              ) : (
                <img src={media(stock)} alt={stock.name} />
              )}
            </div>
            {stock.kind === 'audio' && (
              <audio key={stock.id} className="stock-audio" controls preload="metadata" src={media(stock)} />
            )}
            <div className="resource-detail-scroll">
              <h3>{stock.name}</h3>
              <p className="resource-description">
                {stock.kind === 'audio'
                  ? `音频 · ${stock.duration.toFixed(1)} 秒`
                  : [stock.width && stock.height ? `${stock.width} × ${stock.height}` : '摄影图片'].join(' ')}
              </p>
              <div className="resource-license">
                {[stock.source?.provider, stock.source?.author].filter(Boolean).join(' · ')}
                <br />
                {stock.source?.license}
              </div>
            </div>
            <footer className="resource-actions">
              <button className="button primary" disabled={!!busy || !onAddStock} onClick={() => void add()}>
                {added === itemId ? <Check size={15} /> : <Plus size={15} />}{' '}
                {added === itemId ? '已添加到时间线' : '添加到时间线'}
              </button>
            </footer>
          </>
        ) : itemId ? (
          <>
            <div className="resource-detail-head">
              <span>预览与调整</span>
              {!isComponent && (
                <button
                  className={`icon-button ${favorites.includes(itemId) ? 'active' : ''}`}
                  onClick={favorite}
                  aria-label={favorites.includes(itemId) ? '取消收藏' : '收藏素材'}
                >
                  <Bookmark size={15} fill={favorites.includes(itemId) ? 'currentColor' : 'none'} />
                </button>
              )}
            </div>
            <div className="resource-preview-box">
              {isComponent && component ? (
                previewOrigin ? (
                  <ComponentPreview
                    key={component.id}
                    component={component}
                    assets={assets}
                    mediaOrigin={previewOrigin}
                    values={edited}
                    portrait={portrait}
                    playing={playing}
                  />
                ) : (
                  <span className="preview-message">独立预览服务不可用</span>
                )
              ) : (
                <PresetPreview
                  presetId={itemId}
                  values={edited}
                  portrait={portrait}
                  playing={playing}
                  backdrop={backdrop}
                />
              )}
            </div>
            <div className="resource-preview-controls">
              <button
                className="icon-button"
                aria-label={playing ? '暂停素材预览' : '播放素材预览'}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <span>
                {duration.toFixed(1)}s
                {!isComponent && backdrop && edited.surface === 'transparent'
                  ? ' · 透明叠层示意'
                  : ' · 30 fps'}
              </span>
              <select
                aria-label="素材预览画幅"
                value={portrait ? '9:16' : '16:9'}
                onChange={(e) => setPortrait(e.target.value === '9:16')}
              >
                <option>16:9</option>
                <option>9:16</option>
              </select>
            </div>
            <div className="resource-detail-scroll" key={itemId}>
              <h3>{itemName}</h3>
              {!isComponent && preset ? (
                <>
                  <p className="resource-description">{preset.description}</p>
                  <PresetControls presetId={itemId} values={edited} onChange={edit} />
                  <div className="resource-license">{preset.license}</div>
                </>
              ) : (
                component && (
                  <>
                    <p className="resource-description">
                      {component.pack
                        ? `${component.pack.name} · v${component.pack.version}`
                        : '当前工程内的可编程画面'}
                    </p>
                    {component.pack?.parameters && (
                      <ParameterControls
                        parameters={component.pack.parameters}
                        values={edited}
                        onChange={edit}
                      />
                    )}
                    {component.pack && (
                      <div className="resource-license">
                        {component.pack.author} · {component.pack.license}
                      </div>
                    )}
                  </>
                )
              )}
            </div>
            <footer className="resource-actions">
              <button
                className="button primary"
                disabled={!!busy || (isComponent && !onAddComponent)}
                onClick={() => void add()}
              >
                {added === itemId ? <Check size={15} /> : <Plus size={15} />}{' '}
                {added === itemId ? '已添加到时间线' : '添加到时间线'}
              </button>
              <button
                className="button subtle"
                onClick={() =>
                  onGenerate(
                    `以「${itemName}」（${isComponent ? 'componentId' : 'presetId'}: ${itemId}）为起点，为当前项目创作贴合内容的版本。先阅读 cocraft-motion Skill，保留可编辑文案和参数，完成后查看实际预览帧。`,
                  )
                }
              >
                <Sparkles size={14} />让 Agent 定制
              </button>
            </footer>
          </>
        ) : (
          <div className="resource-empty">
            <Layers size={24} />
            <b>选择素材以预览</b>
          </div>
        )}
      </aside>
    </div>
  );
}
