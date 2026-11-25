import { nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJSON, readJSON } from './store';
import type { SettingsStore } from './settings';
import { chatEndpoint } from './generation';
import {
  boxToNormalizedFocal,
  classifyAssetRoleLocally,
  routeOmnibarLocally,
  type OmnibarLocalIntent,
} from '../src/core/system1Rules';
import type {
  Asset,
  AssetQualityScore,
  AssetRole,
  System1Settings,
  System1UsageStats,
} from '../src/core/types';

export { boxToNormalizedFocal, classifyAssetRoleLocally, routeOmnibarLocally, type OmnibarLocalIntent };

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function emptyUsage(month = currentMonthKey()): System1UsageStats {
  return {
    month,
    totalCalls: 0,
    byTier: { local: 0, fastModel: 0, jev: 0 },
    byFeature: { reframeBox: 0, qualityGate: 0, omnibarRouter: 0, autoTag: 0 },
  };
}

function encodeThumbDataUri(filePath: string): { dataUri: string; width: number; height: number } | null {
  if (!filePath || !existsSync(filePath)) return null;
  const img = nativeImage.createFromPath(filePath);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const maxSide = 768;
  const resized =
    Math.max(width, height) > maxSide
      ? img.resize(width >= height ? { width: maxSide } : { height: maxSide })
      : img;
  const jpeg = resized.toJPEG(82);
  return {
    dataUri: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    width,
    height,
  };
}

/**
 * Strictly optional, default-OFF 3-Tier System 1 decision engine:
 * - Tier 0 ('off'): Local deterministic rules & FFmpeg ($0, 0ms)
 * - Tier 1 ('fast-model'): Reuses user's existing configured fast chat/VL model
 * - Tier 2 ('typesafe-jev'): Native TypeSafe Jev POST /v1/systemone (`choice / score / noul / box`)
 *
 * Cost Guardrails:
 * 1) Never fires unless `mode !== 'off'` AND the matching per-feature toggle is explicitly ON.
 * 2) Tracks monthly usage transparently and enforces soft `monthlyCallCap`.
 * 3) Any failure/timeout gracefully degrades to Tier 0 so creation is never blocked.
 */
export class System1Service {
  private usagePath: string;
  constructor(
    private settings: SettingsStore,
    userDataRoot: string,
  ) {
    this.usagePath = join(userDataRoot, 'system1-usage.json');
  }

  async getUsage(): Promise<System1UsageStats> {
    const month = currentMonthKey();
    const raw = await readJSON<System1UsageStats>(this.usagePath, emptyUsage(month));
    if (!raw || raw.month !== month) return emptyUsage(month);
    return {
      month,
      totalCalls: Number(raw.totalCalls || 0),
      byTier: {
        local: Number(raw.byTier?.local || 0),
        fastModel: Number(raw.byTier?.fastModel || 0),
        jev: Number(raw.byTier?.jev || 0),
      },
      byFeature: {
        reframeBox: Number(raw.byFeature?.reframeBox || 0),
        qualityGate: Number(raw.byFeature?.qualityGate || 0),
        omnibarRouter: Number(raw.byFeature?.omnibarRouter || 0),
        autoTag: Number(raw.byFeature?.autoTag || 0),
      },
    };
  }

  async resetUsage(): Promise<System1UsageStats> {
    const fresh = emptyUsage();
    await atomicJSON(this.usagePath, fresh);
    return fresh;
  }

  private async recordUsage(
    tier: 'local' | 'fastModel' | 'jev',
    feature: keyof System1UsageStats['byFeature'],
  ) {
    const u = await this.getUsage();
    u.totalCalls += 1;
    u.byTier[tier] += 1;
    u.byFeature[feature] += 1;
    await atomicJSON(this.usagePath, u).catch(() => {});
  }

  async status() {
    const s = await this.settings.get();
    const cfg = s.system1;
    const usage = await this.getUsage();
    const paidCalls = usage.byTier.fastModel + usage.byTier.jev;
    const cap = cfg?.monthlyCallCap ?? 500;
    return {
      mode: cfg?.mode || 'off',
      features: cfg?.features || {
        autoReframeBox: false,
        batchQualityGate: false,
        omnibarRouter: false,
        autoTagAssets: false,
      },
      hasJevApiKey: Boolean(cfg?.hasJevApiKey),
      monthlyCallCap: cap,
      paidCalls,
      capReached: cap > 0 && paidCalls >= cap,
      usage,
    };
  }

