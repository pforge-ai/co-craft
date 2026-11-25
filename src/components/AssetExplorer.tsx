import React, { useMemo, useState } from 'react';
import {
  Plus,
  Upload,
  Search,
  Film,
  Image as ImageIcon,
  Music,
  Type,
  Layers,
  Sparkles,
  Box,
  Volume2,
  ArrowUpFromLine,
  Download,
  Trash2,
  Link2Off,
  AtSign,
  Package,
  X,
} from 'lucide-react';
import { mediaUrl } from '../composition/Film';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import { CodeComponentThumb } from './CodeComponentThumb';
import { PresetPreview } from './PresetControls';
import {
  createPresetClip,
  isLightHex,
  resolveProjectStyle,
} from '../core/presets';
import {
  filterPresets,
  filterProjectComponents,
  filterStudioMediaByKind,
  filterTransitions,
  filterVaultItems,
  matchCatalogText,
} from '../core/catalog';
import {
  buildDeleteAssetOperations,
  buildDeleteComponentOperations,
  instantiateCompoundVaultItemOperations,
  inferDefaultAudioAttachMode,
  newClip,
  uid,
} from '../core/project';
import { ROLE_LABELS, inferAssetRole } from '../core/taxonomy';
import type {
  Asset,
  AssetVariant,
  ChatContextRef,
  Clip,
  EditOperation,
  Project,
  Sequence,
  TransitionType,
  VaultItem,
} from '../core/types';

export type AssetCategory = 'media' | 'audio' | 'text' | 'transition' | 'component';
type LibraryScope = 'all' | 'project' | 'personal' | 'official';

interface AssetExplorerProps {
  project: Project;
  sequence: Sequence;
  getPlayheadFrame?: () => number;
  playheadFrame?: number;
  previewOrigin: string;
  personalLibrary: VaultItem[];
  studioMedia: Asset[];
  activeCategory?: AssetCategory;
  onCategoryChange?: (cat: AssetCategory) => void;
  onSelectClip: (clipId: string | null) => void;
  onSeek: (frame: number) => void;
  onImportMedia: () => void;
  onRelinkAsset: (assetId: string) => void;
  onOpenGeneration: (use: 'image' | 'video' | 'speech' | 'transcription', assetId?: string) => void;
  onEdit: (name: string, ops: EditOperation[]) => Promise<void>;
  onPublishToLibrary: (payload: {
    itemId?: string;
    assetId?: string;
    componentId?: string;
    pack?: { name: string; assetIds?: string[]; componentIds?: string[]; vaultIds?: string[] };
  }) => Promise<void>;
  onPullFromLibrary: (globalId: string) => Promise<void>;
  onRemoveFromLibrary: (globalId: string) => Promise<void>;
  onAddStudioMedia: (studioId: string) => Promise<void>;
  onAddTransition: (type: TransitionType) => Promise<void>;
  onAddRefsToChat?: (refs: ChatContextRef[]) => void;
  onOpenTemplateLibrary?: () => void;
}

const CATEGORIES: { id: AssetCategory; label: string; icon: typeof Film }[] = [
  { id: 'media', label: '媒体', icon: Film },
  { id: 'audio', label: '音频', icon: Music },
  { id: 'text', label: '文本', icon: Type },
  { id: 'transition', label: '转场', icon: Sparkles },
  { id: 'component', label: '组件', icon: Layers },
];

const SCOPES: { id: LibraryScope; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'project', label: '当前项目' },
  { id: 'personal', label: '个人库' },
  { id: 'official', label: '官方内置' },
];

