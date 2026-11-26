import React, { useEffect, useRef, useState } from 'react';
import {
  Settings2,
  KeyRound,
  Boxes,
  Workflow,
  Palette,
  Plug,
  Code2,
  Plus,
  Trash2,
  Check,
  ChevronDown,
  ChevronRight,
  ArrowDownToLine,
  RefreshCw,
  FolderOpen,
  Search,
  Zap,
  Cable,
  FileCode2,
} from 'lucide-react';
import { Modal, Spinner } from './ui';
import {
  modelUses,
  adapters,
  providerPresets,
  compatibleAdapters,
  providerModelSuites,
  suggestedModelsFor,
  inferModelFromId,
  DASHSCOPE_VOICES,
  MINIMAX_VOICES,
  type CuratedModelOption,
} from '../core/models';
import { MCP_SERVER_PRESETS, parseMcpServersJson } from '../core/mcp';
import { uid } from '../core/project';
import { friendlySkillTitle } from '../core/taxonomy';
import type {
  Settings,
  ProviderConnection,
  ModelDefinition,
  ModelUse,
  SkillInfo,
  System1Settings,
  System1UsageStats,
  McpServerConfig,
  McpServerStatus,
  McpRemoteToolInfo,
} from '../core/types';

type Props = {
  settings: Settings;
  initialTab?: string;
  onSave: (s: Partial<Settings>) => Promise<void>;
  onClose: () => void;
  skills: SkillInfo[];
  onRefreshSkills?: (skills: SkillInfo[]) => void;
  activeSkillIds?: string[];
  onToggleProjectSkill?: (skillName: string, enabled: boolean) => Promise<void>;
  onOpenSkills: () => void;
  projectDefaults?: Partial<Record<ModelUse, string>>;
  onProjectDefaults?: (v: Partial<Record<ModelUse, string>>) => Promise<void>;
};
const sections = [
  ['general', '常规', Settings2],
  ['appearance', '外观', Palette],
  ['providers', '提供商', KeyRound],
  ['models', '模型', Boxes],
  ['defaults', '用途默认值', Workflow],
  ['system1', '智能辅助', Zap],
  ['assets', '素材服务', Plug],
  ['mcp', 'MCP 服务', Cable],
  ['skills', 'Skills 与工具', Code2],
] as const;
export function SettingsDialog({
  settings,
  initialTab,
  onSave,
  onClose,
  skills,
  onRefreshSkills,
  activeSkillIds = [],
  onToggleProjectSkill,
  onOpenSkills,
  projectDefaults = {},
  onProjectDefaults,
}: Props) {
  const [tab, setTab] = useState(initialTab || 'general');
  const [draft, setDraft] = useState<Settings>(structuredClone(settings));
  const [projectDraft, setProjectDraft] = useState({ ...projectDefaults });
  const [scope, setScope] = useState('app');
  const [providerId, setProviderId] = useState(
    settings.providers.find((p) => p.protocol !== 'system')?.id || '',
  );
  const [modelId, setModelId] = useState(
    settings.models.find((m) => m.adapter !== 'system-speech')?.id || '',
  );
  const [error, setError] = useState(''),
    [info, setInfo] = useState(''),
    [saving, setSaving] = useState(false),
    [checking, setChecking] = useState(false);
  const [discoveredByProvider, setDiscoveredByProvider] = useState<Record<string, { id: string; name: string }[]>>({}),
    [filter, setFilter] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelEditorRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const discovered = providerId ? discoveredByProvider[providerId] || [] : [];

  useEffect(() => {
    if (!modelPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setModelPickerOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [modelPickerOpen]);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string>(skills[0]?.name || '');
  const [skillEditor, setSkillEditor] = useState<{
    mode: 'new' | 'edit';
    scope: 'project' | 'user';
    slug: string;
    description: string;
    body: string;
  } | null>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillImportScope, setSkillImportScope] = useState<'project' | 'user'>('project');
  const [mcpInfo, setMcpInfo] = useState<{ running: boolean; port: number | null; scriptPath?: string; discoveryFile?: string } | null>(null);
  const [mcpCopied, setMcpCopied] = useState(false);
  const [selectedMcpId, setSelectedMcpId] = useState<string>(settings.mcpServers?.[0]?.id || '');
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [mcpToolsByServer, setMcpToolsByServer] = useState<Record<string, McpRemoteToolInfo[]>>({});
  const [mcpTestingId, setMcpTestingId] = useState('');
  const [mcpJsonOpen, setMcpJsonOpen] = useState(false);
  const [mcpJsonDraft, setMcpJsonDraft] = useState('');
  const [mcpEnvText, setMcpEnvText] = useState('');
  const [mcpHeadersText, setMcpHeadersText] = useState('');
  const [s1Usage, setS1Usage] = useState<System1UsageStats | null>(null);
  const [s1Testing, setS1Testing] = useState(false);

  const mcpServers: McpServerConfig[] = draft.mcpServers || [];
  const activeMcpServer = mcpServers.find((s) => s.id === selectedMcpId) || mcpServers[0];
  const updateMcpServer = (id: string, patch: Partial<McpServerConfig>) => {
    field(
      'mcpServers',
      mcpServers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  };
  const addMcpServer = (cfg: Omit<McpServerConfig, 'id'>) => {
    const id = uid('mcp');
    const created: McpServerConfig = { id, ...cfg };
    field('mcpServers', [...mcpServers, created]);
    setSelectedMcpId(id);
    setMcpEnvText('');
    setMcpHeadersText('');
    setError('');
    setInfo(`已添加 MCP 服务「${created.name}」，点击「测试连接」检查工具或保存生效。`);
  };
  const removeMcpServer = (id: string) => {
    const rest = mcpServers.filter((s) => s.id !== id);
    field('mcpServers', rest);
    setSelectedMcpId(rest[0]?.id || '');
    setMcpEnvText('');
    setMcpHeadersText('');
  };

  useEffect(() => {
    if (tab !== 'mcp') return;
    void window.cocraft
      .call<McpServerStatus[]>('mcp.client.status', {})
      .then((list) => {
        setMcpStatuses(list);
        const byServer: Record<string, McpRemoteToolInfo[]> = {};
        for (const st of list) {
          if (st.tools?.length) byServer[st.id] = st.tools;
        }
        if (Object.keys(byServer).length) {
          setMcpToolsByServer((prev) => ({ ...prev, ...byServer }));
        }
      })
      .catch(() => {});
  }, [tab]);

  const s1: System1Settings = draft.system1 || {
    mode: 'off',
    jevBaseUrl: 'https://api.typesafe.ai/v1',
    jevModelId: 'jev-latest',
    hasJevApiKey: false,
    features: {
      autoReframeBox: false,
      batchQualityGate: false,
      omnibarRouter: false,
      autoTagAssets: false,
    },
    monthlyCallCap: 500,
  };
  const updateSystem1 = (patch: Partial<System1Settings>) =>
    field('system1', {
      ...s1,
      ...patch,
      features: { ...s1.features, ...(patch.features || {}) },
    });

  useEffect(() => {
    if (tab !== 'system1') return;
    void window.cocraft
      .call<{ usage: System1UsageStats }>('system1.status', {})
      .then((res) => setS1Usage(res.usage))
      .catch(() => {});
  }, [tab]);

  useEffect(() => {
    void window.cocraft
      .call<{ running: boolean; port: number | null; scriptPath: string; discoveryFile: string }>('mcp.status', {})
      .then((res) => setMcpInfo(res))
      .catch(() => {});
  }, [settings.mcpBridgeEnabled]);

  // Live-preview appearance toggles (glass / glow / glowColor / motion) while editing; restore saved values if closed without saving
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.glass = draft.glass ? 'on' : 'off';
    el.dataset.glow = draft.glow || 'subtle';
    el.dataset.glowColor = draft.glowColor || 'emerald';
    el.dataset.motion = draft.motionEffects === false ? 'off' : 'on';
    return () => {
      el.dataset.glass = settings.glass ? 'on' : 'off';
      el.dataset.glow = settings.glow || 'subtle';
      el.dataset.glowColor = settings.glowColor || 'emerald';
      el.dataset.motion = settings.motionEffects === false ? 'off' : 'on';
    };
  }, [
    draft.glass,
    draft.glow,
    draft.glowColor,
    draft.motionEffects,
    settings.glass,
    settings.glow,
    settings.glowColor,
    settings.motionEffects,
  ]);
  const provider = draft.providers.find((p) => p.id === providerId),
    model = draft.models.find((m) => m.id === modelId);
  const field = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const updateProvider = (changes: Partial<ProviderConnection>) =>
    field(
      'providers',
      draft.providers.map((p) => {
        if (p.id !== providerId) return p;
        const next = { ...p, ...changes };
        const stored = settings.providers.find((v) => v.id === p.id);
        if (
          stored &&
          (next.protocol !== stored.protocol ||
            next.baseUrl.trim().replace(/\/+$/, '') !== stored.baseUrl.trim().replace(/\/+$/, ''))
        ) {
          next.hasApiKey = false;
          if (changes.baseUrl !== undefined || changes.protocol !== undefined) delete next.apiKey;
        } else if (stored) next.hasApiKey = stored.hasApiKey;
        return next;
      }),
    );
  const updateModel = (changes: Partial<ModelDefinition>) =>
    setDraft((d) => {
      const models = d.models.map((m) => (m.id === modelId ? { ...m, ...changes } : m));
      const updated = models.find((m) => m.id === modelId),
        defaults = { ...d.defaults };
      if (updated && changes.capabilities)
        for (const use of modelUses) {
          if (defaults[use.id] === modelId && !updated.capabilities.includes(use.id)) delete defaults[use.id];
          if (!defaults[use.id] && updated.capabilities.includes(use.id)) defaults[use.id] = modelId;
        }
      return { ...d, models, defaults };
    });
  const addProvider = (index: number) => {
    const p = { ...providerPresets[index], id: uid('provider'), hasApiKey: false };
    field('providers', [...draft.providers, p]);
    setProviderId(p.id);
    setInfo('');
  };
  const addModel = (id = '', targetProviderId?: string) => {
    const p =
      (targetProviderId ? draft.providers.find((x) => x.id === targetProviderId && x.protocol !== 'system') : undefined) ||
      draft.providers.find((x) => x.id === (model?.providerId || providerId) && x.protocol !== 'system') ||
      draft.providers.find((x) => x.protocol !== 'system');
    if (!p) {
      setTab('providers');
      setInfo('先添加一个提供商连接，再添加它提供的模型。');
      return;
    }
    const inferred = id
      ? inferModelFromId(id, p.protocol)
      : { name: '新模型', modelId: '', capabilities: ['agent'] as ModelUse[], adapter: 'chat' as const, parameters: {} };
    const m: ModelDefinition = {
      id: uid('model'),
      providerId: p.id,
      ...inferred,
    };
    setDraft((d) => {
      const defaults = { ...d.defaults };
      for (const use of m.capabilities) {
        if (!defaults[use] || (use === 'speech' && defaults[use] === 'system-speech')) {
          defaults[use] = m.id;
        }
      }
      return { ...d, models: [...d.models, m], defaults };
    });
    setModelId(m.id);
    setTab('models');
    setInfo('');
    if (!id) {
      setModelPickerOpen(true);
      requestAnimationFrame(() => modelEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
  };
  const applyProviderSuite = (p: ProviderConnection) => {
    const suite = providerModelSuites[p.protocol];
    if (!suite) return;
    let added = 0;
    let firstId = '';
    const nextModels = [...draft.models];
    const nextDefaults = { ...draft.defaults };
    const byModelId = new Map<string, ModelDefinition>();
    for (const existing of nextModels) {
      if (existing.providerId === p.id) byModelId.set(existing.modelId, existing);
    }
    for (const tpl of suite.models) {
      let entry = byModelId.get(tpl.modelId);
      if (!entry) {
        entry = {
          id: uid('model'),
          providerId: p.id,
          name: tpl.name,
          modelId: tpl.modelId,
          capabilities: [...tpl.capabilities],
          adapter: tpl.adapter,
          parameters: { ...tpl.parameters },
        };
        nextModels.push(entry);
        byModelId.set(tpl.modelId, entry);
        added++;
      }
      if (!firstId) firstId = entry.id;
    }
    for (const [use, mId] of Object.entries(suite.defaultRoles) as [ModelUse, string][]) {
      const target = byModelId.get(mId);
      if (target && (!nextDefaults[use] || (use === 'speech' && nextDefaults[use] === 'system-speech'))) {
        nextDefaults[use] = target.id;
      }
    }
    setDraft((d) => ({ ...d, models: nextModels, defaults: nextDefaults }));
    if (firstId) setModelId(firstId);
    setError('');
    setInfo(
      added > 0
        ? `已为「${p.name}」填入 ${added} 个全模态模型并关联默认用途；填写 API Key 后保存即可使用。`
        : `「${p.name}」推荐模型套件已存在并完成默认用途校验。`,
    );
  };
  const discover = async (targetProvider?: ProviderConnection, openPicker = false) => {
    const target = targetProvider || provider;
    if (!target) return;
    setChecking(true);
    setError('');
    setInfo('');
    try {
      const result = await window.cocraft.call<{ models: { id: string; name: string }[]; message: string }>(
        'providers.inspect',
        { provider: target },
      );
      setDiscoveredByProvider((prev) => ({ ...prev, [target.id]: result.models }));
      if (openPicker) setModelPickerOpen(true);
      setInfo(result.message);
    } catch (e) {
      setError(String(e).replace(/^Error:.*?Error: /, ''));
    } finally {
      setChecking(false);
    }
  };
  const applyPickedModelId = (pickedId: string, curated?: CuratedModelOption) => {
    if (!model) return;
    const p = draft.providers.find((x) => x.id === model.providerId);
    const trimmed = pickedId.trim();
    const inferred = curated || (p ? inferModelFromId(trimmed, p.protocol) : undefined);
    const shouldReplaceName =
      !model.name.trim() ||
      model.name === '新模型' ||
      model.name === model.modelId ||
      suggestedModelsFor(p?.protocol).some((s) => s.name === model.name);
    const changes: Partial<ModelDefinition> = {
      modelId: trimmed,
      ...(shouldReplaceName && inferred ? { name: inferred.name } : {}),
    };
    if (curated) {
      changes.adapter = curated.adapter;
      changes.capabilities = [...curated.capabilities];
      if (curated.parameters) changes.parameters = { ...curated.parameters, ...model.parameters };
    } else if (inferred && !model.modelId) {
      // Auto-select adapter & capabilities when filling a fresh empty model entry
      changes.adapter = inferred.adapter;
      changes.capabilities = [...inferred.capabilities];
      if (inferred.parameters) changes.parameters = { ...inferred.parameters };
    }
    updateModel(changes);
    setModelPickerOpen(false);
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const next = structuredClone(draft);
      next.providers = next.providers.map((p) => {
        if (!p.apiKey) delete p.apiKey;
        return p;
      });
      if (!next.pexelsKey) delete next.pexelsKey;
      for (const p of next.providers)
        if (!p.name.trim() || (p.protocol !== 'system' && !p.baseUrl.trim()))
          throw new Error('请补全提供商名称和接口地址');
      for (const m of next.models)
        if (!m.modelId.trim() || !m.name.trim() || !m.capabilities.length)
          throw new Error('请补全模型 ID、名称与用途');
      const cleanProject = { ...projectDraft };
      for (const use of modelUses) {
        const valid = (id?: string) =>
          next.models.some((m) => m.id === id && m.capabilities.includes(use.id));
        if (cleanProject[use.id] && !valid(cleanProject[use.id])) delete cleanProject[use.id];
      }
      await onSave(next);
      if (onProjectDefaults && JSON.stringify(cleanProject) !== JSON.stringify(projectDefaults))
        await onProjectDefaults(cleanProject);
      onClose();
    } catch (e) {
      setError(String(e).replace(/^Error:.*?Error: /, ''));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="设置" onClose={onClose} className="settings-shell" wide>
      <div className="settings-workspace">
        <nav className="settings-nav" aria-label="设置分类">
          <span className="settings-group-label">工作空间</span>
          {sections.map(([id, name, Icon], i) => (
            <React.Fragment key={id}>
              {i === 2 && <span className="settings-group-label">模型与服务</span>}
              {i === 6 && <span className="settings-group-label">扩展</span>}
              <button
                className={tab === id ? 'active' : ''}
                onClick={() => {
                  setTab(id);
                  setError('');
                  setInfo('');
                }}
                aria-current={tab === id ? 'page' : undefined}
              >
                <Icon size={16} />
                {name}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <section className="settings-page" key={tab}>
          <header className="settings-page-head">
            <h2>{sections.find((s) => s[0] === tab)?.[1]}</h2>
            <p>
              {
                (
                  {
                    general: '让工作台适合你的创作方式。',
                    appearance: '清晰的层次，舒适的阅读，恰到好处的质感。',
                    providers: '管理服务连接与凭据。一个连接可以提供多个模型。',
                    models: '登记模型与能力，选择对应接口。模型可以承担多个用途。',
                    defaults: '为不同工作选择合适的模型，项目可以覆盖全局设置。',
                    assets: '连接素材来源，导入时保留来源与许可。',
                    mcp: '配置内置 Agent 可调用的外部 MCP 服务（如 Blender MCP），以及对外开放的本地 MCP 桥接服务。',
                    skills: 'Agent 通过 Skills、编码和工具扩展创作能力。',
                  } as Record<string, string>
                )[tab]
              }
            </p>
          </header>
          {tab === 'general' && (
            <>
              <div className="settings-section">
                <h3>工作方式</h3>
                <div className="setting-row">
                  <div>
                    <b>自动保存</b>
                    <p>编辑以版本保存，可撤销并恢复。</p>
                  </div>
                  <span className="status-badge good">
                    <Check size={12} />
                    已启用
                  </span>
                </div>
                <div className="setting-row">
                  <div>
                    <b>新建会话</b>
                    <p>直接输入需求，首次发送后自动命名。</p>
                  </div>
                  <span className="setting-value">自动</span>
                </div>
                <div className="setting-row">
                  <div>
                    <b>工程文件</b>
                    <p>素材、组件、会话和版本保存在本机。</p>
                  </div>
                  <button className="button subtle" onClick={() => window.cocraft.call('project.reveal')}>
                    <FolderOpen size={14} />
                    打开
                  </button>
                </div>
              </div>
              <div className="settings-section">
                <h3>快捷键</h3>
                {[
                  ['播放 / 暂停', 'Space'],
                  ['命令面板', '⌘ K'],
                  ['切换 创作 / 精剪模式', '⌘ 1 / ⌘ 2'],
                  ['收起 / 展开左栏 / 底栏', '⌘ \\ / ⌘ J'],
                  ['分割片段', '⌘ B'],
                  ['撤销 / 重做', '⌘ Z / ⇧ ⌘ Z'],
                  ['导入素材', '⌘ I'],
                  ['逐帧 / 十帧移动', '← → / ⇧ ← →'],
                  ['锁定片段', 'L'],
                ].map(([a, b]) => (
                  <div className="setting-row compact" key={a}>
                    <span>{a}</span>
                    <kbd>{b}</kbd>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === 'appearance' && (
            <>
              <div className="appearance-choices">
                {(['dark', 'light', 'system'] as const).map((theme) => (
                  <button
                    key={theme}
                    className={`appearance-choice ${draft.theme === theme ? 'selected' : ''}`}
                    onClick={() => field('theme', theme)}
                  >
                    <div className={`theme-mini ${theme}`}>
                      <i />
                      <div>
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                    <span>
                      {theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '跟随系统'}
                      {draft.theme === theme && <Check size={14} />}
                    </span>
                  </button>
                ))}
              </div>
              <div className="settings-section">
                <div className="setting-row">
                  <div>
                    <b>通透材质</b>
                    <p>应用于顶栏、浮动控件与弹层，预览画面保持原色。</p>
                  </div>
                  <input
                    className="switch"
                    aria-label="通透材质"
                    type="checkbox"
                    checked={draft.glass}
                    onChange={(e) => field('glass', e.target.checked)}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <b>界面光效</b>
                    <p>实体玻璃层次、追踪白芯彗星切边与生成中流体光场（视频画框内绝不染色）。</p>
                  </div>
                  <div className="segmented-inline" role="group" aria-label="界面光效强度">
                    {(
                      [
                        ['off', '关闭'],
                        ['subtle', '细腻'],
                        ['vivid', '灵动'],
                      ] as const
                    ).map(([val, text]) => (
                      <button
                        key={val}
                        type="button"
                        aria-pressed={(draft.glow || 'subtle') === val}
                        className={(draft.glow || 'subtle') === val ? 'active' : ''}
                        onClick={() => field('glow', val)}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <b>光效色系</b>
                    <p>为 AI 追踪彗星、生成流体光场与连线光子选择主题光色，切换即实时预览。</p>
                  </div>
                  <div className="glow-color-swatches" role="group" aria-label="光效色系">
                    {(
                      [
                        ['emerald', '翡翠绿', '#10b981'],
                        ['silver', '极简银', '#cbd5e1'],
                        ['cobalt', '光学蓝', '#38bdf8'],
                        ['amber', '暖胶片', '#f59e0b'],
                        ['aurora', '极光青', '#2dd4bf'],
                      ] as const
                    ).map(([val, label, dotColor]) => (
                      <button
                        key={val}
                        type="button"
                        disabled={(draft.glow || 'subtle') === 'off'}
                        aria-pressed={(draft.glowColor || 'emerald') === val}
                        className={`glow-swatch-btn ${(draft.glowColor || 'emerald') === val ? 'active' : ''}`}
                        onClick={() => field('glowColor', val)}
                      >
                        <i style={{ background: dotColor }} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <b>光效动画</b>
                    <p>控制 AI 旋转流光边、画布连线光脉冲与完成扫光动效；关闭后保留静态光学折射。</p>
                  </div>
                  <input
                    className="switch"
                    aria-label="光效动画"
                    type="checkbox"
                    disabled={(draft.glow || 'subtle') === 'off'}
                    checked={draft.motionEffects !== false}
                    onChange={(e) => field('motionEffects', e.target.checked)}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <b>面板布局</b>
                    <p>左右侧栏与时间线均可拖动调整，尺寸自动记忆。</p>
                  </div>
                  <button
                    className="button subtle"
                    onClick={() => {
                      for (const k of ['cc-nav-width', 'cc-agent-width', 'cc-timeline-height'])
                        localStorage.removeItem(k);
                      window.dispatchEvent(new Event('cocraft:reset-layout'));
                      setInfo('面板已恢复默认尺寸。');
                    }}
                  >
                    重置布局
                  </button>
                </div>
              </div>
            </>
          )}
          {tab === 'providers' && (
            <>
              <div className="section-toolbar">
                <span>{draft.providers.filter((p) => p.protocol !== 'system').length} 个连接</span>
                <select
                  aria-label="添加提供商"
                  value=""
                  onChange={(e) => {
                    if (e.target.value !== '') addProvider(Number(e.target.value));
                  }}
                >
                  <option value="">＋ 添加提供商</option>
                  {providerPresets.map((p, i) => (
                    <option key={p.name} value={i}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="connection-list">
                {draft.providers
                  .filter((p) => p.protocol !== 'system')
                  .map((p) => (
                    <button
                      key={p.id}
                      className={providerId === p.id ? 'selected' : ''}
                      onClick={() => {
                        setProviderId(p.id);
                        setInfo('');
                      }}
                    >
                      <span className="provider-monogram">{p.name.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <b>{p.name}</b>
                        <small>{p.baseUrl || '填写接口地址'}</small>
                      </div>
                      <span
                        className={`connection-indicator ${p.hasApiKey || p.apiKey || !p.requiresKey ? 'ready' : ''}`}
                      />
                      <ChevronRight size={14} />
                    </button>
                  ))}
              </div>
              {!provider && (
                <div className="settings-empty">
                  <KeyRound size={24} />
                  <h3>连接你使用的服务</h3>
                  <p>选择提供商，保存连接；然后添加模型并分配用途。</p>
                </div>
              )}
              {provider && (
                <div className="settings-editor">
                  <div className="editor-heading">
                    <h3>连接详情</h3>
                    <button
                      className="icon-button danger"
                      aria-label="删除提供商"
                      disabled={draft.models.some((m) => m.providerId === provider.id)}
                      title="先移除此连接下的模型，再删除连接"
                      onClick={() => {
                        field(
                          'providers',
                          draft.providers.filter((p) => p.id !== providerId),
                        );
                        setProviderId('');
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="settings-fields">
                    <label className="field">
                      <span>名称</span>
                      <input
                        aria-label="提供商名称"
                        value={provider.name}
                        onChange={(e) => updateProvider({ name: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>接口协议</span>
                      <select
                        aria-label="提供商协议"
                        value={provider.protocol}
                        onChange={(e) =>
                          updateProvider({ protocol: e.target.value as ProviderConnection['protocol'] })
                        }
                      >
                        <option value="openai">OpenAI 兼容</option>
                        <option value="dashscope">阿里百炼 / 千问 (DashScope)</option>
                        <option value="ark">火山方舟 (Seedream / Seedance)</option>
                        <option value="minimax">MiniMax 开放平台 (海螺 / H3 / Speech)</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="google">Google Gemini</option>
                      </select>
                    </label>
                    <label className="field full">
                      <span>接口地址</span>
                      <input
                        aria-label="提供商接口地址"
                        placeholder="https://api.example.com/v1"
                        value={provider.baseUrl}
                        onChange={(e) => updateProvider({ baseUrl: e.target.value })}
                      />
                    </label>
                    <label className="field full">
                      <span>
                        API Key <em>{provider.hasApiKey ? '已保存 · 留空保留' : '仅加密保存在本机'}</em>
                      </span>
                      <input
                        aria-label="提供商 API Key"
                        type="password"
                        autoComplete="off"
                        value={provider.apiKey || ''}
                        placeholder={provider.hasApiKey ? '已安全保存' : '输入 API Key'}
                        onChange={(e) => updateProvider({ apiKey: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={!provider.requiresKey}
                      onChange={(e) => updateProvider({ requiresKey: !e.target.checked })}
                    />
                    此连接无需密钥（例如本地模型）
                  </label>
                  <div className="editor-actions">
                    <button className="button" disabled={checking || !provider.baseUrl} onClick={() => void discover(provider)}>
                      {checking ? <Spinner /> : <RefreshCw size={14} />}检测连接 / 获取模型
                    </button>
                    {providerModelSuites[provider.protocol] && (
                      <button
                        type="button"
                        className="button subtle"
                        onClick={() => applyProviderSuite(provider)}
                      >
                        <Boxes size={14} />
                        {providerModelSuites[provider.protocol]!.label}
                      </button>
                    )}
                    <button className="button subtle" onClick={() => addModel()}>
                      <Plus size={14} />
                      手动添加模型
                    </button>
                  </div>
                  {discovered.length > 0 && (
                    <div className="discovery-results">
                      <div className="asset-search">
                        <Search size={14} />
                        <input
                          aria-label="筛选发现的模型"
                          placeholder="筛选模型 ID"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                      </div>
                      {discovered
                        .filter((m) => m.id.toLowerCase().includes(filter.toLowerCase()))
                        .slice(0, 40)
                        .map((m) => (
                          <button key={m.id} onClick={() => addModel(m.id, provider.id)}>
                            <span>{m.id}</span>
                            <Plus size={14} />
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {tab === 'models' && (
            <>
              <div className="section-toolbar">
                <span>{draft.models.length} 个模型</span>
                <div className="skill-toolbar-actions">
                  {(() => {
                    const activeProv =
                      draft.providers.find((p) => p.id === model?.providerId && p.protocol !== 'system') ||
                      draft.providers.find((p) => p.protocol !== 'system');
                    return activeProv ? (
                      <button
                        type="button"
                        className="button subtle"
                        disabled={checking || !activeProv.baseUrl}
                        onClick={() => void discover(activeProv, true)}
                      >
                        {checking ? <Spinner /> : <RefreshCw size={13} />}
                        拉取在线模型
                      </button>
                    ) : null;
                  })()}
                  <button type="button" className="button" onClick={() => addModel()}>
                    <Plus size={14} />
                    手动新增模型
                  </button>
                </div>
              </div>
              <div className="connection-list">
                {draft.models.map((m) => (
                  <button
                    key={m.id}
                    className={modelId === m.id ? 'selected' : ''}
                    onClick={() => {
                      setModelId(m.id);
                      setModelPickerOpen(false);
                    }}
                  >
                    <span className="provider-monogram model">
                      <Boxes size={17} />
                    </span>
                    <div>
                      <b>{m.name}</b>
                      <small>
                        {draft.providers.find((p) => p.id === m.providerId)?.name} · {m.modelId || '待选择或输入模型 ID'}
                      </small>
                    </div>
                    <div className="capability-tags">
                      {m.capabilities.map((c) => (
                        <span key={c}>{modelUses.find((u) => u.id === c)?.name}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
              {model && model.adapter !== 'system-speech' && (() => {
                const activeProv = draft.providers.find((p) => p.id === model.providerId);
                const liveList = activeProv ? discoveredByProvider[activeProv.id] || [] : [];
                const curatedForAdapter = suggestedModelsFor(activeProv?.protocol, model.adapter);
                const curatedAll = suggestedModelsFor(activeProv?.protocol);
                const q = model.modelId.trim().toLowerCase();
                const filteredLive = liveList.filter((x) => !q || x.id.toLowerCase().includes(q));
                const filteredCurated = curatedForAdapter.filter(
                  (x) => !q || x.modelId.toLowerCase().includes(q) || x.name.toLowerCase().includes(q),
                );
                const exactKnown =
                  !q ||
                  liveList.some((x) => x.id.toLowerCase() === q) ||
                  curatedAll.some((x) => x.modelId.toLowerCase() === q);

                return (
                <div className="settings-editor" ref={modelEditorRef}>
                  <div className="editor-heading">
                    <h3>模型详情</h3>
                    <button
                      className="icon-button danger"
                      aria-label="删除模型"
                      onClick={() => {
                        field(
                          'models',
                          draft.models.filter((m) => m.id !== modelId),
                        );
                        setModelId('');
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="settings-fields">
                    <label className="field">
                      <span>显示名称</span>
                      <input
                        aria-label="模型名称"
                        value={model.name}
                        onChange={(e) => updateModel({ name: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>提供商</span>
                      <select
                        aria-label="模型提供商"
                        value={model.providerId}
                        onChange={(e) => {
                          const p = draft.providers.find((v) => v.id === e.target.value);
                          const options = compatibleAdapters(p);
                          const a = options.find((a) => a.id === model.adapter) || options[0];
                          if (a)
                            updateModel({
                              providerId: e.target.value,
                              adapter: a.id,
                              capabilities: a.id === model.adapter ? model.capabilities : a.uses,
                              parameters: a.id === model.adapter ? model.parameters : {},
                            });
                        }}
                      >
                        {draft.providers
                          .filter((p) => p.protocol !== 'system')
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="field full" ref={modelPickerRef}>
                      <div className="model-id-label-row">
                        <span>模型 ID</span>
                        <em>可直接选择推荐/在线模型，或自由输入自定义 ID</em>
                      </div>
                      <div className="model-id-combo">
                        <input
                          aria-label="模型 ID"
                          value={model.modelId}
                          onFocus={() => setModelPickerOpen(true)}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            const shouldSyncName = !model.name.trim() || model.name === '新模型' || model.name === model.modelId;
                            updateModel({
                              modelId: nextId,
                              ...(shouldSyncName && nextId.trim() ? { name: nextId.trim() } : {}),
                            });
                            setModelPickerOpen(true);
                          }}
                          placeholder="点击选择模型，或手动输入 ID（如 qwen-image-3.0-pro / happyhorse-1.1-t2v / doubao-seedance-2-5 / MiniMax-H3）"
                        />
                        <button
                          type="button"
                          className="button subtle model-id-action"
                          aria-label="展开模型选择列表"
                          onClick={() => setModelPickerOpen((v) => !v)}
                        >
                          选择 <ChevronDown size={13} />
                        </button>
                        {activeProv && (
                          <button
                            type="button"
                            className="button subtle model-id-action"
                            aria-label="从服务商拉取可用模型"
                            title={`从「${activeProv.name}」在线拉取可用模型列表`}
                            disabled={checking || !activeProv.baseUrl}
                            onClick={() => void discover(activeProv, true)}
                          >
                            {checking ? <Spinner /> : <RefreshCw size={13} />}
                            拉取列表
                          </button>
                        )}
                      </div>

                      {modelPickerOpen && (
                        <div className="model-picker-popover" role="listbox" aria-label="模型候选列表">
                          {q && !exactKnown && (
                            <div className="model-picker-group">
                              <div className="model-picker-group-head">手动自定义</div>
                              <button
                                type="button"
                                className="model-picker-item custom"
                                onClick={() => applyPickedModelId(model.modelId)}
                              >
                                <Plus size={12} />
                                <span>使用手动输入的模型 ID：「{model.modelId.trim()}」</span>
                              </button>
                            </div>
                          )}

                          {filteredLive.length > 0 && (
                            <div className="model-picker-group">
                              <div className="model-picker-group-head">
                                服务商在线模型 ({filteredLive.length})
                              </div>
                              {filteredLive.slice(0, 36).map((item) => (
                                <button
                                  key={`live-${item.id}`}
                                  type="button"
                                  className={`model-picker-item ${model.modelId === item.id ? 'selected' : ''}`}
                                  onClick={() => applyPickedModelId(item.id)}
                                >
                                  <span className="mono">{item.id}</span>
                                  {model.modelId === item.id && <Check size={12} />}
                                </button>
                              ))}
                            </div>
                          )}

                          {filteredCurated.length > 0 && (
                            <div className="model-picker-group">
                              <div className="model-picker-group-head">
                                推荐常用模型（匹配当前接口）
                              </div>
                              {filteredCurated.map((item) => (
                                <button
                                  key={`cur-${item.modelId}`}
                                  type="button"
                                  className={`model-picker-item ${model.modelId === item.modelId ? 'selected' : ''}`}
                                  onClick={() => applyPickedModelId(item.modelId, item)}
                                >
                                  <div className="model-picker-meta">
                                    <b>{item.name}</b>
                                    <small className="mono">{item.modelId}</small>
                                  </div>
                                  {model.modelId === item.modelId ? <Check size={12} /> : <Plus size={12} />}
                                </button>
                              ))}
                            </div>
                          )}

                          {!filteredLive.length && !filteredCurated.length && (
                            <div className="model-picker-empty">
                              未在预设中找到匹配项，可直接按回车使用手动输入的模型 ID，或点击右侧「拉取列表」查询服务商模型。
                            </div>
                          )}
                        </div>
                      )}

                      {curatedForAdapter.length > 0 && (
                        <div className="model-quick-chips" aria-label="快捷选用常用模型">
                          {curatedForAdapter.slice(0, 8).map((item) => (
                            <button
                              key={item.modelId}
                              type="button"
                              className={`model-quick-chip ${model.modelId === item.modelId ? 'active' : ''}`}
                              title={`点击选用 ${item.name} (${item.modelId})`}
                              onClick={() => applyPickedModelId(item.modelId, item)}
                            >
                              {item.modelId}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <label className="field full">
                      <span>接口适配</span>
                      <select
                        aria-label="模型接口适配"
                        value={model.adapter}
                        onChange={(e) => {
                          const a = adapters.find((a) => a.id === e.target.value)!;
                          updateModel({
                            adapter: a.id,
                            capabilities: a.id === 'chat' ? ['agent'] : a.uses,
                            parameters: {},
                          });
                        }}
                      >
                        {compatibleAdapters(draft.providers.find((p) => p.id === model.providerId)).map(
                          (a) => (
                            <option value={a.id} key={a.id}>
                              {a.name}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  {model.adapter === 'chat' && (
                    <div className="capability-checks">
                      {modelUses
                        .filter((u) => u.id === 'agent' || u.id === 'vision')
                        .map((u) => (
                          <label key={u.id}>
                            <input
                              type="checkbox"
                              checked={model.capabilities.includes(u.id)}
                              onChange={(e) =>
                                updateModel({
                                  capabilities: e.target.checked
                                    ? [...model.capabilities, u.id]
                                    : model.capabilities.filter((c) => c !== u.id),
                                })
                              }
                            />
                            {u.name}
                          </label>
                        ))}
                    </div>
                  )}
                  <p className="help-copy">
                    能力以服务商实际支持为准。对话兼容接口不代表同时支持图片、音频或视频生成。
                  </p>
                  {(model.adapter === 'ark-video' ||
                    model.adapter === 'dashscope-video' ||
                    model.adapter === 'minimax-video') && (
                    <div className="settings-fields">
                      <label className="field">
                        <span>默认分辨率</span>
                        <select
                          value={String(model.parameters.resolution || '')}
                          onChange={(e) =>
                            updateModel({ parameters: { ...model.parameters, resolution: e.target.value } })
                          }
                        >
                          <option value="">模型默认</option>
                          {(model.adapter === 'dashscope-video'
                            ? ['480P', '720P', '1080P']
                            : model.adapter === 'minimax-video'
                              ? ['720P', '768P', '1080P', '2K']
                              : ['480p', '720p', '1080p']
                          ).map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>默认宽高比</span>
                        <select
                          value={String(model.parameters.ratio || model.parameters.aspect_ratio || '')}
                          onChange={(e) => {
                            const key =
                              model.adapter === 'dashscope-video' && /^(wan3\.0|kling\/)/i.test(model.modelId)
                                ? 'aspect_ratio'
                                : 'ratio';
                            updateModel({ parameters: { ...model.parameters, [key]: e.target.value } });
                          }}
                        >
                          <option value="">模型默认</option>
                          {['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  {(model.capabilities.includes('image') || model.capabilities.includes('video')) && (
                    <div className="settings-fields">
                      {model.adapter !== 'ark-video' && model.adapter !== 'minimax-video' && (
                        <label className="field">
                          <span>默认画面尺寸</span>
                          <input
                            placeholder={
                              model.adapter === 'dashscope-image'
                                ? '例如 1280*720 或 2K'
                                : model.adapter === 'ark-image'
                                  ? '例如 2K 或 2048x2048'
                                  : model.capabilities.includes('image')
                                    ? '例如 1024x1024'
                                    : '例如 1280x720'
                            }
                            value={String(model.parameters.size || '')}
                            onChange={(e) =>
                              updateModel({ parameters: { ...model.parameters, size: e.target.value } })
                            }
                          />
                        </label>
                      )}
                      {model.capabilities.includes('video') && (
                        <label className="field">
                          <span>默认时长（秒）</span>
                          <input
                            type="number"
                            min={1}
                            value={String(
                              model.parameters[
                                model.adapter === 'ark-video' ||
                                model.adapter === 'dashscope-video' ||
                                model.adapter === 'minimax-video'
                                  ? 'duration'
                                  : 'seconds'
                              ] || '',
                            )}
                            onChange={(e) =>
                              updateModel({
                                parameters: {
                                  ...model.parameters,
                                  [model.adapter === 'ark-video' ||
                                  model.adapter === 'dashscope-video' ||
                                  model.adapter === 'minimax-video'
                                    ? 'duration'
                                    : 'seconds']: Number(e.target.value) || '',
                                },
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
                  {model.capabilities.includes('speech') && (
                    <label className="field">
                      <span>默认音色 ID</span>
                      <input
                        aria-label="默认音色"
                        value={String(model.parameters.voice || '')}
                        placeholder={
                          model.adapter === 'dashscope-speech'
                            ? `例如 ${DASHSCOPE_VOICES.join(' / ')}`
                            : model.adapter === 'minimax-speech'
                              ? `例如 ${MINIMAX_VOICES.slice(0, 4).join(' / ')}`
                              : '例如 alloy，或提供商的音色 ID'
                        }
                        onChange={(e) =>
                          updateModel({ parameters: { ...model.parameters, voice: e.target.value } })
                        }
                      />
                    </label>
                  )}
                  {model.capabilities.includes('transcription') && (
                    <label className="field">
                      <span>返回格式</span>
                      <select
                        value={String(model.parameters.response_format || 'verbose_json')}
                        onChange={(e) =>
                          updateModel({
                            parameters: { ...model.parameters, response_format: e.target.value },
                          })
                        }
                      >
                        <option value="verbose_json">时间戳 + 文本（模型需支持）</option>
                        <option value="json">文本</option>
                      </select>
                    </label>
                  )}
                </div>
                );
              })()}
              {model?.adapter === 'system-speech' && (
                <div className="settings-editor">
                  <h3>本地语音</h3>
                  <p>使用 macOS 已安装的声音合成配音。</p>
                  <div className="settings-fields">
                    <label className="field">
                      <span>系统音色名称</span>
                      <input
                        value={String(model.parameters.voice || '')}
                        placeholder="自动选择中文声音"
                        onChange={(e) =>
                          updateModel({ parameters: { ...model.parameters, voice: e.target.value } })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>语速（词 / 分钟）</span>
                      <input
                        type="number"
                        min={80}
                        max={400}
                        value={Number(model.parameters.rate || 175)}
                        onChange={(e) =>
                          updateModel({
                            parameters: { ...model.parameters, rate: Number(e.target.value) || 175 },
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === 'defaults' && (
            <>
              <div className="scope-segment" aria-label="默认值范围">
                <button className={scope === 'app' ? 'active' : ''} onClick={() => setScope('app')}>
                  全局默认
                </button>
                <button className={scope === 'project' ? 'active' : ''} onClick={() => setScope('project')}>
                  当前项目
                </button>
              </div>
              <div className="settings-section">
                {modelUses.map((use) => {
                  const choices = draft.models.filter((m) => m.capabilities.includes(use.id));
                  return (
                    <div className="setting-row model-use-row" key={use.id}>
                      <div>
                        <b>{use.name}</b>
                        <p>{use.description}</p>
                      </div>
                      <select
                        aria-label={`${scope === 'project' ? '项目' : '默认'}${use.name}模型`}
                        value={(scope === 'project' ? projectDraft : draft.defaults)[use.id] || ''}
                        onChange={(e) =>
                          scope === 'project'
                            ? setProjectDraft((d) => ({ ...d, [use.id]: e.target.value }))
                            : field('defaults', { ...draft.defaults, [use.id]: e.target.value })
                        }
                      >
                        <option value="">
                          {scope === 'project'
                            ? '继承全局默认'
                            : choices.length
                              ? '未选择'
                              : '先添加可用模型'}
                        </option>
                        {choices.map((m) => (
                          <option value={m.id} key={m.id}>
                            {m.name} · {draft.providers.find((p) => p.id === m.providerId)?.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              <p className="help-copy">
                本次任务选择优先于项目默认，项目默认优先于全局默认。进行中的作业继续使用启动时的模型。
              </p>
            </>
          )}
          {tab === 'system1' && (
            <>
              <div className="s1-banner">
                <b>可选 System 1 智能直觉层（默认完全关闭 · 零强制开销）</b>
                <p>
                  不配置任何模型时，所有核心创作、9:16 画幅重排与素材归类均由本地免费规则内核驱动（￥0）。仅在希望提升多图挑优、视觉锁主体或极速指令分流精度时按需开启。
                </p>
              </div>
              <div className="settings-section">
                <div className="setting-row">
                  <div>
                    <b>运行档位</b>
                    <p>按需选择 0 费用本地模式、复用已配快模型，或接入 TypeSafe Jev 原生毫秒级判定。</p>
                  </div>
                  <div className="segmented-inline" role="group" aria-label="System 1 运行档位">
                    {(
                      [
                        ['off', '关闭 · 本地免费'],
                        ['fast-model', '复用快模型'],
                        ['typesafe-jev', 'TypeSafe Jev'],
                      ] as const
                    ).map(([modeVal, text]) => (
                      <button
                        key={modeVal}
                        type="button"
                        aria-pressed={s1.mode === modeVal}
                        className={s1.mode === modeVal ? 'active' : ''}
                        onClick={() => updateSystem1({ mode: modeVal })}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>

                {s1.mode === 'fast-model' && (
                  <div className="setting-row model-use-row">
                    <div>
                      <b>复用的轻量模型 (Tier 1)</b>
                      <p>优先选择便宜快速的视觉/对话模型（如 qwen-vl-flash / gemini-flash / 本地 Ollama）。</p>
                    </div>
                    <select
                      aria-label="System 1 轻量模型"
                      value={s1.fastModelId || ''}
                      onChange={(e) => updateSystem1({ fastModelId: e.target.value || undefined })}
                    >
                      <option value="">自动沿用默认视觉/主模型</option>
                      {draft.models
                        .filter((m) => m.adapter === 'chat')
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {s1.mode === 'typesafe-jev' && (
                  <div className="settings-fields" style={{ marginTop: 8 }}>
                    <label className="field">
                      <span>TypeSafe Jev 接口地址</span>
                      <input
                        aria-label="TypeSafe Jev 地址"
                        placeholder="https://api.typesafe.ai/v1"
                        value={s1.jevBaseUrl || ''}
                        onChange={(e) => updateSystem1({ jevBaseUrl: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Jev 模型版本</span>
                      <input
                        aria-label="TypeSafe Jev 模型"
                        placeholder="jev-latest"
                        value={s1.jevModelId || 'jev-latest'}
                        onChange={(e) => updateSystem1({ jevModelId: e.target.value })}
                      />
                    </label>
                    <label className="field full">
                      <span>
                        TypeSafe API Key <em>{s1.hasJevApiKey ? '已加密保存 · 留空保留' : '仅加密保存在本机'}</em>
                      </span>
                      <input
                        aria-label="TypeSafe Jev API Key"
                        type="password"
                        autoComplete="off"
                        value={s1.jevApiKey || ''}
                        placeholder={s1.hasJevApiKey ? '已安全保存' : '输入 TypeSafe Jev API Key'}
                        onChange={(e) => updateSystem1({ jevApiKey: e.target.value })}
                      />
                    </label>
                  </div>
                )}

                {s1.mode !== 'off' && (
                  <div className="editor-actions" style={{ marginTop: 8, marginBottom: 4 }}>
                    <button
                      type="button"
                      className="button subtle"
                      disabled={s1Testing}
                      onClick={async () => {
                        setS1Testing(true);
                        setError('');
                        setInfo('');
                        try {
                          await onSave({ system1: s1 });
                          const res = await window.cocraft.call<{ message: string }>('system1.test', {});
                          setInfo(res.message);
                        } catch (err) {
                          setError(String(err).replace(/^Error:\s*/, ''));
                        } finally {
                          setS1Testing(false);
                        }
                      }}
                    >
                      {s1Testing ? <Spinner /> : <Zap size={13} />} 保存并测试连接
                    </button>
                  </div>
                )}
              </div>

              <div className="settings-section">
                <div className="setting-row">
                  <div>
                    <b>智能横转竖锁主体（Box）</b>
                    <p>仅在点击「派生 9:16 竖屏」时按镜头定位人物焦点；关闭时零花费使用上三分构图。</p>
                  </div>
                  <input
                    className="switch"
                    aria-label="智能横转竖锁主体"
                    type="checkbox"
                    disabled={s1.mode === 'off'}
                    checked={s1.mode !== 'off' && s1.features.autoReframeBox}
                    onChange={(e) => updateSystem1({ features: { ...s1.features, autoReframeBox: e.target.checked } })}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <b>批量抽卡质检挑优（Noul + Score）</b>
                    <p>仅在多选候选图并点击「质检挑优」时识别畸变并标星推荐；关闭时用本地免费清晰度评分。</p>
                  </div>
                  <input
                    className="switch"
                    aria-label="批量抽卡质检挑优"
                    type="checkbox"
                    disabled={s1.mode === 'off'}
                    checked={s1.mode !== 'off' && s1.features.batchQualityGate}
                    onChange={(e) =>
                      updateSystem1({ features: { ...s1.features, batchQualityGate: e.target.checked } })
                    }
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <b>指令舱极速本地分流（Choice）</b>
                    <p>简单画布操作直接本地执行、跳过主 Agent，反而减少主模型 Token 消耗。</p>
                  </div>
                  <input
                    className="switch"
                    aria-label="指令舱极速本地分流"
                    type="checkbox"
                    disabled={s1.mode === 'off'}
                    checked={s1.mode !== 'off' && s1.features.omnibarRouter}
                    onChange={(e) => updateSystem1({ features: { ...s1.features, omnibarRouter: e.target.checked } })}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <b>所选素材一键智能标角色（Choice）</b>
                    <p>仅在点击多选栏「智能标角色」按钮时触发，绝不在拖入素材时静默刷 API。</p>
                  </div>
                  <input
                    className="switch"
                    aria-label="所选素材智能标角色"
                    type="checkbox"
                    disabled={s1.mode === 'off'}
                    checked={s1.mode !== 'off' && s1.features.autoTagAssets}
                    onChange={(e) => updateSystem1({ features: { ...s1.features, autoTagAssets: e.target.checked } })}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <b>每月付费调用软上限</b>
                    <p>达到上限后自动静默降级回本地免费内核，杜绝意外扣费（0 表示不限）。</p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={50000}
                    style={{ width: 96 }}
                    aria-label="System 1 每月调用上限"
                    value={s1.monthlyCallCap ?? 500}
                    onChange={(e) => updateSystem1({ monthlyCallCap: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
                {s1Usage && (
                  <div className="setting-row">
                    <div>
                      <b>本月调用统计（{s1Usage.month}）</b>
                      <p>
                        总计 {s1Usage.totalCalls} 次 · 本地免费 {s1Usage.byTier.local} / 快模型{' '}
                        {s1Usage.byTier.fastModel} / Jev {s1Usage.byTier.jev}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="button subtle tiny"
                      onClick={async () => {
                        const fresh = await window.cocraft.call<System1UsageStats>('system1.resetUsage', {});
                        setS1Usage(fresh);
                        setInfo('已重置本月调用统计。');
                      }}
                    >
                      清零计数
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {tab === 'assets' && (
            <div className="settings-section">
              <div className="setting-row">
                <div>
                  <b>Pexels</b>
                  <p>搜索与导入视频，保留作者和来源链接。</p>
                </div>
                <span className={`status-badge ${settings.hasPexelsKey ? 'good' : ''}`}>
                  {settings.hasPexelsKey ? '已保存连接' : '未连接'}
                </span>
              </div>
              <label className="field">
                <span>API Key</span>
                <input
                  aria-label="Pexels API Key"
                  type="password"
                  autoComplete="off"
                  placeholder={settings.hasPexelsKey ? '已安全保存 · 留空保留' : '输入 Pexels API Key'}
                  value={draft.pexelsKey || ''}
                  onChange={(e) => field('pexelsKey', e.target.value)}
                />
              </label>
              <button
                className="text-button"
                onClick={() => window.cocraft.call('link.open', { url: 'https://www.pexels.com/api/' })}
              >
                获取 Pexels API Key ↗
              </button>
            </div>
          )}
          {tab === 'mcp' && (
            <>
              <div className="settings-section">
                <div className="section-toolbar">
                  <span>外部 MCP 服务（供内置 Agent 调用 · 如 Blender / 外部工具）</span>
                  <div className="skill-toolbar-actions">
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() => addMcpServer(MCP_SERVER_PRESETS[0].config)}
                    >
                      <Plus size={13} /> Blender MCP
                    </button>
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() =>
                        addMcpServer({
                          name: `MCP 服务 ${mcpServers.length + 1}`,
                          enabled: true,
                          transport: 'stdio',
                          command: 'npx',
                          args: ['-y', ''],
                        })
                      }
                    >
                      <Plus size={13} /> 新建服务
                    </button>
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() => {
                        setMcpJsonOpen((v) => !v);
                        setError('');
                      }}
                    >
                      <FileCode2 size={13} /> 粘贴 JSON
                    </button>
                  </div>
                </div>

                {mcpJsonOpen && (
                  <div className="mcp-json-import-box">
                    <textarea
                      rows={5}
                      aria-label="粘贴标准 mcpServers JSON"
                      placeholder={'粘贴 Claude Desktop / Cursor 格式的 mcpServers JSON，例如：\n{\n  "mcpServers": {\n    "blender": { "command": "uvx", "args": ["blender-mcp"] }\n  }\n}'}
                      value={mcpJsonDraft}
                      onChange={(e) => setMcpJsonDraft(e.target.value)}
                    />
                    <div className="mcp-json-import-actions">
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => {
                          setError('');
                          try {
                            const imported = parseMcpServersJson(mcpJsonDraft);
                            field('mcpServers', [...mcpServers, ...imported]);
                            setSelectedMcpId(imported[0].id);
                            setMcpJsonDraft('');
                            setMcpJsonOpen(false);
                            setInfo(`已解析并加入 ${imported.length} 个外部 MCP 服务，请点击「保存设置」生效。`);
                          } catch (e) {
                            setError(String(e).replace(/^Error: /, ''));
                          }
                        }}
                      >
                        解析并添加
                      </button>
                      <button type="button" className="button subtle" onClick={() => setMcpJsonOpen(false)}>
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {mcpServers.length === 0 ? (
                  <div className="mcp-empty-presets">
                    <p className="help-copy">
                      尚未配置外部 MCP 服务。一键添加常用预设，或点击上方「粘贴 JSON」导入已有配置：
                    </p>
                    <div className="mcp-preset-grid">
                      {MCP_SERVER_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="mcp-preset-card"
                          onClick={() => addMcpServer(preset.config)}
                        >
                          <b>{preset.label}</b>
                          <small>{preset.description}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mcp-server-list">
                    {mcpServers.map((srv) => {
                      const st = mcpStatuses.find((x) => x.id === srv.id);
                      const toolCount = (mcpToolsByServer[srv.id] || st?.tools || []).length;
                      const isSel = activeMcpServer?.id === srv.id;
                      return (
                        <div
                          key={srv.id}
                          className={`skill-row interactive ${isSel ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedMcpId(srv.id);
                            setMcpEnvText('');
                            setMcpHeadersText('');
                          }}
                        >
                          <Cable size={15} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="skill-row-head">
                              <b>{srv.name}</b>
                              <span className="skill-scope-badge project">
                                {srv.transport === 'http' ? 'HTTP/SSE' : 'stdio'}
                              </span>
                              {st?.connected ? (
                                <span className="status-badge good">已连接 · {toolCount} 工具</span>
                              ) : st?.error ? (
                                <span className="status-badge warn" title={st.error}>
                                  连接异常
                                </span>
                              ) : toolCount > 0 ? (
                                <span className="status-badge">{toolCount} 工具</span>
                              ) : null}
                            </div>
                            <p>
                              {srv.transport === 'http'
                                ? srv.url || '未填写 URL'
                                : [srv.command, ...(srv.args || [])].filter(Boolean).join(' ') || '未填写命令'}
                            </p>
                          </div>
                          <input
                            className="switch"
                            aria-label={`启用 MCP 服务 ${srv.name}`}
                            type="checkbox"
                            checked={srv.enabled}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateMcpServer(srv.id, { enabled: e.target.checked })}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {activeMcpServer && (
                <div className="settings-editor">
                  <div className="editor-heading">
                    <h3>配置 · {activeMcpServer.name}</h3>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="button subtle"
                        disabled={mcpTestingId === activeMcpServer.id}
                        onClick={() =>
                          void (async () => {
                            setMcpTestingId(activeMcpServer.id);
                            setError('');
                            setInfo('');
                            try {
                              const res = await window.cocraft.call<{
                                ok: boolean;
                                tools: McpRemoteToolInfo[];
                                error?: string;
                              }>('mcp.client.test', { server: activeMcpServer });
                              if (!res.ok) {
                                setError(res.error || '连接测试失败');
                              } else {
                                setMcpToolsByServer((prev) => ({
                                  ...prev,
                                  [activeMcpServer.id]: res.tools,
                                }));
                                setInfo(
                                  `已连接「${activeMcpServer.name}」，发现 ${res.tools.length} 个可用工具（记得点击「保存设置」持久化）。`,
                                );
                              }
                            } catch (e) {
                              setError(String(e).replace(/^Error:.*?Error: /, ''));
                            } finally {
                              setMcpTestingId('');
                            }
                          })()
                        }
                      >
                        {mcpTestingId === activeMcpServer.id ? <Spinner /> : <RefreshCw size={13} />}
                        测试连接并拉取工具
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label="删除此 MCP 服务"
                        onClick={() => removeMcpServer(activeMcpServer.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="settings-fields">
                    <label className="field">
                      <span>服务名称（兼作工具命名空间）</span>
                      <input
                        aria-label="MCP 服务名称"
                        value={activeMcpServer.name}
                        placeholder="如 Blender"
                        onChange={(e) => updateMcpServer(activeMcpServer.id, { name: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>传输协议</span>
                      <select
                        aria-label="MCP 传输协议"
                        value={activeMcpServer.transport}
                        onChange={(e) =>
                          updateMcpServer(activeMcpServer.id, {
                            transport: e.target.value === 'http' ? 'http' : 'stdio',
                          })
                        }
                      >
                        <option value="stdio">本地命令 (stdio · 如 uvx / npx)</option>
                        <option value="http">远程或本地 HTTP / SSE</option>
                      </select>
                    </label>
                    {activeMcpServer.transport === 'stdio' ? (
                      <>
                        <label className="field">
                          <span>启动命令 (command)</span>
                          <input
                            aria-label="MCP 启动命令"
                            value={activeMcpServer.command || ''}
                            placeholder="如 uvx / npx / node / python3"
                            onChange={(e) => updateMcpServer(activeMcpServer.id, { command: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span>参数列表 (args，空格分隔)</span>
                          <input
                            aria-label="MCP 参数列表"
                            value={(activeMcpServer.args || []).join(' ')}
                            placeholder="如 blender-mcp"
                            onChange={(e) =>
                              updateMcpServer(activeMcpServer.id, {
                                args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : [],
                              })
                            }
                          />
                        </label>
                        <label className="field full">
                          <span>工作目录 cwd（可选）</span>
                          <input
                            aria-label="MCP 工作目录"
                            value={activeMcpServer.cwd || ''}
                            placeholder="留空默认使用用户主目录"
                            onChange={(e) => updateMcpServer(activeMcpServer.id, { cwd: e.target.value || undefined })}
                          />
                        </label>
                        <label className="field full">
                          <span>
                            环境变量（每行 KEY=VALUE，通过系统 safeStorage 加密保存
                            {activeMcpServer.envKeys?.length
                              ? ` · 已存 ${activeMcpServer.envKeys.join(', ')}，留空保留`
                              : ''}
                            ）
                          </span>
                          <textarea
                            rows={2}
                            aria-label="MCP 环境变量"
                            placeholder="BLENDER_HOST=localhost&#10;BLENDER_PORT=9876"
                            value={mcpEnvText}
                            onChange={(e) => {
                              const rawText = e.target.value;
                              setMcpEnvText(rawText);
                              const map: Record<string, string> = {};
                              for (const line of rawText.split(/\r?\n/)) {
                                const eq = line.indexOf('=');
                                if (eq > 0) {
                                  const k = line.slice(0, eq).trim();
                                  const v = line.slice(eq + 1).trim();
                                  if (k) map[k] = v;
                                }
                              }
                              updateMcpServer(activeMcpServer.id, {
                                env: rawText.trim() ? map : undefined,
                              });
                            }}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="field full">
                          <span>MCP 服务 URL (Streamable HTTP / SSE)</span>
                          <input
                            aria-label="MCP HTTP 地址"
                            value={activeMcpServer.url || ''}
                            placeholder="http://127.0.0.1:8000/mcp"
                            onChange={(e) => updateMcpServer(activeMcpServer.id, { url: e.target.value })}
                          />
                        </label>
                        <label className="field full">
                          <span>
                            请求头 Headers（每行 Key: Value，加密保存
                            {activeMcpServer.headerKeys?.length
                              ? ` · 已存 ${activeMcpServer.headerKeys.join(', ')}，留空保留`
                              : ''}
                            ）
                          </span>
                          <textarea
                            rows={2}
                            aria-label="MCP HTTP Headers"
                            placeholder="Authorization: Bearer sk-..."
                            value={mcpHeadersText}
                            onChange={(e) => {
                              const rawText = e.target.value;
                              setMcpHeadersText(rawText);
                              const map: Record<string, string> = {};
                              for (const line of rawText.split(/\r?\n/)) {
                                const sep = line.indexOf(':');
                                if (sep > 0) {
                                  const k = line.slice(0, sep).trim();
                                  const v = line.slice(sep + 1).trim();
                                  if (k) map[k] = v;
                                }
                              }
                              updateMcpServer(activeMcpServer.id, {
                                headers: rawText.trim() ? map : undefined,
                              });
                            }}
                          />
                        </label>
                      </>
                    )}
                  </div>

                  {(() => {
                    const discoveredTools =
                      mcpToolsByServer[activeMcpServer.id] ||
                      mcpStatuses.find((x) => x.id === activeMcpServer.id)?.tools ||
                      [];
                    if (!discoveredTools.length) return null;
                    const disabledSet = new Set(activeMcpServer.disabledTools || []);
                    return (
                      <div className="mcp-tools-list">
                        <div className="mcp-tools-head">
                          <b>已发现工具（{discoveredTools.length - disabledSet.size}/{discoveredTools.length} 启用）</b>
                          <small>勾选要注入内置 Agent 的工具，避免冗余工具占用上下文</small>
                        </div>
                        <div className="mcp-tools-grid">
                          {discoveredTools.map((tool) => {
                            const checked = !disabledSet.has(tool.name);
                            return (
                              <label key={tool.qualifiedName} className="mcp-tool-item" title={tool.description}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const nextDisabled = new Set(activeMcpServer.disabledTools || []);
                                    if (e.target.checked) nextDisabled.delete(tool.name);
                                    else nextDisabled.add(tool.name);
                                    updateMcpServer(activeMcpServer.id, {
                                      disabledTools: Array.from(nextDisabled),
                                    });
                                  }}
                                />
                                <div>
                                  <code>{tool.name}</code>
                                  {tool.description && <small>{tool.description.slice(0, 72)}</small>}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="settings-section">
                <h3>对外提供 CoCraft 本地 MCP 服务（供 Claude / Cursor 操控 CoCraft）</h3>
                <div className="setting-row">
                  <div>
                    <b>启用本地 MCP 桥接服务</b>
                    <p>允许 Claude / Cursor / Antigravity 等外部 MCP 客户端通过受控协议操作当前工程并调用已配置模型（仅监听 127.0.0.1，0600 令牌鉴权，绝不暴露 API 密钥）。</p>
                  </div>
                  <input
                    className="switch"
                    aria-label="启用本地 MCP 桥接服务"
                    type="checkbox"
                    checked={Boolean(draft.mcpBridgeEnabled)}
                    onChange={(e) => field('mcpBridgeEnabled', e.target.checked)}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <b>运行状态与客户端配置</b>
                    <p>
                      {mcpInfo?.running && mcpInfo.port
                        ? `监听 127.0.0.1:${mcpInfo.port} · 可直接接入任意 MCP 客户端`
                        : draft.mcpBridgeEnabled
                          ? '点击右下角「保存设置」后立即启动本地 MCP 桥接服务'
                          : '默认关闭，按需开启'}
                    </p>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span className={`status-badge ${mcpInfo?.running ? 'good' : ''}`}>
                      {mcpInfo?.running ? '运行中' : '未启用'}
                    </span>
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() =>
                        void window.cocraft.call('mcp.copyConfig', {}).then(() => {
                          setMcpCopied(true);
                          setTimeout(() => setMcpCopied(false), 2000);
                        })
                      }
                    >
                      {mcpCopied ? '已复制配置' : '复制 MCP 配置'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
          {tab === 'skills' && (
            <>
              <div className="settings-section">
                <div className="section-toolbar">
                  <span>{skills.length} 个可用 Skill（对话中输入 / 可按需激活）</span>
                  <div className="skill-toolbar-actions">
                    <select
                      className="skill-scope-select"
                      aria-label="导入目标范围"
                      value={skillImportScope}
                      onChange={(e) => setSkillImportScope(e.target.value === 'user' ? 'user' : 'project')}
                    >
                      <option value="project">当前项目</option>
                      <option value="user">全局共享</option>
                    </select>
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() => {
                        setError('');
                        setInfo('');
                        setSkillEditor({
                          mode: 'new',
                          scope: skillImportScope,
                          slug: 'custom-editing-guide',
                          description: '描述何时激活及此 Skill 负责的创作规范',
                          body: '# 创作规范\n\n1. 说明目标成片的节奏、镜头语言与组件要求。\n2. 约定文字、字幕或配音的处理规则。\n',
                        });
                      }}
                    >
                      <Plus size={14} />
                      新建
                    </button>
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() =>
                        void (async () => {
                          setError('');
                          try {
                            const updated = await window.cocraft.call<SkillInfo[] | null>('skills.import', {
                              scope: skillImportScope,
                              kind: 'file',
                            });
                            if (updated) {
                              onRefreshSkills?.(updated);
                              setInfo(
                                `已导入 SKILL.md 至${skillImportScope === 'user' ? '全局共享目录' : '当前项目目录'}。`,
                              );
                            }
                          } catch (e) {
                            setError(String(e).replace(/^Error:.*?Error: /, ''));
                          }
                        })()
                      }
                    >
                      <ArrowDownToLine size={14} />
                      导入文件
                    </button>
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() =>
                        void (async () => {
                          setError('');
                          try {
                            const updated = await window.cocraft.call<SkillInfo[] | null>('skills.import', {
                              scope: skillImportScope,
                              kind: 'folder',
                            });
                            if (updated) {
                              onRefreshSkills?.(updated);
                              setInfo(
                                `已整包导入 Skill 目录至${skillImportScope === 'user' ? '全局共享目录' : '当前项目目录'}。`,
                              );
                            }
                          } catch (e) {
                            setError(String(e).replace(/^Error:.*?Error: /, ''));
                          }
                        })()
                      }
                    >
                      <FolderOpen size={14} />
                      导入目录
                    </button>
                    <button
                      type="button"
                      className="button subtle"
                      title={skillImportScope === 'user' ? '打开全局 Skills 目录' : '打开当前项目 Skills 目录'}
                      onClick={() => void window.cocraft.call('skills.open', { scope: skillImportScope })}
                    >
                      目录
                    </button>
                  </div>
                </div>
                {skills.map((s) => {
                  const scopeLabel = s.scope === 'project' ? '项目' : s.scope === 'user' ? '全局' : '内置';
                  const isPinned = s.name === 'cocraft-editing' || activeSkillIds.includes(s.name);
                  const isSelected = selectedSkillKey === s.name;
                  return (
                    <div
                      className={`skill-row interactive ${isSelected ? 'selected' : ''}`}
                      key={s.name}
                      onClick={() => {
                        setSelectedSkillKey(s.name);
                        if (s.scope !== 'builtin') {
                          setSkillEditor({
                            mode: 'edit',
                            scope: s.scope,
                            slug: s.name,
                            description: s.description,
                            body: s.body || '',
                          });
                        } else {
                          setSkillEditor(null);
                        }
                      }}
                    >
                      <Code2 size={16} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="skill-row-head">
                          <b>{friendlySkillTitle(s.name)}</b>
                          <span className={`skill-scope-badge ${s.scope}`}>{scopeLabel}</span>
                          <small className="skill-slug-tag">{s.name}</small>
                        </div>
                        <p>{s.description}</p>
                      </div>
                      {onToggleProjectSkill && (
                        <label
                          className="skill-pin-toggle"
                          title={
                            s.name === 'cocraft-editing'
                              ? '核心基础规范默认常驻'
                              : '开启后每次对话自动载入此规范'
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span>常驻</span>
                          <input
                            className="switch"
                            aria-label={`常驻启用 ${friendlySkillTitle(s.name)}`}
                            type="checkbox"
                            disabled={s.name === 'cocraft-editing'}
                            checked={isPinned}
                            onChange={(e) => void onToggleProjectSkill(s.name, e.target.checked)}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
              {skillEditor ? (
                <div className="settings-editor">
                  <div className="editor-heading">
                    <h3>{skillEditor.mode === 'new' ? '新建自定义 Skill' : `编辑 ${skillEditor.slug}`}</h3>
                    {skillEditor.mode === 'edit' && (
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label="删除自定义 Skill"
                        disabled={skillBusy}
                        onClick={() =>
                          void (async () => {
                            setSkillBusy(true);
                            setError('');
                            try {
                              const next = await window.cocraft.call<SkillInfo[]>('skills.delete', {
                                scope: skillEditor.scope,
                                name: skillEditor.slug,
                              });
                              onRefreshSkills?.(next);
                              setSkillEditor(null);
                              setInfo(`已移除「${skillEditor.slug}」。`);
                            } catch (e) {
                              setError(String(e).replace(/^Error:.*?Error: /, ''));
                            } finally {
                              setSkillBusy(false);
                            }
                          })()
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="settings-fields">
                    <label className="field">
                      <span>Skill 标识 (slug)</span>
                      <input
                        aria-label="Skill 标识"
                        disabled={skillEditor.mode === 'edit'}
                        value={skillEditor.slug}
                        placeholder="例如 my-story-guide"
                        onChange={(e) => setSkillEditor((v) => v && { ...v, slug: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>保存范围</span>
                      <select
                        aria-label="Skill 保存范围"
                        disabled={skillEditor.mode === 'edit'}
                        value={skillEditor.scope}
                        onChange={(e) =>
                          setSkillEditor((v) => v && { ...v, scope: e.target.value as 'project' | 'user' })
                        }
                      >
                        <option value="project">当前项目 (skills/)</option>
                        <option value="user">个人全局 (所有项目共享)</option>
                      </select>
                    </label>
                    <label className="field full">
                      <span>一句话简介 (用于 / 唤起提示)</span>
                      <input
                        aria-label="Skill 描述"
                        value={skillEditor.description}
                        onChange={(e) => setSkillEditor((v) => v && { ...v, description: e.target.value })}
                      />
                    </label>
                    <label className="field full">
                      <span>SKILL.md 正文指南</span>
                      <textarea
                        aria-label="Skill 正文"
                        rows={7}
                        className="skill-body-textarea"
                        value={skillEditor.body}
                        onChange={(e) => setSkillEditor((v) => v && { ...v, body: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="editor-actions">
                    <button
                      type="button"
                      className="button primary"
                      disabled={skillBusy}
                      onClick={() =>
                        void (async () => {
                          setSkillBusy(true);
                          setError('');
                          try {
                            const next = await window.cocraft.call<SkillInfo[]>('skills.save', {
                              scope: skillEditor.scope,
                              slug: skillEditor.slug,
                              description: skillEditor.description,
                              body: skillEditor.body,
                            });
                            onRefreshSkills?.(next);
                            setSelectedSkillKey(skillEditor.slug.trim().toLowerCase());
                            setSkillEditor((v) => v && { ...v, mode: 'edit' });
                            setInfo(`已保存 Skill「${skillEditor.slug}」，下次 Agent 运行生效。`);
                          } catch (e) {
                            setError(String(e).replace(/^Error:.*?Error: /, ''));
                          } finally {
                            setSkillBusy(false);
                          }
                        })()
                      }
                    >
                      {skillBusy ? <Spinner /> : <Check size={14} />}
                      保存 Skill
                    </button>
                    <button type="button" className="button subtle" onClick={() => setSkillEditor(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                (() => {
                  const activeSkill = skills.find((s) => s.name === selectedSkillKey) || skills[0];
                  if (!activeSkill) return null;
                  return (
                    <div className="settings-editor">
                      <div className="editor-heading">
                        <h3>{friendlySkillTitle(activeSkill.name)}</h3>
                        <button
                          type="button"
                          className="button subtle"
                          onClick={() =>
                            setSkillEditor({
                              mode: 'new',
                              scope: 'project',
                              slug: activeSkill.name,
                              description: activeSkill.description,
                              body: activeSkill.body || '',
                            })
                          }
                        >
                          派生到当前项目并自定义
                        </button>
                      </div>
                      <p className="help-copy">{activeSkill.path}</p>
                      {activeSkill.body && <pre className="skill-body-preview">{activeSkill.body}</pre>}
                    </div>
                  );
                })()
              )}
              <div className="settings-section">
                <div className="setting-row">
                  <div>
                    <b>运行项目脚本</b>
                    <p>允许 FFmpeg、Python 和 npm 等工具在任务工作区运行。</p>
                  </div>
                  <input
                    className="switch"
                    aria-label="允许项目脚本"
                    type="checkbox"
                    checked={draft.allowShell}
                    onChange={(e) => field('allowShell', e.target.checked)}
                  />
                </div>
                <div className="setting-row">
                  <div>
                    <b>项目脚本联网</b>
                    <p>用于安装依赖或连接外部服务。</p>
                  </div>
                  <input
                    className="switch"
                    aria-label="允许脚本联网"
                    type="checkbox"
                    disabled={!draft.allowShell}
                    checked={draft.allowNetwork}
                    onChange={(e) => field('allowNetwork', e.target.checked)}
                  />
                </div>
              </div>
            </>
          )}
          {info && (
            <p className="settings-notice" role="status">
              {info}
            </p>
          )}
        </section>
      </div>
      <footer className="settings-footer">
        <span className={error ? 'error-copy' : 'help-copy'} role={error ? 'alert' : undefined}>
          {error || '密钥加密保存于本机。修改保存后生效。'}
        </span>
        <button className="button primary" disabled={saving} onClick={save}>
          {saving ? <Spinner /> : <Check size={14} />}保存设置
        </button>
      </footer>
    </Modal>
  );
}