  private async canSpendPaidCall(cfg?: System1Settings): Promise<boolean> {
    if (!cfg || cfg.mode === 'off') return false;
    const cap = cfg.monthlyCallCap ?? 500;
    if (cap <= 0) return true;
    const u = await this.getUsage();
    return u.byTier.fastModel + u.byTier.jev < cap;
  }

  private async callJev(
    cfg: System1Settings,
    payload: {
      state: string;
      questions: Record<string, unknown>;
      assets?: Record<string, string>;
    },
    useImages = false,
  ): Promise<any> {
    const apiKey = await this.settings.system1Secret();
    if (!apiKey) throw new Error('请先在「设置 → 智能辅助」保存 TypeSafe Jev API Key');
    const base = (cfg.jevBaseUrl || 'https://api.typesafe.ai/v1').replace(/\/+$/, '');
    const url = /\/systemone$/i.test(base) ? base : `${base}/systemone`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (useImages) headers['TypeSafe-Danger-Zone-Images'] = 'true';

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.jevModelId || 'jev-latest',
        ...payload,
      }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`TypeSafe Jev (${res.status})：${txt.slice(0, 240)}`);
    }
    return res.json();
  }

  private async callFastModelJson(
    cfg: System1Settings,
    prompt: string,
    imageDataUri?: string,
  ): Promise<any> {
    const s = await this.settings.get();
    const model =
      (cfg.fastModelId ? s.models.find((m) => m.id === cfg.fastModelId && m.adapter === 'chat') : undefined) ||
      s.models.find((m) => m.id === s.defaults.vision && m.adapter === 'chat') ||
      s.models.find((m) => m.id === s.defaults.agent && m.adapter === 'chat');
    if (!model) throw new Error('未找到可用的轻量对话模型，请在设置中指定');
    const provider = await this.settings.connection(model.providerId);
    if (!provider || (provider.requiresKey && !provider.apiKey)) {
      throw new Error('所选轻量模型缺少有效的 API Key');
    }
    const { baseUrl, modelId } = chatEndpoint(provider.protocol, provider.baseUrl, model.modelId);
    const content: any = imageDataUri
      ? [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUri } },
        ]
      : prompt;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.apiKey && provider.protocol !== 'system') {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        temperature: 0,
        max_tokens: 180,
        messages: [
          { role: 'system', content: 'Return strictly valid compact JSON with no markdown fences.' },
          { role: 'user', content },
        ],
      }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`快模型请求失败 (${res.status})`);
    const json: any = await res.json();
    const rawText = String(json?.choices?.[0]?.message?.content || '').trim();
    const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(stripped);
  }

  /** Connection health test triggered explicitly from Settings UI */
  async testConnection(): Promise<{ ok: boolean; tier: string; latencyMs: number; message: string }> {
    const s = await this.settings.get();
    const cfg = s.system1;
    if (!cfg || cfg.mode === 'off') {
      return { ok: true, tier: 'local', latencyMs: 0, message: '当前为 Tier 0 本地免费模式（￥0 开销，无需联网）。' };
    }
    const t0 = Date.now();
    if (cfg.mode === 'typesafe-jev') {
      const data = await this.callJev(cfg, {
        state: 'CoCraft health ping: user wants to export 9:16 portrait short video.',
        questions: {
          ping: {
            type: 'choice',
            instructions: 'Pick the matching aspect ratio.',
            criteria: { portrait: 'Vertical 9:16', landscape: 'Horizontal 16:9' },
          },
        },
      });
      const ans = data?.answers?.ping;
      if (!ans?.choice) throw new Error('Jev 响应未包含有效 answers.ping.choice');
      return {
        ok: true,
        tier: 'typesafe-jev',
        latencyMs: Date.now() - t0,
        message: `TypeSafe Jev 连通成功（模型 ${data.model || cfg.jevModelId}，choice=${ans.choice}，耗时 ${Date.now() - t0}ms）`,
      };
    }
    const parsed = await this.callFastModelJson(
      cfg,
      'Classify "export 9:16 video" as JSON: {"choice":"portrait"|"landscape"}',
    );
    return {
      ok: true,
      tier: 'fast-model',
      latencyMs: Date.now() - t0,
      message: `轻量模型连通成功（choice=${parsed?.choice || 'ok'}，耗时 ${Date.now() - t0}ms）`,
    };
  }

  /**
   * Locates the primary subject focal point inside an image (for true 9:16 Auto-Reframe).
   * Only invokes paid System 1 when `mode !== 'off'` AND `features.autoReframeBox === true`.
   */
  async locateSubjectFocal(
    imagePath: string,
    targetHint = 'the main character face or focal subject',
  ): Promise<{ focalX: number; focalY: number; provider: string } | null> {
    const s = await this.settings.get();
    const cfg = s.system1;
    if (!cfg || cfg.mode === 'off' || !cfg.features.autoReframeBox || !(await this.canSpendPaidCall(cfg))) {
      await this.recordUsage('local', 'reframeBox');
      return null;
    }
    const encoded = encodeThumbDataUri(imagePath);
    if (!encoded) return null;

    try {
      if (cfg.mode === 'typesafe-jev') {
        const data = await this.callJev(
          cfg,
          {
            state: `Locate the primary subject in this video frame for vertical 9:16 reframe. Hint: ${targetHint}`,
            questions: {
              subject_box: {
                type: 'box',
                instructions: 'Locate the bounding box of the primary character face or main visual subject.',
                criteria: targetHint,
              },
            },
            assets: { frame: encoded.dataUri },
          },
          true,
        );
        await this.recordUsage('jev', 'reframeBox');
        const box = data?.answers?.subject_box?.box;
        const focal = box ? boxToNormalizedFocal(box, encoded.width, encoded.height) : null;
        return focal ? { ...focal, provider: 'typesafe-jev' } : null;
      }

      const parsed = await this.callFastModelJson(
        cfg,
        `Locate the main subject/face center in this image for 9:16 vertical crop. Return JSON {"focalX": 0..100, "focalY": 0..100} (percentages). Hint: ${targetHint}`,
        encoded.dataUri,
      );
      await this.recordUsage('fastModel', 'reframeBox');
      const fx = Number(parsed?.focalX);
      const fy = Number(parsed?.focalY);
      if (Number.isFinite(fx) && Number.isFinite(fy)) {
        const toPct = (v: number) => (v > 0 && v <= 1 ? v * 100 : v);
        return {
          focalX: Math.round(Math.max(10, Math.min(90, toPct(fx)))),
          focalY: Math.round(Math.max(10, Math.min(90, toPct(fy)))),
          provider: 'fast-model',
        };
      }
      return null;
    } catch {
      await this.recordUsage('local', 'reframeBox');
      return null;
    }
  }

  /**
   * Evaluates 2+ candidate images and marks the top-ranked non-defective candidate as recommended.
   * Uses Tier 0 local resolution/sharpness heuristic when System 1 is OFF; Tier 1 / Tier 2 Jev (`noul + score`) when ON.
   */
  async triageCandidates(
    assets: readonly Asset[],
    promptHint = '',
  ): Promise<{ scores: Record<string, AssetQualityScore>; provider: string; fallbackNotice?: string }> {
    const s = await this.settings.get();
    const cfg = s.system1;
    const now = new Date().toISOString();
    const usePaid = Boolean(
      cfg && cfg.mode !== 'off' && cfg.features.batchQualityGate && (await this.canSpendPaidCall(cfg)),
    );
    const scores: Record<string, AssetQualityScore> = {};
    let usedProvider = 'local';
    let fallbackNotice: string | undefined;

    for (const a of assets) {
      if (a.kind !== 'image') continue;
      if (usePaid && cfg) {
        const encoded = encodeThumbDataUri(a.path);
        if (encoded) {
          try {
            if (cfg.mode === 'typesafe-jev') {
              const data = await this.callJev(
                cfg,
                {
                  state: `Evaluate this generated image candidate against creative prompt: ${promptHint || a.name}`,
                  questions: {
                    has_defect: {
                      type: 'noul',
                      instructions: 'Does the image have severe anatomical deformities, extra limbs, broken text, or garbled artifacts?',
                      criteria: { true: 'Severe visual defect or deformity', false: 'Clean coherent image' },
                    },
                    quality: {
                      type: 'score',
                      instructions: 'Rate overall visual composition, clarity, and prompt fidelity.',
                      criteria: [
                        'Broken or unusable',
                        'Mediocre composition or blurry',
                        'Acceptable standard frame',
                        'Strong cinematic quality and clarity',
                        'Outstanding hero-shot framing and detail',
                      ],
                    },
                  },
                  assets: { candidate: encoded.dataUri },
                },
                true,
              );
              await this.recordUsage('jev', 'qualityGate');
              const defectProb = Number(data?.answers?.has_defect?.noul ?? 0);
              const rawScore = Number(data?.answers?.quality?.score ?? 2);
              const norm100 = Math.max(
                5,
                Math.min(99, Math.round((rawScore / 4) * 100 - (defectProb > 0.55 ? 25 : 0))),
              );
              scores[a.id] = {
                score: norm100,
                issues: defectProb > 0.55 ? ['疑似画面畸变或瑕疵'] : undefined,
                provider: 'typesafe-jev',
                evaluatedAt: now,
              };
              usedProvider = 'typesafe-jev';
              continue;
            }
            const parsed = await this.callFastModelJson(
              cfg,
              `Score this image candidate 0..100 for cinematic quality & prompt alignment ("${promptHint || a.name}"). Return JSON {"score": number, "issues": string[]}.`,
              encoded.dataUri,
            );
            await this.recordUsage('fastModel', 'qualityGate');
            const num = Math.max(5, Math.min(99, Math.round(Number(parsed?.score ?? 75))));
            scores[a.id] = {
              score: num,
              issues: Array.isArray(parsed?.issues) && parsed.issues.length ? parsed.issues.map(String).slice(0, 3) : undefined,
              provider: 'fast-model',
              evaluatedAt: now,
            };
            usedProvider = 'fast-model';
            continue;
          } catch (err) {
            fallbackNotice = `已自动降级为本地免费评分（${String(err).slice(0, 60)}）`;
          }
        }
      }
      // Tier 0 Local Free deterministic quality score (resolution + file richness + aspect clarity)
      await this.recordUsage('local', 'qualityGate');
      const pixels = (a.width || 640) * (a.height || 360);
      const resScore = Math.min(40, Math.round((pixels / (1920 * 1080)) * 40));
      const sizeScore = Math.min(35, Math.round(((a.byteSize || 80_000) / 500_000) * 35));
      const baseScore = Math.max(55, Math.min(94, 48 + Math.round((resScore + sizeScore) * 0.6)));
      scores[a.id] = {
        score: baseScore,
        provider: 'local',
        evaluatedAt: now,
      };
    }

    // Mark the highest-scoring non-defective candidate as recommended
    const entries = Object.entries(scores);
    if (entries.length > 0) {
      entries.sort((a, b) => {
        const aDef = a[1].issues?.length ? 1 : 0;
        const bDef = b[1].issues?.length ? 1 : 0;
        if (aDef !== bDef) return aDef - bDef;
        return b[1].score - a[1].score;
      });
      entries[0][1].recommended = true;
    }
    return { scores, provider: usedProvider, fallbackNotice };
  }

  /**
   * On-demand role classification for user-selected assets (NEVER runs silently on import!).
   */
  async classifyAssetRoles(
    assets: readonly Asset[],
  ): Promise<{ roles: Record<string, AssetRole>; provider: string }> {
    const s = await this.settings.get();
    const cfg = s.system1;
    const usePaid = Boolean(
      cfg && cfg.mode !== 'off' && cfg.features.autoTagAssets && (await this.canSpendPaidCall(cfg)),
    );
    const roles: Record<string, AssetRole> = {};
    let usedProvider = 'local';

    const imageCriteria: Record<string, string> = {
      character: 'A character, portrait, actor, or person design',
      environment: 'A scene, landscape, room, architecture, or background',
      product: 'A physical product, prop, device, or object',
      'visual-style': 'An abstract style reference, moodboard, or color palette',
    };

    for (const a of assets) {
      if (usePaid && cfg && a.kind === 'image') {
        const encoded = encodeThumbDataUri(a.path);
        if (encoded) {
          try {
            if (cfg.mode === 'typesafe-jev') {
              const data = await this.callJev(
                cfg,
                {
                  state: `Classify creative asset "${a.name}" into its production role.`,
                  questions: {
                    role: {
                      type: 'choice',
                      instructions: 'Select the primary production role of this image asset.',
                      criteria: imageCriteria,
                    },
                  },
                  assets: { asset: encoded.dataUri },
                },
                true,
              );
              await this.recordUsage('jev', 'autoTag');
              const choice = data?.answers?.role?.choice as AssetRole | undefined;
              if (choice && choice in imageCriteria) {
                roles[a.id] = choice;
                usedProvider = 'typesafe-jev';
                continue;
              }
            } else {
              const parsed = await this.callFastModelJson(
                cfg,
                `Classify this image ("${a.name}") role. Return JSON {"role": "character"|"environment"|"product"|"visual-style"}.`,
                encoded.dataUri,
              );
              await this.recordUsage('fastModel', 'autoTag');
              const choice = parsed?.role as AssetRole | undefined;
              if (choice && choice in imageCriteria) {
                roles[a.id] = choice;
                usedProvider = 'fast-model';
                continue;
              }
            }
          } catch {
            // Graceful fallback to Tier 0 local classifier
          }
        }
      }
      await this.recordUsage('local', 'autoTag');
      roles[a.id] = classifyAssetRoleLocally(a);
    }
    return { roles, provider: usedProvider };
  }

  /**
   * Fast Omnibar intent router (saves expensive System 2 Agent tokens on simple canvas commands).
   */
  async routeOmnibar(text: string): Promise<{ intent: OmnibarLocalIntent; confidence: number; provider: string }> {
    const local = routeOmnibarLocally(text);
    if (local.intent !== 'agent' && local.confidence >= 0.85) {
      await this.recordUsage('local', 'omnibarRouter');
      return { ...local, provider: 'local' };
    }
    const s = await this.settings.get();
    const cfg = s.system1;
    if (!cfg || cfg.mode === 'off' || !cfg.features.omnibarRouter || !(await this.canSpendPaidCall(cfg))) {
      return { intent: 'agent', confidence: 1, provider: 'local' };
    }
    const criteria: Record<OmnibarLocalIntent, string> = {
      tidy: 'Organize, tidy up, or auto-arrange cards on the canvas',
      'new-text': 'Create a blank or short text/script sticky note card',
      breakdown: 'Split multi-line script text into sequential storyboard shots',
      'reframe-vertical': 'Fork or convert the current video into a 9:16 vertical/portrait version',
      agent: 'Any open-ended creative, editing, coding, or multi-step AI director task',
    };
    try {
      if (cfg.mode === 'typesafe-jev') {
        const data = await this.callJev(cfg, {
          state: text,
          questions: {
            intent: {
              type: 'choice',
              instructions: 'Decide if this user command is a direct 1-click local canvas action or needs the full AI director.',
              criteria,
            },
          },
        });
        await this.recordUsage('jev', 'omnibarRouter');
        const choice = (data?.answers?.intent?.choice as OmnibarLocalIntent) || 'agent';
        const confidence = Number(data?.answers?.intent?.confidence ?? 0.7);
        return { intent: confidence >= 0.75 ? choice : 'agent', confidence, provider: 'typesafe-jev' };
      }
      const parsed = await this.callFastModelJson(
        cfg,
        `Classify user command "${text}" into one of tidy|new-text|breakdown|reframe-vertical|agent. Return JSON {"intent":"...","confidence":0..1}`,
      );
      await this.recordUsage('fastModel', 'omnibarRouter');
      const choice = (parsed?.intent as OmnibarLocalIntent) || 'agent';
      const confidence = Number(parsed?.confidence ?? 0.7);
      return { intent: confidence >= 0.75 ? choice : 'agent', confidence, provider: 'fast-model' };
    } catch {
      return { intent: 'agent', confidence: 1, provider: 'local' };
    }
  }
}
