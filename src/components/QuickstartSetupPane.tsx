import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { modelUses } from '../core/models';
import {
  QUICKSTART_PROFILES,
  applyQuickstartProfile,
  findMatchingProvider,
  type QuickstartProfileId,
} from '../core/quickstart';
import type { ModelUse, Settings } from '../core/types';
import { Spinner } from './ui';

interface QuickstartSetupPaneProps {
  settings: Settings;
  onApplyAndSave: (nextSettings: Settings) => Promise<void>;
  onJumpToAdvanced: (tab: 'providers' | 'models' | 'defaults') => void;
  onFinishAndClose: () => void;
}

export function QuickstartSetupPane({
  settings,
  onApplyAndSave,
  onJumpToAdvanced,
  onFinishAndClose,
}: QuickstartSetupPaneProps) {
  const [profileId, setProfileId] = useState<QuickstartProfileId>('dashscope');
  const profile = useMemo(
    () => QUICKSTART_PROFILES.find((p) => p.id === profileId) || QUICKSTART_PROFILES[0],
    [profileId],
  );
  const matchedProvider = useMemo(
    () => findMatchingProvider(settings, profile),
    [settings, profile],
  );

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(profile.defaultBaseUrl);
  const [customModelId, setCustomModelId] = useState('qwen2.5:14b');
  const [showAdvancedUrl, setShowAdvancedUrl] = useState(false);
  const [overwriteDefaults, setOverwriteDefaults] = useState(true);
  const [busy, setBusy] = useState<'idle' | 'testing' | 'saving'>('idle');
  const [status, setStatus] = useState<
    | null
    | {
        kind: 'verified' | 'saved-only' | 'error';
        title: string;
        detail: string;
        assignedUses?: ModelUse[];
      }
  >(null);

  const selectProfile = (nextId: QuickstartProfileId) => {
    const nextProf = QUICKSTART_PROFILES.find((p) => p.id === nextId) || QUICKSTART_PROFILES[0];
    const existing = findMatchingProvider(settings, nextProf);
    setProfileId(nextId);
    setApiKey('');
    setBaseUrl(existing?.baseUrl || nextProf.defaultBaseUrl);
    setShowAdvancedUrl(false);
    setStatus(null);
  };

  const useLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const u of modelUses) map[u.id] = u.name;
    return map;
  }, []);

  const runSetup = async (verifyOnline: boolean) => {
    setStatus(null);
    let built;
    try {
      built = applyQuickstartProfile(settings, {
        profileId,
        apiKey,
        baseUrl,
        customModelId: profile.editableModelId ? customModelId : undefined,
        overwriteDefaults,
      });
    } catch (e) {
      setStatus({
        kind: 'error',
        title: '配置项未补全',
        detail: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (verifyOnline) {
      setBusy('testing');
      try {
        const probe = await window.cocraft.call<{ models: { id: string; name: string }[]; message: string }>(
          'providers.inspect',
          { provider: built.provider },
        );
        setBusy('saving');
        await onApplyAndSave(built.nextSettings);
        setApiKey('');
        setStatus({
          kind: 'verified',
          title: `已真实连通「${profile.name}」并完成全链路保存`,
          detail: `${probe.message || '接口鉴权与连接校验通过'} · 新增 ${built.addedModelCount} 个模型，已就绪可直接创作。`,
          assignedUses: built.assignedUses,
        });
      } catch (e) {
        const msg = String(e).replace(/^Error:.*?Error: /, '').replace(/^Error:\s*/, '');
        setStatus({
          kind: 'error',
          title: '在线连通验证未通过（尚未保存）',
          detail: `${msg}。请核对 API Key、网络代理或接口地址；若该自建网关禁用了列表探针，可点击下方「跳过验证仅保存」。`,
        });
      } finally {
        setBusy('idle');
      }
      return;
    }

    setBusy('saving');
    try {
      await onApplyAndSave(built.nextSettings);
      setApiKey('');
      setStatus({
        kind: 'saved-only',
        title: `已保存「${profile.name}」本地配置（未验证在线连通）`,
        detail: `已写入 ${built.addedModelCount} 个推荐模型并更新用途默认路由；首次调用时将真实请求云端服务。`,
        assignedUses: built.assignedUses,
      });
    } catch (e) {
      setStatus({
        kind: 'error',
        title: '保存失败',
        detail: String(e).replace(/^Error:.*?Error: /, '').replace(/^Error:\s*/, ''),
      });
    } finally {
      setBusy('idle');
    }
  };

  const hasSavedKey = Boolean(matchedProvider?.hasApiKey);

  return (
    <div className="qs-pane">
      <div className="qs-step">
        <div className="qs-step-head">
          <span className="qs-step-num">1</span>
          <div>
            <h3>选择一家主力模型生态</h3>
            <p>单选一家即可一次性自动写入推荐模型并配齐用途默认路由，后续随时可在左侧精细增删。</p>
          </div>
        </div>
        <div className="qs-profile-grid" role="radiogroup" aria-label="快速配置厂商方案">
          {QUICKSTART_PROFILES.map((item) => {
            const active = item.id === profileId;
            const existing = findMatchingProvider(settings, item);
            const isConnected = Boolean(existing && (existing.hasApiKey || !existing.requiresKey));
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`qs-profile-card ${active ? 'active' : ''}`}
                onClick={() => selectProfile(item.id)}
              >
                <div className="qs-profile-top">
                  <b>{item.name}</b>
                  <span className={`qs-profile-badge ${isConnected ? 'connected' : ''}`}>
                    {isConnected ? '已配置' : item.badge}
                  </span>
                </div>
                <p>{item.tagline}</p>
                <div className="qs-cap-row">
                  {item.capabilitiesSummary.map((cap) => (
                    <span key={cap} className="qs-cap-chip">
                      {cap}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="qs-step">
        <div className="qs-step-head">
          <span className="qs-step-num">2</span>
          <div>
            <h3>填写凭据并确认写入内容</h3>
            <p>{profile.keyHint}</p>
          </div>
        </div>

        <div className="qs-form-box">
          {profile.requiresKey ? (
            <label className="field full">
              <span>
                <KeyRound size={12} style={{ marginRight: 5, verticalAlign: -1 }} />
                {profile.name} API Key{' '}
                <em>{hasSavedKey ? '本机已加密保存 · 留空将沿用已有密钥' : '仅使用 macOS safeStorage 加密保存在本机'}</em>
              </span>
              <input
                aria-label="快速配置 API Key"
                type="password"
                autoComplete="off"
                placeholder={hasSavedKey ? '已安全保存（输入新 Key 将覆盖）' : profile.keyPlaceholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          ) : (
            <label className="field full">
              <span>本地模型 ID（Ollama / LM Studio 已拉取的模型名）</span>
              <input
                aria-label="本地模型 ID"
                placeholder="例如：qwen2.5:14b 或 llama3.2"
                value={customModelId}
                onChange={(e) => setCustomModelId(e.target.value)}
              />
            </label>
          )}

          <div className="qs-form-row-inline">
            <button
              type="button"
              className="qs-collapse-toggle"
              onClick={() => setShowAdvancedUrl((v) => !v)}
            >
              {showAdvancedUrl ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              接口地址：{baseUrl}
            </button>
            <label className="inline-check qs-overwrite-check">
              <input
                type="checkbox"
                checked={overwriteDefaults}
                onChange={(e) => setOverwriteDefaults(e.target.checked)}
              />
              设为对应用途全局默认
            </label>
          </div>

          {showAdvancedUrl && (
            <label className="field full">
              <span>自定义接口地址（Base URL）</span>
              <input
                aria-label="快速配置接口地址"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={profile.defaultBaseUrl}
              />
            </label>
          )}

          <div className="qs-preview-summary">
            <span className="qs-preview-label">将自动配齐 {profile.models.length} 个模型：</span>
            <div className="qs-preview-tags">
              {Object.entries(profile.defaultRoles).map(([use, mId]) => (
                <span key={use} className="qs-route-pill">
                  <b>{useLabelMap[use] || use}</b> → {profile.editableModelId ? customModelId || mId : mId}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="qs-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy !== 'idle'}
          onClick={() => void runSetup(true)}
        >
          {busy === 'testing' ? (
            <>
              <Spinner /> 正在实测在线连通…
            </>
          ) : busy === 'saving' ? (
            <>
              <Spinner /> 正在保存配置…
            </>
          ) : (
            <>
              <ShieldCheck size={14} /> 验证连通并一键配齐
            </>
          )}
        </button>
        <button
          type="button"
          className="button subtle"
          disabled={busy !== 'idle'}
          onClick={() => void runSetup(false)}
        >
          <RefreshCw size={13} /> 跳过验证仅保存
        </button>
        <div className="qs-actions-spacer" />
        <button
          type="button"
          className="button subtle"
          onClick={() => onJumpToAdvanced('providers')}
        >
          <SlidersHorizontal size={13} /> 高级逐项配置
        </button>
      </div>

      {status && (
        <div className={`qs-status-card ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
          <div className="qs-status-head">
            {status.kind === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
            <b>{status.title}</b>
          </div>
          <p>{status.detail}</p>
          {status.assignedUses && status.assignedUses.length > 0 && (
            <div className="qs-status-uses">
              {status.assignedUses.map((u) => (
                <span key={u}>
                  <Check size={11} /> {useLabelMap[u] || u}
                </span>
              ))}
            </div>
          )}
          {status.kind !== 'error' && (
            <div className="qs-status-foot">
              <button type="button" className="button tiny primary" onClick={onFinishAndClose}>
                立即回到画布开始创作 <ArrowRight size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