export const AssetExplorer = React.memo(function AssetExplorer({
  project,
  sequence,
  getPlayheadFrame,
  playheadFrame = 0,
  previewOrigin,
  personalLibrary,
  studioMedia,
  activeCategory,
  onCategoryChange,
  onSelectClip,
  onSeek,
  onImportMedia,
  onRelinkAsset,
  onOpenGeneration,
  onEdit,
  onPublishToLibrary,
  onPullFromLibrary,
  onRemoveFromLibrary,
  onAddStudioMedia,
  onAddTransition,
  onAddRefsToChat,
  onOpenTemplateLibrary,
}: AssetExplorerProps) {
  const currentPlayhead = () => getPlayheadFrame?.() ?? playheadFrame;
  const [localCategory, setLocalCategory] = useState<AssetCategory>('media');
  const category = activeCategory ?? localCategory;
  const setCategory = (cat: AssetCategory) => {
    setLocalCategory(cat);
    onCategoryChange?.(cat);
  };

  const [libScope, setLibScope] = useState<LibraryScope>('all');
  const [query, setQuery] = useState('');
  const [showCreator, setShowCreator] = useState(false);
  const [subjRole, setSubjRole] = useState<'character' | 'product' | 'environment'>('character');
  const [subjName, setSubjName] = useState('');
  const [varName, setVarName] = useState('默认状态');
  const [subjAnchor, setSubjAnchor] = useState('');
  const [subjRefId, setSubjRefId] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const toggleSelectKey = (key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const q = query.trim().toLowerCase();

  const projectVault = useMemo(
    () => (project.vault || []).filter((v) => !v.styleTokens && !v.brand),
    [project.vault],
  );

  // Asset usage map -> seek on click
  const assetUsage = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const c of sequence.clips) {
      if (c.assetId) {
        const list = map.get(c.assetId) || [];
        list.push(c.start);
        map.set(c.assetId, list);
      }
      for (const sid of [...(c.subjectIds || []), ...(c.subjectBindings || []).map((b) => b.entityId)]) {
        const list = map.get(sid) || [];
        list.push(c.start);
        map.set(sid, list);
      }
    }
    return map;
  }, [sequence.clips]);

  const portrait = sequence.height > sequence.width * 1.1;

  const insertMediaAsset = (a: Asset) => {
    const at = currentPlayhead();
    const dur = Math.max(1, Math.floor((a.kind === 'image' ? 5 : a.duration) * sequence.fps));
    const c: Clip = {
      ...newClip(a.kind === 'model-3d' ? 'shape' : a.kind, at, a.id),
      name: a.name,
      duration: dur,
      ...(a.kind === 'audio' ? { audioAttachMode: inferDefaultAudioAttachMode(a, dur, sequence.fps) } : {}),
    };
    void onEdit(`加入「${a.name}」`, [{ type: 'addClip', sequenceId: sequence.id, clip: c }]).then(() =>
      onSelectClip(c.id),
    );
  };

  const insertSubjectEntity = (v: VaultItem, variant?: AssetVariant) => {
    const at = currentPlayhead();
    if (v.compound?.clips.length) {
      const { operations, primaryClipId } = instantiateCompoundVaultItemOperations(
        sequence.id,
        v,
        at,
        sequence.fps,
      );
      if (operations.length) {
        void onEdit(`插入复合资产「${v.name}」`, operations).then(() => {
          if (primaryClipId) onSelectClip(primaryClipId);
        });
      }
      return;
    }
    let c: Clip;
    if (v.rig?.presetId) {
      c = createPresetClip(v.rig.presetId, at, sequence.fps, v.rig.props || {}, project);
      c.name = v.name;
    } else if (v.rig?.componentId) {
      const comp = project.components.find((x) => x.id === v.rig?.componentId);
      c = {
        ...newClip('code', at),
        name: v.name,
        componentId: v.rig.componentId,
        props: { ...(comp?.props || {}), ...(v.rig?.props || {}) },
      };
    } else {
      const aid = variant?.assetId || v.assetId;
      const asset = aid ? project.assets.find((a) => a.id === aid) : undefined;
      if (!asset) {
        c = {
          ...newClip('title', at),
          track: 'visual',
          name: variant ? `${v.name}·${variant.name}` : v.name,
          props: {
            text: variant ? `${v.name}（${variant.name}）` : v.name,
            subtitle: v.promptAnchor || '',
            fontSize: 54,
            color: '#f4f4f6',
            background: '#141720',
            position: 'center',
            align: 'center',
            animation: 'none',
          },
        };
      } else {
        c = {
          ...newClip(asset.kind === 'model-3d' ? 'shape' : asset.kind, at, asset.id),
          name: variant ? `${v.name}·${variant.name}` : v.name,
          duration: Math.max(1, Math.floor((asset.kind === 'image' ? 5 : asset.duration) * sequence.fps)),
        };
      }
    }
    c.subjectBindings = [
      { entityId: v.id, variantId: variant?.id || v.defaultVariantId, pinnedVersion: v.version },
    ];
    c.subjectIds = [v.id];
    void onEdit(`置入设定「${c.name}」`, [{ type: 'addClip', sequenceId: sequence.id, clip: c }]).then(() =>
      onSelectClip(c.id),
    );
  };

  const computeNonStackStart = (name: string) => {
    const cur = currentPlayhead();
    const conflict = sequence.clips.find(
      (x) => Math.abs(x.start - cur) < 3 && x.name === name,
    );
    return conflict ? conflict.start + conflict.duration : cur;
  };

  const insertPlainText = (kind: 'title' | 'caption') => {
    const label = kind === 'title' ? '默认标题' : '对白字幕';
    const cur = currentPlayhead();
    const startAt = computeNonStackStart(label);
    const style = resolveProjectStyle(project);
    const canvasHex = style?.backgroundColor || sequence.background || '#10161c';
    const lightCanvas = canvasHex.startsWith('#') && isLightHex(canvasHex);
    const c = newClip(kind, startAt);
    c.name = label;
    if (kind === 'title') {
      c.props.text = '输入主标题';
      c.props.color = style?.inkColor || (lightCanvas ? '#14171f' : '#f5f5f7');
    } else {
      c.props.text = '输入台词字幕';
    }
    void onEdit(`添加${label}`, [{ type: 'addClip', sequenceId: sequence.id, clip: c }]).then(() => {
      onSelectClip(c.id);
      if (startAt !== cur) onSeek(startAt);
    });
  };

  const insertPresetItem = (prId: string, name: string) => {
    const cur = currentPlayhead();
    const startAt = computeNonStackStart(name);
    const c = createPresetClip(prId, startAt, sequence.fps, {}, project);
    void onEdit(`添加「${name}」`, [{ type: 'addClip', sequenceId: sequence.id, clip: c }]).then(() => {
      onSelectClip(c.id);
      if (startAt !== cur) onSeek(startAt);
    });
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjName.trim()) return;
    const varId = uid('var');
    const now = new Date().toISOString();
    const item: VaultItem = {
      id: uid('pvault'),
      name: subjName.trim(),
      entityKind: 'image',
      role: subjRole,
      tags: [],
      category: 'subject',
      subkind: subjRole,
      promptAnchor: subjAnchor.trim() || `${subjName.trim()}，保持角色外观特征与比例一致`,
      assetId: subjRefId || undefined,
      assetKind: subjRefId ? 'image' : undefined,
      defaultVariantId: varId,
      variants: [
        {
          id: varId,
          name: varName.trim() || '默认状态',
          version: 1,
          assetId: subjRefId || undefined,
          promptDelta: subjAnchor.trim() || undefined,
          tags: [],
          updatedAt: now,
        },
      ],
      version: 1,
      updatedAt: now,
    };
    await onEdit(`新建设定「${item.name}」`, [{ type: 'putVaultItem', item }]);
    setShowCreator(false);
    setSubjName('');
    setSubjAnchor('');
    setSubjRefId('');
  };

  const hasScopeTabs = category === 'media' || category === 'audio' || category === 'component';
  const showProject = !hasScopeTabs || libScope === 'all' || libScope === 'project';
  const showPersonal = !hasScopeTabs || libScope === 'all' || libScope === 'personal';
  const showOfficial = !hasScopeTabs || libScope === 'all' || libScope === 'official';

  // Filtered collections per category (shared src/core/catalog.ts matcher — Review #13)
  const visualAssets = project.assets.filter(
    (a) => a.kind !== 'audio' && matchCatalogText(query, a.name, a.tags, a.kind),
  );
  const subjectEntities = filterVaultItems(
    projectVault,
    query,
    (v) => !v.rig?.componentId && v.entityKind !== 'text',
  );
  const personalMediaItems = filterVaultItems(
    personalLibrary,
    query,
    (g) =>
      !g.styleTokens &&
      !g.brand &&
      g.assetKind !== 'audio' &&
      g.entityKind !== 'component' &&
      g.entityKind !== 'three',
  );
  const studioFiltered = useMemo(
    () => filterStudioMediaByKind(studioMedia, query),
    [studioMedia, query],
  );
  const officialVisualMedia = studioFiltered.visual;

  const projectAudio = project.assets.filter(
    (a) => a.kind === 'audio' && matchCatalogText(query, a.name, a.tags, '音频 配音 audio'),
  );
  const personalAudio = filterVaultItems(
    personalLibrary,
    query,
    (g) => g.assetKind === 'audio' || g.entityKind === 'audio',
  );
  const officialAudio = studioFiltered.audio;

  const showPlainTitle = matchCatalogText(query, '默认标题 主标题 基础文本 title 字幕');
  const showPlainCaption = matchCatalogText(query, '对白字幕 屏幕底部字幕条 基础字幕 caption');
  const textPresets = useMemo(
    () => filterPresets(query, { categories: ['titles', 'captions'] }),
    [query],
  );
  const transitions = useMemo(() => filterTransitions(query), [query]);
  const officialCompPresets = useMemo(
    () => filterPresets(query, { categories: ['graphics', 'stages', 'backgrounds'] }),
    [query],
  );
  const projectComps = useMemo(
    () => filterProjectComponents(project.components, query),
    [project.components, query],
  );
  const personalComps = filterVaultItems(
    personalLibrary,
    query,
    (g) => g.entityKind === 'component' || g.entityKind === 'three',
  );

  const visibleHitCount =
    category === 'media'
      ? (showProject ? visualAssets.length + subjectEntities.length : 0) +
        (showPersonal ? personalMediaItems.length : 0) +
        (showOfficial ? officialVisualMedia.length : 0)
      : category === 'audio'
        ? (showProject ? projectAudio.length : 0) +
          (showPersonal ? personalAudio.length : 0) +
          (showOfficial ? officialAudio.length : 0)
        : category === 'text'
          ? (showPlainTitle ? 1 : 0) + (showPlainCaption ? 1 : 0) + (showOfficial ? textPresets.length : 0)
          : category === 'transition'
            ? transitions.length
            : (showProject ? projectComps.length : 0) +
              (showPersonal ? personalComps.length : 0) +
              (showOfficial ? officialCompPresets.length : 0);

  const isEmptySearch = Boolean(q) && visibleHitCount === 0;

  return (
    <aside className="asset-explorer capcut-explorer" aria-label="素材与效果库">
      {/* Primary Category Bar (CapCut Style) */}
      <nav className="ae-cat-rail" role="tablist" aria-label="素材分类">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const active = category === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`ae-cat-tab ${active ? 'active' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              <Icon size={14} />
              <span>{c.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Search & Import Bar */}
      <div className="ae-toolbar-row">
        <div className="ae-search-bar">
          <Search size={12} />
          <input
            type="search"
            aria-label="搜索素材或效果"
            placeholder={`搜索${CATEGORIES.find((x) => x.id === category)?.label || '内容'}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="ae-clear" aria-label="清空" onClick={() => setQuery('')}>
              <X size={11} />
            </button>
          )}
        </div>
        {(category === 'media' || category === 'audio') && (
          <button type="button" className="ae-import-btn" title="导入本地媒体或模型" onClick={onImportMedia}>
            <Upload size={11} /> 导入
          </button>
        )}
        {category === 'media' && (
          <button
            type="button"
            className={`ae-icon-act ${showCreator ? 'active' : ''}`}
            title="新建角色 / 产品一致性设定"
            onClick={() => setShowCreator((v) => !v)}
          >
            <Plus size={13} />
          </button>
        )}
        {(category === 'text' || category === 'component') && onOpenTemplateLibrary && (
          <button
            type="button"
            className="ae-import-btn"
            title="打开完整动态母版与预览库 (快捷键 T)"
            onClick={onOpenTemplateLibrary}
          >
            母版库
          </button>
        )}
      </div>

      {/* Secondary Library Source Filter (Figma Style: shown only when browsing multi-source categories) */}
      {(category === 'media' || category === 'audio' || category === 'component') && (
        <div className="ae-lib-tabs" role="tablist" aria-label="素材库来源">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={libScope === s.id}
              className={libScope === s.id ? 'active' : ''}
              onClick={() => setLibScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Search result summary bar (Review #13) */}
      {q && !isEmptySearch && (
        <div className="ae-search-meta" role="status">
          <span>命中 {visibleHitCount} 项</span>
          <div className="ae-search-meta-acts">
            {hasScopeTabs && libScope !== 'all' && (
              <button type="button" onClick={() => setLibScope('all')}>
                看全部来源
              </button>
            )}
            <button type="button" onClick={() => setQuery('')}>
              清空
            </button>
          </div>
        </div>
      )}

      {/* Inline Consistency Subject Creator */}
      {category === 'media' && showCreator && (
        <form className="ae-inline-form" onSubmit={(e) => void handleCreateSubject(e)}>
          <div className="ae-form-head">
            <b>新建一致性设定</b>
            <button type="button" onClick={() => setShowCreator(false)}>
              <X size={11} />
            </button>
          </div>
          <div className="ae-form-row">
            <select value={subjRole} onChange={(e) => setSubjRole(e.target.value as typeof subjRole)}>
              <option value="character">角色形象</option>
              <option value="product">产品主体</option>
              <option value="environment">场景环境</option>
            </select>
            <input
              required
              placeholder="名称（如 林夏）"
              value={subjName}
              onChange={(e) => setSubjName(e.target.value)}
            />
          </div>
          <div className="ae-form-row">
            <input
              placeholder="状态（如 雨夜风衣）"
              value={varName}
              onChange={(e) => setVarName(e.target.value)}
            />
            <select value={subjRefId} onChange={(e) => setSubjRefId(e.target.value)}>
              <option value="">参考图 (可选)</option>
              {project.assets
                .filter((a) => a.kind === 'image')
                .map((img) => (
                  <option key={img.id} value={img.id}>
                    {img.name}
                  </option>
                ))}
            </select>
          </div>
          <input
            placeholder="特征锚点词（供 AI 生成保持一致）"
            value={subjAnchor}
            onChange={(e) => setSubjAnchor(e.target.value)}
          />
          <button type="submit" className="button tiny primary">
            保存到当前项目
          </button>
        </form>
      )}

      {/* Scrollable CapCut Grid Body */}
      <div
        className="ae-scroll"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedKeys([]);
        }}
      >
        {isEmptySearch ? (
          <div className="ae-search-empty" role="status">
            <Search size={18} />
            <b>没有找到匹配「{query.trim()}」的内容</b>
            <p>
              当前在「{CATEGORIES.find((x) => x.id === category)?.label}
              {hasScopeTabs && libScope !== 'all'
                ? ` · ${SCOPES.find((x) => x.id === libScope)?.label}`
                : ''}
              」中无命中条目。
            </p>
            <div className="ae-empty-acts">
              <button type="button" className="button tiny subtle" onClick={() => setQuery('')}>
                清空搜索
              </button>
              {hasScopeTabs && libScope !== 'all' && (
                <button type="button" className="button tiny subtle" onClick={() => setLibScope('all')}>
                  切换至全部来源
                </button>
              )}
              {onOpenTemplateLibrary && (
                <button type="button" className="button tiny subtle" onClick={onOpenTemplateLibrary}>
                  打开动态母版库
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
        {/* 1. MEDIA */}
        {category === 'media' && (
          <>
            {showProject && (
              <>
                {subjectEntities.length > 0 && (
                  <section className="ae-group">
                    <div className="ae-group-title">
                      <span>{subjectEntities.some((x) => x.entityKind === 'compound') ? '设定与精剪资产' : '一致性设定'}（当前项目）</span>
                      <small>{subjectEntities.length}</small>
                    </div>
                    <div className="ae-card-grid">
                      {subjectEntities.map((v) => {
                        const selKey = `vault:${v.id}`;
                        const isSel = selectedKeys.includes(selKey);
                        const variants = v.variants || [];
                        const defVar = variants.find((x) => x.id === v.defaultVariantId) || variants[0];
                        const refId = defVar?.assetId || v.assetId;
                        const refAsset = refId ? project.assets.find((a) => a.id === refId) : undefined;
                        return (
                          <div
                            key={v.id}
                            className={`ae-card ${isSel ? 'selected' : ''}`}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/cocraft-entity', `${v.id}:${defVar?.id || ''}`);
                              e.dataTransfer.setData('application/cocraft-asset', `vault:${v.id}`);
                            }}
                          >
                            <div
                              className="ae-card-thumb"
                              onClick={(e) => {
                                if (e.metaKey || e.ctrlKey || e.shiftKey) {
                                  e.stopPropagation();
                                  toggleSelectKey(selKey);
                                } else {
                                  insertSubjectEntity(v, defVar);
                                }
                              }}
                            >
                              {refAsset?.thumbnail ? (
                                <img src={mediaUrl(previewOrigin, refAsset.id, true)} alt={v.name} />
                              ) : (
                                <div className="ae-card-placeholder">
                                  {v.entityKind === 'compound' ? <Layers size={16} /> : <ImageIcon size={16} />}
                                  <small>{v.entityKind === 'compound' ? '精剪资产' : ROLE_LABELS[inferAssetRole(v)]}</small>
                                </div>
                              )}
                              <span className="ae-card-tag">
                                {v.entityKind === 'compound' ? '精剪' : ROLE_LABELS[inferAssetRole(v)]}
                              </span>
                              <button
                                type="button"
                                className="ae-card-pub"
                                title="发布到个人库（跨项目复用）"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onPublishToLibrary({ itemId: v.id });
                                }}
                              >
                                <ArrowUpFromLine size={10} />
                              </button>
                              <button
                                type="button"
                                className="ae-card-del"
                                title="从当前项目删除"
                                aria-label={`删除设定 ${v.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onEdit(`删除设定「${v.name}」`, [
                                    { type: 'removeVaultItem', itemId: v.id },
                                  ]);
                                }}
                              >
                                <Trash2 size={10} />
                              </button>
                              <button
                                type="button"
                                className="ae-card-add"
                                title="添加到时间线"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  insertSubjectEntity(v, defVar);
                                }}
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                            <div className="ae-card-foot">
                              <b title={v.name}>{v.name}</b>
                              {variants.length > 0 && (
                                <small>{variants.map((vr) => vr.name).join(' · ')}</small>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="ae-group">
                  <div className="ae-group-title">
                    <span>项目媒体（当前项目）</span>
                    <small>{visualAssets.length}</small>
                  </div>
                  {visualAssets.length === 0 ? (
                    <div className="ae-empty-box">
                      <p>当前项目暂无视频、图片或三维模型</p>
                      <div className="ae-empty-acts">
                        <button type="button" className="button tiny subtle" onClick={onImportMedia}>
                          导入本地素材
                        </button>
                        <button
                          type="button"
                          className="button tiny subtle"
                          onClick={() => onOpenGeneration('image')}
                        >
                          AI 生图/视频
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ae-card-grid">
                      {visualAssets.map((a) => {
                        const uses = assetUsage.get(a.id) || [];
                        const selKey = `asset:${a.id}`;
                        const isSel = selectedKeys.includes(selKey);
                        return (
                          <div
                            key={a.id}
                            className={`ae-card ${a.offline ? 'offline' : ''} ${isSel ? 'selected' : ''}`}
                            draggable={!a.offline}
                            onDragStart={(e) => e.dataTransfer.setData('application/cocraft-asset', a.id)}
                          >
                            <div
                              className="ae-card-thumb"
                              onClick={(e) => {
                                if (e.metaKey || e.ctrlKey || e.shiftKey) {
                                  e.stopPropagation();
                                  toggleSelectKey(selKey);
                                } else if (uses.length) {
                                  onSeek(uses[0]);
                                } else {
                                  insertMediaAsset(a);
                                }
                              }}
                            >
                              {a.offline ? (
                                <div className="ae-card-placeholder">
                                  <Link2Off size={15} />
                                  <small>离线</small>
                                </div>
                              ) : a.thumbnail ? (
                                <img src={mediaUrl(previewOrigin, a.id, true)} alt={a.name} />
                              ) : a.kind === 'model-3d' ? (
                                <div className="ae-card-placeholder">
                                  <Box size={16} />
                                  <small>3D 模型</small>
                                </div>
                              ) : (
                                <div className="ae-card-placeholder">
                                  <Film size={16} />
                                </div>
                              )}
                              <span className="ae-card-tag">
                                {a.kind === 'video'
                                  ? `${a.duration.toFixed(1)}s`
                                  : a.kind === 'model-3d'
                                    ? a.subkind === 'splat-3d' || /\.(spz|splat|ksplat|ply)$/i.test(a.name)
                                      ? '3DGS'
                                      : 'GLB'
                                    : '图片'}
                              </span>
                              {uses.length > 0 && <span className="ae-card-use">{uses.length}x</span>}
                              {!a.offline && (
                                <button
                                  type="button"
                                  className="ae-card-pub"
                                  title="发布到个人库"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void onPublishToLibrary({ assetId: a.id });
                                  }}
                                >
                                  <ArrowUpFromLine size={10} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="ae-card-del"
                                title="从当前项目删除素材"
                                aria-label={`删除素材 ${a.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  try {
                                    const ops = buildDeleteAssetOperations(project, a.id);
                                    void onEdit(`删除素材「${a.name}」`, ops);
                                  } catch (err) {
                                    void onEdit(`删除素材「${a.name}」`, [{ type: 'removeAsset', assetId: a.id }]);
                                    console.warn(err);
                                  }
                                }}
                              >
                                <Trash2 size={10} />
                              </button>
                              <button
                                type="button"
                                className="ae-card-add"
                                title={a.offline ? '重新定位素材' : '放入时间线'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (a.offline) onRelinkAsset(a.id);
                                  else insertMediaAsset(a);
                                }}
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                            <div className="ae-card-foot">
                              <b title={a.name}>{a.name}</b>
                              {(a.kind === 'video' || a.kind === 'image') && !a.offline && (
                                <button
                                  type="button"
                                  className="ae-mini-link"
                                  title="套入设备外壳聚焦动画"
                                  onClick={() => {
                                    const wrapped = createPresetClip(
                                      'screen-focus-rig',
                                      currentPlayhead(),
                                      sequence.fps,
                                      { text: a.name.replace(/\.[^.]+$/, ''), frameStyle: 'macos' },
                                      project,
                                    );
                                    wrapped.assetId = a.id;
                                    wrapped.name = `${a.name.replace(/\.[^.]+$/, '')} · 窗口特写`;
                                    if (a.kind === 'video') {
                                      wrapped.duration = Math.max(45, Math.floor(a.duration * sequence.fps));
                                    }
                                    void onEdit(`添加「${wrapped.name}」`, [
                                      { type: 'addClip', sequenceId: sequence.id, clip: wrapped },
                                    ]).then(() => onSelectClip(wrapped.id));
                                  }}
                                >
                                  + 外壳特写
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}

            {showPersonal && (
              <section className="ae-group">
                <div className="ae-group-title">
                  <span>个人跨项目库</span>
                  <small>{personalMediaItems.length}</small>
                </div>
                {personalMediaItems.length === 0 ? (
                  <div className="ae-empty-hint">
                    在「当前项目」悬停资产点击 <b>↑</b> 即可存入个人库，供其它项目随时引入。
                  </div>
                ) : (
                  <div className="ae-card-grid">
                    {personalMediaItems.map((g) => (
                      <div key={g.id} className="ae-card">
                        <div className="ae-card-thumb" onClick={() => void onPullFromLibrary(g.id)}>
                        <div className="ae-card-placeholder">
                          {g.entityKind === 'pack' ? (
                            <Package size={16} />
                          ) : g.entityKind === 'compound' ? (
                            <Layers size={16} />
                          ) : (
                            <ImageIcon size={16} />
                          )}
                          <small>
                            {g.entityKind === 'pack'
                              ? `素材包 · ${g.packItems?.length || 0}项`
                              : g.entityKind === 'compound'
                                ? '精剪复合资产'
                                : ROLE_LABELS[inferAssetRole(g)]}
                          </small>
                        </div>
                        <span className="ae-card-tag personal">
                          {g.entityKind === 'pack' ? '素材包' : `个人库 v${g.version}`}
                        </span>
                          <button
                            type="button"
                            className="ae-card-pub"
                            title="从个人库移除"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onRemoveFromLibrary(g.id);
                            }}
                          >
                            <Trash2 size={10} />
                          </button>
                          <button
                            type="button"
                            className="ae-card-add"
                            title="引入当前项目"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onPullFromLibrary(g.id);
                            }}
                          >
                            <Download size={11} />
                          </button>
                        </div>
                        <div className="ae-card-foot">
                          <b title={g.name}>{g.name}</b>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {showOfficial && officialVisualMedia.length > 0 && (
              <section className="ae-group">
                <div className="ae-group-title">
                  <span>官方环境底板库</span>
                  <small>{officialVisualMedia.length}</small>
                </div>
                <div className="ae-card-grid">
                  {officialVisualMedia.map((sm) => (
                    <div
                      key={sm.id}
                      className="ae-card"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/cocraft-asset', `studio:${sm.id}`)}
                    >
                      <div className="ae-card-thumb" onClick={() => void onAddStudioMedia(sm.id)}>
                        <img src={mediaUrl(previewOrigin, sm.id)} alt={sm.name} />
                        <span className="ae-card-tag official">官方</span>
                        <button
                          type="button"
                          className="ae-card-add"
                          title="加入时间线"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onAddStudioMedia(sm.id);
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <div className="ae-card-foot">
                        <b>{sm.name}</b>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* 2. AUDIO */}
        {category === 'audio' && (
          <>
            {showProject && (
              <section className="ae-group">
                <div className="ae-group-title">
                  <span>项目音频与配音</span>
                  <small>{projectAudio.length}</small>
                </div>
                {projectAudio.length === 0 ? (
                  <div className="ae-empty-acts" style={{ padding: '4px 0 8px' }}>
                    <button
                      type="button"
                      className="button tiny subtle"
                      onClick={() => onOpenGeneration('speech')}
                    >
                      AI 生成旁白配音
                    </button>
                  </div>
                ) : (
                  <div className="ae-audio-list">
                    {projectAudio.map((a) => {
                      const selKey = `asset:${a.id}`;
                      const isSel = selectedKeys.includes(selKey);
                      return (
                        <div
                          key={a.id}
                          className={`ae-audio-row ${isSel ? 'selected' : ''}`}
                          draggable={!a.offline}
                          onDragStart={(e) => e.dataTransfer.setData('application/cocraft-asset', a.id)}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey) {
                              e.stopPropagation();
                              toggleSelectKey(selKey);
                            }
                          }}
                        >
                          <div className="ae-audio-row-top">
                            <div className="ae-audio-meta">
                              <b title={a.name}>{a.name}</b>
                              <small>{a.duration.toFixed(1)}s · 项目</small>
                            </div>
                            <button
                              type="button"
                              className="ae-audio-act"
                              title="发布到个人库"
                              onClick={(e) => {
                                e.stopPropagation();
                                void onPublishToLibrary({ assetId: a.id });
                              }}
                            >
                              <ArrowUpFromLine size={11} />
                            </button>
                            <button
                              type="button"
                              className="ae-audio-act del"
                              title="从当前项目删除音频"
                              aria-label={`删除音频 ${a.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                try {
                                  const ops = buildDeleteAssetOperations(project, a.id);
                                  void onEdit(`删除音频「${a.name}」`, ops);
                                } catch {
                                  void onEdit(`删除音频「${a.name}」`, [{ type: 'removeAsset', assetId: a.id }]);
                                }
                              }}
                            >
                              <Trash2 size={11} />
                            </button>
                            <button
                              type="button"
                              className="ae-audio-act add"
                              title="插入时间线"
                              onClick={(e) => {
                                e.stopPropagation();
                                insertMediaAsset(a);
                              }}
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                          {!a.offline && (
                            <AudioWaveformPlayer
                              id={`ae-${a.id}`}
                              name={a.name}
                              url={mediaUrl(previewOrigin, a.id)}
                              duration={a.duration}
                              waveform={a.waveform}
                              compact
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {showPersonal && personalAudio.length > 0 && (
              <section className="ae-group">
                <div className="ae-group-title">
                  <span>个人音效与配乐库</span>
                  <small>{personalAudio.length}</small>
                </div>
                <div className="ae-audio-list">
                  {personalAudio.map((g) => (
                    <div key={g.id} className="ae-audio-row">
                      <Volume2 size={13} className="ae-audio-ic" />
                      <div className="ae-audio-meta">
                        <b>{g.name}</b>
                        <small>个人库 v{g.version}</small>
                      </div>
                      <button
                        type="button"
                        className="ae-audio-act add"
                        title="引入当前项目"
                        onClick={() => void onPullFromLibrary(g.id)}
                      >
                        <Download size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {showOfficial && (
              <section className="ae-group">
                <div className="ae-group-title">
                  <span>官方点缀音效与底乐</span>
                  <small>{officialAudio.length}</small>
                </div>
                <div className="ae-audio-list">
                  {officialAudio.map((sm) => (
                    <div
                      key={sm.id}
                      className="ae-audio-row"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/cocraft-asset', `studio:${sm.id}`)}
                    >
                      <div className="ae-audio-row-top">
                        <div className="ae-audio-meta">
                          <b title={sm.name}>{sm.name}</b>
                          <small>{sm.duration.toFixed(1)}s · 官方内置</small>
                        </div>
                        <button
                          type="button"
                          className="ae-audio-act add"
                          title="插入时间线"
                          onClick={() => void onAddStudioMedia(sm.id)}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <AudioWaveformPlayer
                        id={`ae-${sm.id}`}
                        name={sm.name}
                        url={mediaUrl(previewOrigin, sm.id)}
                        duration={sm.duration}
                        waveform={sm.waveform}
                        compact
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* 3. TEXT */}
        {category === 'text' && (
          <>
            <section className="ae-group">
              <div className="ae-group-title">
                <span>基础文本与花字</span>
                <small>{(showPlainTitle ? 1 : 0) + (showPlainCaption ? 1 : 0) + textPresets.length}</small>
              </div>
              <div className="ae-card-grid">
                {showPlainTitle && (
                  <div className="ae-card">
                    <div className="ae-card-thumb ae-text-sample" onClick={() => insertPlainText('title')}>
                      <span className="ae-sample-title">默认主标题</span>
                      <span className="ae-card-tag official">基础</span>
                      <button
                        type="button"
                        className="ae-card-add"
                        title="添加默认标题"
                        onClick={(e) => {
                          e.stopPropagation();
                          insertPlainText('title');
                        }}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="ae-card-foot">
                      <b>默认标题</b>
                    </div>
                  </div>
                )}

                {showPlainCaption && (
                  <div className="ae-card">
                    <div className="ae-card-thumb ae-text-sample" onClick={() => insertPlainText('caption')}>
                      <span className="ae-sample-caption">屏幕底部字幕条</span>
                      <span className="ae-card-tag official">基础</span>
                      <button
                        type="button"
                        className="ae-card-add"
                        title="添加对白字幕"
                        onClick={(e) => {
                          e.stopPropagation();
                          insertPlainText('caption');
                        }}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="ae-card-foot">
                      <b>对白字幕</b>
                    </div>
                  </div>
                )}

                {showOfficial &&
                  textPresets.map((pr) => (
                    <div
                      key={pr.id}
                      className="ae-card"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/cocraft-asset', `preset:${pr.id}`)}
                    >
                      <div className="ae-card-thumb" onClick={() => insertPresetItem(pr.id, pr.name)}>
                        <PresetPreview presetId={pr.id} portrait={portrait} thumbnail />
                        <span className="ae-card-tag official">官方</span>
                        <button
                          type="button"
                          className="ae-card-add"
                          title={`添加「${pr.name}」`}
                          onClick={(e) => {
                            e.stopPropagation();
                            insertPresetItem(pr.id, pr.name);
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <div className="ae-card-foot">
                        <b title={pr.name}>{pr.name}</b>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          </>
        )}

        {/* 4. TRANSITIONS */}
        {category === 'transition' && (
          <section className="ae-group">
            <div className="ae-group-title">
              <span>官方转场效果（拖放或点击应用）</span>
              <small>{transitions.length}</small>
            </div>
            <div className="ae-card-grid">
              {transitions.map((tr) => (
                <div
                  key={tr.id}
                  className="ae-card"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/cocraft-transition', tr.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <div
                    className={`ae-card-thumb ae-tr-preview tr-${tr.id}`}
                    onClick={() => void onAddTransition(tr.id)}
                  >
                    <div className="ae-tr-half left">A</div>
                    <div className="ae-tr-seam" />
                    <div className="ae-tr-half right">B</div>
                    <span className="ae-card-tag official">{tr.defaultSeconds}s</span>
                    <button
                      type="button"
                      className="ae-card-add"
                      title="应用到选中片段或当前镜头"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onAddTransition(tr.id);
                      }}
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  <div className="ae-card-foot">
                    <b title={tr.description}>{tr.name}</b>
                    <small>{tr.description}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 5. COMPONENTS & GRAPHICS */}
        {category === 'component' && (
          <>
            {showProject && (
              <section className="ae-group">
                <div className="ae-group-title">
                  <span>自定义组件（当前项目）</span>
                  <small>{projectComps.length}</small>
                </div>
                {projectComps.length > 0 && (
                  <div className="ae-card-grid">
                    {projectComps.map((comp) => (
                      <div key={comp.id} className="ae-card">
                        <div
                          className="ae-card-thumb"
                          onClick={() => {
                            const c: Clip = {
                              ...newClip('code', currentPlayhead()),
                              name: comp.name,
                              componentId: comp.id,
                              props: { ...comp.props },
                            };
                            void onEdit(`添加组件「${comp.name}」`, [
                              { type: 'addClip', sequenceId: sequence.id, clip: c },
                            ]).then(() => onSelectClip(c.id));
                          }}
                        >
                          <CodeComponentThumb component={comp} showPill={false} />
                          <span className="ae-card-tag">TSX</span>
                          <button
                            type="button"
                            className="ae-card-pub"
                            title="发布组件到个人库"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onPublishToLibrary({ componentId: comp.id });
                            }}
                          >
                            <ArrowUpFromLine size={10} />
                          </button>
                          <button
                            type="button"
                            className="ae-card-del"
                            title="从当前项目删除组件"
                            aria-label={`删除组件 ${comp.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              try {
                                const ops = buildDeleteComponentOperations(project, comp.id);
                                void onEdit(`删除组件「${comp.name}」`, ops);
                              } catch {
                                void onEdit(`删除组件「${comp.name}」`, [
                                  { type: 'removeComponent', componentId: comp.id },
                                ]);
                              }
                            }}
                          >
                            <Trash2 size={10} />
                          </button>
                          <button
                            type="button"
                            className="ae-card-add"
                            title="添加到时间线"
                            onClick={(e) => {
                              e.stopPropagation();
                              const c: Clip = {
                                ...newClip('code', currentPlayhead()),
                                name: comp.name,
                                componentId: comp.id,
                                props: { ...comp.props },
                              };
                              void onEdit(`添加组件「${comp.name}」`, [
                                { type: 'addClip', sequenceId: sequence.id, clip: c },
                              ]).then(() => onSelectClip(c.id));
                            }}
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                        <div className="ae-card-foot">
                          <b>{comp.name}</b>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {showPersonal && personalComps.length > 0 && (
              <section className="ae-group">
                <div className="ae-group-title">
                  <span>个人组件库</span>
                  <small>{personalComps.length}</small>
                </div>
                <div className="ae-card-grid">
                  {personalComps.map((g) => (
                    <div key={g.id} className="ae-card">
                      <div className="ae-card-thumb" onClick={() => void onPullFromLibrary(g.id)}>
                        <div className="ae-card-placeholder">
                          <Layers size={16} />
                          <small>个人组件</small>
                        </div>
                        <span className="ae-card-tag personal">个人库</span>
                        <button
                          type="button"
                          className="ae-card-pub"
                          title="从个人库移除"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onRemoveFromLibrary(g.id);
                          }}
                        >
                          <Trash2 size={10} />
                        </button>
                        <button
                          type="button"
                          className="ae-card-add"
                          title="引入当前项目"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onPullFromLibrary(g.id);
                          }}
                        >
                          <Download size={11} />
                        </button>
                      </div>
                      <div className="ae-card-foot">
                        <b>{g.name}</b>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {showOfficial && (
              <section className="ae-group">
                <div className="ae-group-title">
                  <span>官方舞台、图解与背景组件</span>
                  <small>{officialCompPresets.length}</small>
                </div>
                <div className="ae-card-grid">
                  {officialCompPresets.map((pr) => (
                    <div
                      key={pr.id}
                      className="ae-card"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/cocraft-asset', `preset:${pr.id}`)}
                    >
                      <div className="ae-card-thumb" onClick={() => insertPresetItem(pr.id, pr.name)}>
                        <PresetPreview presetId={pr.id} portrait={portrait} thumbnail />
                        <span className="ae-card-tag official">
                          {pr.category === 'stages' ? '舞台' : pr.category === 'graphics' ? '图解' : '底板'}
                        </span>
                        <button
                          type="button"
                          className="ae-card-add"
                          title={`添加「${pr.name}」`}
                          onClick={(e) => {
                            e.stopPropagation();
                            insertPresetItem(pr.id, pr.name);
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <div className="ae-card-foot">
                        <b title={pr.description}>{pr.name}</b>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
          </>
        )}
      </div>

      {selectedKeys.length >= 2 && (
        <div className="ae-multi-bar" role="toolbar" aria-label="多选素材操作">
          <span>已选 {selectedKeys.length} 项</span>
          {onAddRefsToChat && (
            <button
              type="button"
              title="批量添加到 Agent 对话上下文"
              onClick={() => {
                const refs: ChatContextRef[] = [];
                for (const key of selectedKeys) {
                  if (key.startsWith('asset:')) {
                    const a = project.assets.find((x) => `asset:${x.id}` === key);
                    if (a) refs.push({ key, kind: 'asset', id: a.id, label: a.name });
                  } else if (key.startsWith('vault:')) {
                    const v = projectVault.find((x) => `vault:${x.id}` === key);
                    if (v) refs.push({ key, kind: 'entity', id: v.id, label: v.name });
                  }
                }
                if (refs.length) onAddRefsToChat(refs);
                setSelectedKeys([]);
              }}
            >
              <AtSign size={11} /> 对话
            </button>
          )}
          <button
            type="button"
            title="打包为跨项目素材包存入个人库"
            onClick={() => {
              const assetIds = selectedKeys.filter((k) => k.startsWith('asset:')).map((k) => k.slice(6));
              const vaultIds = selectedKeys.filter((k) => k.startsWith('vault:')).map((k) => k.slice(6));
              const packName = `${project.name}-素材包 (${selectedKeys.length}项)`;
              void onPublishToLibrary({ pack: { name: packName, assetIds, vaultIds } });
              setSelectedKeys([]);
            }}
          >
            <Package size={11} /> 打包
          </button>
          <button
            type="button"
            title="清空多选"
            onClick={() => setSelectedKeys([])}
          >
            <X size={11} />
          </button>
        </div>
      )}
    </aside>
  );
});
