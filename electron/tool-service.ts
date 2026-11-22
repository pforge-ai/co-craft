/**
 * CoCraft Unified Core Tool Service («一核两口» — Single Source of Truth).
 *
 * Both the built-in Pi coding Agent (in-process Electron IPC with strict scope,
 * stop-revocation, and sandbox workspace guards) and the opt-in local MCP Server
 * (127.0.0.1 authenticated JSON-RPC bridge for external AI clients) route through
 * this single service so capabilities stay 100% in sync without code drift.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Asset,
  CodeComponent,
  EditOperation,
  EditScope,
  ProjectEnvelope,
  Task,
} from '../src/core/types';
import {
  applyOperations,
  detachAudioFromClipOperations,
  newClip,
  preflightSequence,
  uid,
} from '../src/core/project';
import { buildAudioDuckingKeyframes, buildKenBurnsKeyframes } from '../src/core/keyframes';
import { BUILT_IN_STYLES, createPresetClip, presetCatalog } from '../src/core/presets';
import { inferAssetEntityKind, inferAssetRole } from '../src/core/taxonomy';
import { modelUses, selectedModel } from '../src/core/models';
import { compileComponent } from './code';
import { collectGeneratedFile, modelParameters, type GenerationRequest, type GenerationService } from './generation';
import type { JobService } from './jobs';
import { importMedia } from './media';
import { importMaterialPack } from './packs';
import type { SettingsStore } from './settings';
import type { Library, ProjectStore } from './store';
import { addStudioAsset, stageStudioAsset } from './studio-media';
import type { GlobalVault } from './vault';
import type { McpBridgeStatus } from './mcp-bridge';

export interface ToolExecutionContext {
  source: 'agent' | 'mcp';
  store: ProjectStore;
  defaultSequenceId?: string;
  scope?: EditScope;
  runId?: string;
  abortSignal?: AbortSignal;
  isActive?: () => boolean;
  stagedAssets?: Map<string, Asset>;
  stagedComponents?: Map<string, CodeComponent>;
  stagedComponentAssets?: Map<string, Asset[]>;
  packEntries?: Map<string, CodeComponent>;
  workspace?: string;
  supportsImages?: boolean;
  publishGeneratedAssets?: boolean;
  trackJob?: (jobId: string) => void;
  untrackJob?: (jobId: string) => void;
}

export interface ToolServiceDeps {
  appVersion?: string;
  getStore: () => ProjectStore;
  setStore?: (next: ProjectStore) => void;
  library?: Library;
  settings?: SettingsStore;
  jobs: JobService;
  generation?: GenerationService;
  globalVault?: GlobalVault;
  getStudioMedia: () => Asset[];
  changed: (store: ProjectStore, envelope: ProjectEnvelope) => Promise<void> | void;
  importFiles?: (paths: string[], append?: boolean, sequenceId?: string) => Promise<ProjectEnvelope>;
  getMcpStatus?: () => McpBridgeStatus;
  runBuiltInAgent?: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Canonical registry listing every core capability shared across the built-in Agent and MCP.
 * Kept as data so tests and diagnostics can assert parity between both surfaces.
 */
export const COCRAFT_CORE_TOOLS = [
  'read_project',
  'publish_edit',
  'list_models',
  'list_presets',
  'prepare_preset',
  'list_studio_media',
  'prepare_studio_media',
  'search_assets',
  'pull_vault_item',
  'apply_keyframe_preset',
  'detach_audio',
  'compile_component',
  'import_asset',
  'generate_media',
  'transcribe_asset',
  'inspect_media',
  'preview_frame',
  'preflight_sequence',
  'export_sequence',
] as const;

export type CoreToolName = (typeof COCRAFT_CORE_TOOLS)[number];

const sanitizeFileName = (raw: string, fallback = 'export') =>
  String(raw || fallback)
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 64) || fallback;

export class CoCraftToolService {
  constructor(private deps: ToolServiceDeps) {}

  private ensureActive(ctx: ToolExecutionContext) {
    if (ctx.isActive && !ctx.isActive()) throw new Error('运行已停止');
    ctx.abortSignal?.throwIfAborted();
  }

  private async runGeneration(ctx: ToolExecutionContext, req: GenerationRequest) {
    if (!this.deps.generation) throw new Error('素材模型服务尚未启动');
    this.ensureActive(ctx);
    const publish = Boolean(ctx.publishGeneratedAssets);
    const job = await this.deps.generation.start(ctx.store, req, {
      publish,
      assets: ctx.stagedAssets ? [...ctx.stagedAssets.values()] : undefined,
      signal: ctx.abortSignal,
    });
    ctx.trackJob?.(job.id);
    if (ctx.isActive && !ctx.isActive()) {
      await this.deps.jobs.cancel(job.id);
      ctx.untrackJob?.(job.id);
      throw new Error('运行已停止');
    }
    try {
      const result = await this.deps.generation.wait(job.id, ctx.abortSignal);
      this.ensureActive(ctx);
      if (result.asset && ctx.stagedAssets) ctx.stagedAssets.set(result.asset.id, result.asset);
      return { ...result, jobId: job.id };
    } finally {
      ctx.untrackJob?.(job.id);
    }
  }

  /**
   * Execute a core CoCraft tool under the provided caller context (built-in Agent or MCP).
   */
  async execute(method: string, args: Record<string, any>, ctx: ToolExecutionContext): Promise<unknown> {
    this.ensureActive(ctx);

    if (method === 'read_project') {
      const project = await ctx.store.project();
      if (ctx.source === 'agent' && ctx.workspace) {
        const paths = new Map(
          [...(ctx.packEntries || new Map())].map(([entry, c]) => [c.id, relative(ctx.workspace!, entry)]),
        );
        return {
          ...project,
          // Strip heavy waveform arrays and compiled JS bundles to save LLM context tokens.
          assets: project.assets.map(({ waveform: _w, ...rest }) => rest),
          components: project.components.map(({ compiled: _c, ...c }) => ({
            ...c,
            workspaceEntry: paths.get(c.id) || `components/${c.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.tsx`,
          })),
        };
      }
      return { ...project, projectPath: ctx.store.path };
    }

    if (method === 'list_presets') {
      const category = typeof args.category === 'string' ? args.category : undefined;
      return presetCatalog
        .filter((p) => !category || category === 'all' || p.category === category)
        .map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          kind: p.kind,
          durationSeconds: p.durationSeconds,
          description: p.description,
          defaultProps: p.defaultProps,
          parameters: p.parameters,
          license: p.license,
        }));
    }

    if (method === 'prepare_preset') {
      const project = await ctx.store.project();
      const seqId = String(args.sequenceId || ctx.defaultSequenceId || project.sequences[0]?.id || '');
      const sequence = project.sequences.find((s) => s.id === seqId);
      if (!sequence) throw new Error('成片序列不存在');
      const presetId = String(args.presetId || '').trim();
      const start = Math.max(0, Math.round(Number(args.start ?? 0)));
      const overrides =
        args.props && typeof args.props === 'object' && !Array.isArray(args.props)
          ? (args.props as Record<string, unknown>)
          : {};
      const clip = createPresetClip(presetId, start, sequence.fps, overrides, project);
      if (args.duration !== undefined) {
        const dur = Math.round(Number(args.duration));
        if (!Number.isInteger(dur) || dur < 1) throw new Error('时长需要是正整数帧');
        clip.duration = dur;
      }
      if (typeof args.name === 'string' && args.name.trim()) clip.name = args.name.trim();
      if (typeof args.track === 'string' && ['visual', 'overlay', 'caption', 'audio'].includes(args.track)) {
        clip.track = args.track as typeof clip.track;
      }
      if (args.transitionIn && typeof args.transitionIn === 'object') {
        clip.transitionIn = args.transitionIn as typeof clip.transitionIn;
      }
      if (args.keyframes && typeof args.keyframes === 'object') {
        clip.keyframes = args.keyframes as typeof clip.keyframes;
      }
      const operation: EditOperation = { type: 'addClip', sequenceId: sequence.id, clip };
      if (args.publish) {
        const envelope = await ctx.store.edit(
          {
            baseRevision: project.revision,
            name: `${ctx.source === 'mcp' ? 'MCP' : 'Agent'} 添加预设「${clip.name}」`,
            operations: [operation],
            author: 'agent',
            runId: ctx.runId,
            scope: ctx.scope,
          },
          ctx.isActive,
        );
        await this.deps.changed(ctx.store, envelope);
        return { revision: envelope.project.revision, clip };
      }
      return { clip, operation };
    }

    if (method === 'search_assets') {
      const project = await ctx.store.project();
      const query = String(args.query || '').trim().toLowerCase();
      const wantTags = Array.isArray(args.tags) ? args.tags.map((t: string) => String(t).toLowerCase()) : [];
      const matchTags = (tags: string[] | undefined) =>
        !wantTags.length || wantTags.every((w: string) => (tags || []).some((t) => t.toLowerCase().includes(w)));
      const matchQuery = (name: string, desc?: string) =>
        !query || name.toLowerCase().includes(query) || (desc || '').toLowerCase().includes(query);

      const results: any[] = [];
      if (!args.scope || args.scope === 'project') {
        for (const v of project.vault || []) {
          const kind = inferAssetEntityKind(v);
          const role = inferAssetRole(v);
          const allTags = [...(v.tags || []), ...(v.variants?.flatMap((vr) => vr.tags) || [])];
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(allTags) || !matchQuery(v.name, v.description || v.promptAnchor)) continue;
          results.push({
            source: 'project-vault',
            id: v.id,
            name: v.name,
            kind,
            role,
            tags: v.tags || [],
            version: v.version,
            variants: (v.variants || []).map((vr) => ({
              id: vr.id,
              name: vr.name,
              version: vr.version,
              assetId: vr.assetId,
              tags: vr.tags,
            })),
          });
        }
        for (const a of project.assets) {
          const kind = inferAssetEntityKind(a);
          const role = inferAssetRole(a);
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(a.tags) || !matchQuery(a.name)) continue;
          results.push({
            source: 'project-media',
            id: a.id,
            name: a.name,
            kind,
            role,
            tags: a.tags || [],
            duration: a.duration,
            hasTranscript: Boolean(a.transcript),
          });
        }
      }
      if ((!args.scope || args.scope === 'personal') && this.deps.globalVault) {
        for (const g of await this.deps.globalVault.list()) {
          const kind = inferAssetEntityKind(g);
          const role = inferAssetRole(g);
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(g.tags) || !matchQuery(g.name, g.description || g.promptAnchor)) continue;
          results.push({
            source: 'personal-library',
            id: g.id,
            name: g.name,
            kind,
            role,
            tags: g.tags || [],
            version: g.version,
          });
        }
      }
      if (!args.scope || args.scope === 'studio') {
        for (const st of BUILT_IN_STYLES) {
          const kind = inferAssetEntityKind(st);
          const role = inferAssetRole(st);
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(st.tags) || !matchQuery(st.name, st.description)) continue;
          results.push({
            source: 'built-in-style',
            id: st.id,
            name: st.name,
            kind,
            role,
            tags: st.tags || [],
            description: st.description,
            styleTokens: st.styleTokens,
          });
        }
        for (const s of this.deps.getStudioMedia()) {
          const kind = inferAssetEntityKind(s);
          const role = inferAssetRole(s);
          if (args.kind && kind !== args.kind) continue;
          if (args.role && role !== args.role) continue;
          if (!matchTags(s.tags) || !matchQuery(s.name)) continue;
          results.push({
            source: 'built-in-studio',
            id: s.id,
            name: s.name,
            kind,
            role,
            tags: s.tags || [],
            duration: s.duration,
          });
        }
      }
      return results;
    }

    if (method === 'pull_vault_item') {
      if (!this.deps.globalVault) throw new Error('个人资产库未初始化');
      if (!args.itemId || typeof args.itemId !== 'string') throw new Error('缺少 itemId');
      const pulled = await this.deps.globalVault.pullToProject(ctx.store, args.itemId);
      await this.deps.changed(ctx.store, pulled.envelope);
      return {
        revision: pulled.envelope.project.revision,
        item: pulled.item,
        asset: pulled.asset ? { id: pulled.asset.id, name: pulled.asset.name, kind: pulled.asset.kind } : undefined,
      };
    }

    if (method === 'list_studio_media') {
      const kind = typeof args.kind === 'string' ? args.kind : undefined;
      return this.deps
        .getStudioMedia()
        .filter((a) => !kind || a.kind === kind)
        .map(({ id, name, kind: k, duration, width, height, source }) => ({
          id,
          name,
          kind: k,
          duration,
          width,
          height,
          license: source?.license,
          source,
        }));
    }

    if (method === 'prepare_studio_media') {
      const studioMedia = this.deps.getStudioMedia();
      const id = String(args.id || '').trim();
      if (args.publish) {
        const p = await ctx.store.project();
        const seqId =
          typeof args.sequenceId === 'string' && args.sequenceId
            ? args.sequenceId
            : ctx.defaultSequenceId || p.sequences[0]?.id || '';
        const at = args.at !== undefined ? Math.max(0, Math.round(Number(args.at))) : 0;
        const res = await addStudioAsset(ctx.store, studioMedia, id, seqId, at, p.id);
        await this.deps.changed(ctx.store, res.envelope);
        const seq = res.envelope.project.sequences.find((s) => s.id === (seqId || res.envelope.project.sequences[0]?.id));
        const clip = seq?.clips.find((c) => c.id === res.clipId);
        const asset = clip?.assetId ? res.envelope.project.assets.find((a) => a.id === clip.assetId) : undefined;
        return { revision: res.envelope.project.revision, clipId: res.clipId, asset, clip };
      }
      const source = studioMedia.find((a) => a.id === id);
      if (!source) throw new Error('随附素材不存在');
      const asset = await stageStudioAsset(ctx.store.path, source);
      this.ensureActive(ctx);
      ctx.stagedAssets?.set(asset.id, asset);
      return { asset };
    }

    if (method === 'list_models') {
      // Strictly emit sanitized connection metadata — NEVER raw API keys or credentials.
      if (this.deps.settings) {
        const s = await this.deps.settings.get();
        const p = await ctx.store.project();
        const providerById = new Map(s.providers.map((pr) => [pr.id, pr]));
        const resolvedDefaults = Object.fromEntries(
          modelUses.flatMap(({ id }) => {
            const m = selectedModel(s, id, p.modelDefaults);
            return m ? [[id, m.id]] : [];
          }),
        );
        return {
          defaults: ctx.source === 'mcp' ? s.defaults : resolvedDefaults,
          resolvedDefaults,
          projectDefaults: p.modelDefaults || {},
          models: s.models.map((m) => {
            const prov = providerById.get(m.providerId);
            const ready = Boolean(prov && (prov.hasApiKey || !prov.requiresKey));
            return {
              id: m.id,
              name: m.name,
              modelId: m.modelId,
              uses: m.capabilities,
              capabilities: m.capabilities,
              adapter: m.adapter,
              providerId: m.providerId,
              providerName: prov?.name || '',
              protocol: prov?.protocol || '',
              parameters: modelParameters(m.adapter, m.parameters),
              connected: ready,
              ready,
            };
          }),
        };
      }
      if (!this.deps.generation) throw new Error('素材模型服务尚未启动');
      return this.deps.generation.availableModels(ctx.store);
    }

    if (method === 'publish_edit') {
      const baseRevision = Number(args.baseRevision);
      if (!Number.isFinite(baseRevision)) throw new Error('baseRevision 必须是数字');
      const name = String(args.name || (ctx.source === 'mcp' ? 'MCP 编辑' : 'Agent 编辑')).trim();
      const operations: EditOperation[] = Array.isArray(args.operations) ? [...args.operations] : [];
      if (!operations.length) throw new Error('operations 不能为空');

      const before = await ctx.store.project();
      const required = new Map<string, Asset>();

      for (const op of operations) {
        if (op.type === 'relinkAsset') {
          throw new Error('Agent 不能直接重连素材路径，请由用户在界面中重新定位素材');
        }
        if (op.type === 'addAsset') {
          if (ctx.source === 'mcp') {
            throw new Error('请使用 media.import 或 studio.prepare 导入素材，禁止直接构造本地路径');
          }
          const asset = ctx.stagedAssets?.get(op.asset?.id);
          if (!asset) {
            throw new Error('请先使用 import_asset、generate_media 或 prepare_studio_media 登记素材');
          }
          op.asset = asset;
        }
        if (op.type === 'putComponent' && ctx.source === 'agent') {
          const compiled = ctx.stagedComponents?.get(op.component?.id);
          if (!compiled) {
            throw new Error('请先使用 compile_component 编译任务工作区中的组件，再通过 putComponent 发布');
          }
          op.component = compiled;
          for (const asset of ctx.stagedComponentAssets?.get(compiled.id) || []) required.set(asset.id, asset);
          // Protect other sequences (Copy-on-Write boundary): refuse overwriting a component referenced outside the active sequence.
          const targetSeqId = ctx.scope?.sequenceId || ctx.defaultSequenceId;
          const usedElsewhere = before.sequences.some(
            (s) =>
              s.id !== targetSeqId &&
              s.clips.some(
                (c) =>
                  c.componentId === op.component.id ||
                  (c.takes || []).some((t) => t.componentId === op.component.id),
              ),
          );
          if (usedElsewhere) {
            throw new Error(
              `组件 ${op.component.id} 正被其他成片分支引用，请使用新的组件 ID 编译后再发布，以免影响其他成片`,
            );
          }
        }
      }

      if (required.size) {
        for (const id of before.assets.map((a) => a.id)) required.delete(id);
        for (const op of operations) if (op.type === 'addAsset') required.delete(op.asset.id);
        operations.unshift(...[...required.values()].map((asset) => ({ type: 'addAsset' as const, asset })));
      }

      if (operations.some((op) => op.type === 'putComponent')) {
        await this.deps.jobs.validateComponents(
          applyOperations(before, operations, 'agent', ctx.scope),
          operations,
          ctx.abortSignal,
        );
      }

      const envelope = await ctx.store.edit(
        { baseRevision, name, operations, author: 'agent', runId: ctx.runId, scope: ctx.scope },
        ctx.isActive,
      );
      await this.deps.changed(ctx.store, envelope);
      return {
        revision: envelope.project.revision,
        changes: envelope.revisions[0]?.changes,
        sequenceCount: envelope.project.sequences.length,
        clipCount: envelope.project.sequences[0]?.clips.length ?? 0,
      };
    }

    if (method === 'apply_keyframe_preset') {
      const p = await ctx.store.project();
      const seqId = String(args.sequenceId || ctx.defaultSequenceId || p.sequences[0]?.id || '');
      const seq = p.sequences.find((s) => s.id === seqId);
      if (!seq) throw new Error('成片序列不存在');
      const clip = seq.clips.find((c) => c.id === String(args.clipId || ''));
      if (!clip) throw new Error('片段不存在');
      const preset = String(args.preset || '');
      let nextKf = clip.keyframes;
      if (preset === 'zoom-in' || preset === 'zoom-out' || preset === 'pan-right') {
        nextKf = buildKenBurnsKeyframes(clip, preset);
      } else if (preset === 'auto-duck') {
        nextKf = buildAudioDuckingKeyframes(seq, clip, {
          duckVolume: args.duckVolume !== undefined ? Number(args.duckVolume) : undefined,
          rampFrames: args.rampFrames !== undefined ? Number(args.rampFrames) : undefined,
        });
      } else if (preset === 'fade-in-out') {
        const fadeLen = Math.min(18, Math.max(3, Math.floor(clip.duration / 4)));
        const end = Math.max(1, clip.duration - 1);
        nextKf = {
          ...(clip.keyframes || {}),
          opacity: [
            { frame: 0, value: 0, easing: 'ease-out' },
            { frame: fadeLen, value: 1, easing: 'linear' },
            { frame: Math.max(fadeLen, end - fadeLen), value: 1, easing: 'ease-in' },
            { frame: end, value: 0, easing: 'ease-in' },
          ],
        };
      } else {
        throw new Error(`不支持的关键帧预设：${preset}`);
      }
      const envelope = await ctx.store.edit(
        {
          baseRevision: p.revision,
          name: `${ctx.source === 'mcp' ? 'MCP' : 'Agent'} 应用关键帧预设 (${preset})`,
          operations: [
            { type: 'updateClip', sequenceId: seq.id, clipId: clip.id, changes: { keyframes: nextKf } },
          ],
          author: 'agent',
          runId: ctx.runId,
          scope: ctx.scope,
        },
        ctx.isActive,
      );
      await this.deps.changed(ctx.store, envelope);
      return { revision: envelope.project.revision, clipId: clip.id, keyframes: nextKf };
    }

    if (method === 'detach_audio') {
      const p = await ctx.store.project();
      const seqId = String(args.sequenceId || ctx.defaultSequenceId || p.sequences[0]?.id || '');
      const seq = p.sequences.find((s) => s.id === seqId);
      if (!seq) throw new Error('成片序列不存在');
      const clip = seq.clips.find((c) => c.id === String(args.clipId || ''));
      if (!clip) throw new Error('片段不存在');
      const { operations, audioClipId } = detachAudioFromClipOperations(seq, clip);
      const envelope = await ctx.store.edit(
        {
          baseRevision: p.revision,
          name: `${ctx.source === 'mcp' ? 'MCP' : 'Agent'} 分离音画「${clip.name}」`,
          operations,
          author: 'agent',
          runId: ctx.runId,
          scope: ctx.scope,
        },
        ctx.isActive,
      );
      await this.deps.changed(ctx.store, envelope);
      return { revision: envelope.project.revision, audioClipId };
    }

    if (method === 'import_asset') {
      if (ctx.source === 'agent' && ctx.workspace) {
        const file = await realpath(resolve(ctx.workspace, String(args.path || '')));
        if (!file.startsWith((await realpath(ctx.workspace)) + '/')) {
          throw new Error('新素材必须位于任务工作区');
        }
        const destination = await collectGeneratedFile(file, ctx.store);
        const asset = await importMedia(destination, ctx.store.path);
        asset.name = args.name || asset.name;
        asset.source = { provider: 'Agent', license: '项目生成素材' };
        ctx.stagedAssets?.set(asset.id, asset);
        return asset;
      }
      if (!this.deps.importFiles) throw new Error('导入服务不可用');
      const paths = Array.isArray(args.paths)
        ? args.paths.map(String).filter(Boolean)
        : typeof args.path === 'string' && args.path.trim()
          ? [args.path.trim()]
          : [];
      if (!paths.length) throw new Error('请提供本地文件路径 path 或 paths');
      const res = await this.deps.importFiles(
        paths,
        Boolean(args.append),
        typeof args.sequenceId === 'string' ? args.sequenceId : undefined,
      );
      return {
        revision: res.project.revision,
        assets: res.project.assets.slice(-paths.length),
      };
    }

    if (method === 'compile_component') {
      // Built-in Agent path-based workspace compilation (staged for putComponent in publish_edit)
      if (ctx.source === 'agent' && ctx.workspace && typeof args.path === 'string') {
        const file = await realpath(resolve(args.path));
        if (!file.startsWith((await realpath(ctx.workspace)) + '/')) {
          throw new Error('组件必须位于任务工作区');
        }
        const published = ctx.packEntries?.get(file);
        let component: CodeComponent;
        if (published?.pack) {
          const pack = await importMaterialPack(dirname(file), ctx.store.path, await ctx.store.project());
          const entry = pack.components.find((c) => c.pack.entry === basename(file));
          if (!entry) throw new Error('在素材包清单中找不到这个入口');
          component = { ...entry, id: args.id, name: args.name, props: args.props || entry.props };
          ctx.stagedComponentAssets?.set(args.id, pack.assets);
        } else {
          component = await compileComponent(
            await readFile(file, 'utf8'),
            args.id,
            args.name,
            ctx.workspace,
            args.props,
            dirname(file),
          );
        }
        this.ensureActive(ctx);
        ctx.stagedComponents?.set(component.id, component);
        return component;
      }

      // Direct inline-source compilation & publish (used by MCP)
      const p = await ctx.store.project();
      const source = String(args.source || '');
      if (!source.trim()) throw new Error('source TSX 代码不能为空');
      const id = String(args.id || uid('component'));
      const name = String(args.name || 'MCP 自定义组件');
      const props =
        args.props && typeof args.props === 'object' && !Array.isArray(args.props)
          ? (args.props as Record<string, string | number | boolean>)
          : {};
      const component = await compileComponent(source, id, name, ctx.store.path, props, ctx.store.path);
      const ops: EditOperation[] = [{ type: 'putComponent', component }];
      let addedClipId: string | undefined;
      if (args.addClip) {
        const seqId = String(args.sequenceId || ctx.defaultSequenceId || p.sequences[0]?.id || '');
        const seq = p.sequences.find((s) => s.id === seqId);
        if (!seq) throw new Error('成片序列不存在');
        const clip = {
          ...newClip('code', Math.max(0, Math.round(Number(args.start ?? 0)))),
          name,
          track: (args.track === 'overlay' ? 'overlay' : 'visual') as 'visual' | 'overlay',
          duration: Math.max(1, Math.round(Number(args.duration ?? seq.fps * 4))),
          componentId: component.id,
          props: { ...props },
        };
        addedClipId = clip.id;
        ops.push({ type: 'addClip', sequenceId: seq.id, clip });
      }
      await this.deps.jobs.validateComponents(applyOperations(p, ops, 'agent', ctx.scope), ops, ctx.abortSignal);
      const envelope = await ctx.store.edit(
        {
          baseRevision: p.revision,
          name: `${ctx.source === 'mcp' ? 'MCP' : 'Agent'} 编译组件「${name}」`,
          operations: ops,
          author: 'agent',
          runId: ctx.runId,
          scope: ctx.scope,
        },
        ctx.isActive,
      );
      await this.deps.changed(ctx.store, envelope);
      return {
        revision: envelope.project.revision,
        component: { id: component.id, name: component.name, hash: component.hash, props: component.props },
        clipId: addedClipId,
      };
    }

    if (method === 'generate_media' || method === 'transcribe_asset' || method === 'inspect_media') {
      const use =
        method === 'transcribe_asset'
          ? 'transcription'
          : method === 'inspect_media'
            ? 'vision'
            : (String(args.use || '') as GenerationRequest['use']);
      if (method === 'generate_media') {
        const allowed = ctx.source === 'mcp' ? ['image', 'video', 'speech', 'transcription'] : ['image', 'video', 'speech'];
        if (!allowed.includes(use)) {
          throw new Error(ctx.source === 'mcp' ? 'use 必须是 image | video | speech | transcription' : '生成素材仅支持图像、视频或配音');
        }
      }
      if (args.wait === false && ctx.source === 'mcp') {
        if (!this.deps.generation) throw new Error('素材模型服务尚未启动');
        const job = await this.deps.generation.start(
          ctx.store,
          { ...args, use } as GenerationRequest,
          { publish: Boolean(ctx.publishGeneratedAssets) },
        );
        return { jobId: job.id, status: job.status };
      }
      const result = await this.runGeneration(ctx, {
        ...(args as GenerationRequest),
        use,
      });
      if (ctx.source === 'mcp') {
        const latest = await ctx.store.project();
        return {
          jobId: result.jobId,
          status: 'completed',
          revision: latest.revision,
          asset: result.asset,
          text: result.text,
          segments: result.segments,
        };
      }
      return result;
    }

    if (method === 'preview_frame') {
      const project = await ctx.store.project();
      const seqId = String(args.sequenceId || ctx.defaultSequenceId || project.sequences[0]?.id || '');
      const seq = project.sequences.find((s) => s.id === seqId) || project.sequences[0];
      if (!seq) throw new Error('成片序列不存在');
      const frame = Math.max(0, Math.round(Number(args.frame ?? 0)));
      const scale = Math.max(0.25, Math.min(1, Number(args.scale ?? 0.5)));
      const outDir =
        ctx.source === 'agent' && ctx.workspace
          ? join(ctx.workspace, '.tmp')
          : join(ctx.store.path, '.cocraft', 'mcp-previews');
      await mkdir(outDir, { recursive: true });
      const output =
        ctx.source === 'agent'
          ? join(outDir, `preview-${randomUUID()}.png`)
          : join(outDir, `preview-v${project.revision}-f${frame}-${Date.now()}.png`);
      const job = await this.deps.jobs.render(project, seq.id, output, {
        still: true,
        frame,
        scale,
        silent: true,
        projectPath: ctx.store.path,
      });
      ctx.trackJob?.(job.id);
      try {
        await this.deps.jobs.wait(job.id, ctx.abortSignal);
      } finally {
        if (ctx.isActive && !ctx.isActive()) await this.deps.jobs.cancel(job.id);
        ctx.untrackJob?.(job.id);
      }

      if (ctx.source === 'mcp') {
        const bytes = await readFile(output);
        return {
          frame,
          revision: project.revision,
          sequenceId: seq.id,
          width: Math.round(seq.width * scale),
          height: Math.round(seq.height * scale),
          path: output,
          mimeType: 'image/png',
          base64: bytes.toString('base64'),
        };
      }

      try {
        if (!ctx.supportsImages) {
          let tempAssetId: string | undefined;
          try {
            const asset = await importMedia(output, ctx.store.path);
            tempAssetId = asset.id;
            ctx.stagedAssets?.set(asset.id, asset);
            return await this.runGeneration(ctx, {
              use: 'vision',
              assetId: asset.id,
              prompt:
                args.prompt || '检查这个视频画面的排版、文字溢出、层次、对比度和视觉质量，提供具体改进建议。',
            });
          } catch (err) {
            if (/(未配置|请在「设置|用途默认值|缺少提供商|保存 API Key)/.test(String(err))) {
              const activeClips = seq.clips
                .filter((c) => frame >= c.start && frame < c.start + c.duration)
                .map((c) => ({
                  id: c.id,
                  name: c.name,
                  track: c.track,
                  kind: c.kind,
                  text: c.props.text || undefined,
                  presetId: c.props.presetId || undefined,
                }));
              return {
                renderedOk: true,
                text: '静帧已成功实际渲染（无代码或画面异常）；当前未单独配置视觉理解模型，已返回该帧可见图层结构摘要。',
                sequence: seq.name,
                dimensions: `${seq.width}x${seq.height}`,
                frame,
                visibleLayers: activeClips,
              };
            }
            throw err;
          } finally {
            if (tempAssetId) ctx.stagedAssets?.delete(tempAssetId);
          }
        }
        return { data: (await readFile(output)).toString('base64') };
      } finally {
        await rm(output, { force: true }).catch(() => {});
      }
    }

    if (method === 'preflight_sequence') {
      const project = await ctx.store.project();
      const targetSeqId = String(args.sequenceId || ctx.defaultSequenceId || project.sequences[0]?.id || '');
      const missing = project.assets.filter((a) => a.path && !existsSync(a.path)).map((a) => a.id);
      const issues = preflightSequence(project, targetSeqId, missing);
      return ctx.source === 'mcp' ? issues : { sequenceId: targetSeqId, issueCount: issues.length, issues };
    }

    if (method === 'export_sequence') {
      const p = await ctx.store.project();
      const seqId = String(args.sequenceId || ctx.defaultSequenceId || p.sequences[0]?.id || '');
      const seq = p.sequences.find((s) => s.id === seqId);
      if (!seq) throw new Error('成片序列不存在');
      if (!seq.clips.length) throw new Error('先添加一些画面，再导出成片');
      const missing = p.assets.filter((a) => a.path && !existsSync(a.path)).map((a) => a.id);
      const issues = preflightSequence(p, seq.id, missing);
      const blocker = issues.find((i) => i.severity === 'blocker');
      if (blocker) throw new Error(`${blocker.title}：${blocker.detail}`);
      const scale = Math.max(0.25, Math.min(2, Number(args.scale ?? 1)));
      const customName =
        typeof args.fileName === 'string' && args.fileName.trim()
          ? sanitizeFileName(args.fileName, 'film')
          : `${sanitizeFileName(seq.name, 'film')}-v${p.revision}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const output = join(ctx.store.path, 'exports', customName.endsWith('.mp4') ? customName : `${customName}.mp4`);
      const job = await this.deps.jobs.render(p, seq.id, output, { scale, projectPath: ctx.store.path });
      if (args.wait === false) {
        return { jobId: job.id, status: job.status, output };
      }
      ctx.trackJob?.(job.id);
      try {
        await this.deps.jobs.wait(job.id, ctx.abortSignal);
      } finally {
        if (ctx.isActive && !ctx.isActive()) await this.deps.jobs.cancel(job.id);
        ctx.untrackJob?.(job.id);
      }
      this.ensureActive(ctx);
      return { jobId: job.id, status: 'completed', output, issues };
    }

    throw new Error(`未知工具：${method}`);
  }

  /**
   * MCP Protocol Adapter: routes MCP JSON-RPC actions onto the unified core tool service
   * plus host-level project/session orchestration commands.
   */
  async executeMcp(action: string, params: Record<string, unknown>): Promise<unknown> {
    const target = this.deps.getStore();
    const mcpCtx = (storeRef: ProjectStore = target): ToolExecutionContext => ({
      source: 'mcp',
      store: storeRef,
      supportsImages: true,
      publishGeneratedAssets: true,
    });

    switch (action) {
      case 'status': {
        const p = await target.project();
        return {
          appVersion: this.deps.appVersion || '0.4.0',
          mcpBridge: this.deps.getMcpStatus?.(),
          activeProject: {
            id: p.id,
            name: p.name,
            path: target.path,
            revision: p.revision,
            sequences: p.sequences.map((s) => ({
              id: s.id,
              name: s.name,
              width: s.width,
              height: s.height,
              fps: s.fps,
              clipCount: s.clips.length,
              durationFrames: Math.max(0, ...s.clips.map((c) => c.start + c.duration)),
            })),
            assetCount: p.assets.length,
            componentCount: p.components.length,
          },
          runningJobs: this.deps.jobs.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length,
        };
      }
      case 'projects.list': {
        if (!this.deps.library) throw new Error('工程库未初始化');
        return await this.deps.library.list();
      }
      case 'projects.create': {
        if (!this.deps.library || !this.deps.setStore) throw new Error('工程库未初始化');
        const name = String(params.name || 'MCP 创作工程').trim();
        const created = await this.deps.library.create(name);
        this.deps.setStore(created);
        const envelope = await created.envelope();
        await this.deps.changed(created, envelope);
        return {
          id: envelope.project.id,
          name: envelope.project.name,
          path: created.path,
          revision: envelope.project.revision,
          sequenceId: envelope.project.sequences[0]?.id,
        };
      }
      case 'projects.open': {
        if (!this.deps.library || !this.deps.setStore) throw new Error('工程库未初始化');
        const rawPath = String(params.path || '').trim();
        if (!rawPath) throw new Error('请提供要打开的工程路径 path');
        const opened = await this.deps.library.open(extname(rawPath) === '.json' ? dirname(rawPath) : rawPath);
        this.deps.setStore(opened);
        const envelope = await opened.envelope();
        await this.deps.changed(opened, envelope);
        return {
          id: envelope.project.id,
          name: envelope.project.name,
          path: opened.path,
          revision: envelope.project.revision,
          sequenceId: envelope.project.sequences[0]?.id,
        };
      }
      case 'project.undo': {
        const envelope = await target.undo();
        await this.deps.changed(target, envelope);
        return { revision: envelope.project.revision };
      }
      case 'project.redo': {
        const envelope = await target.redo();
        await this.deps.changed(target, envelope);
        return { revision: envelope.project.revision };
      }
      case 'agent.run': {
        if (!this.deps.runBuiltInAgent) throw new Error('内置 Agent 服务未初始化');
        return await this.deps.runBuiltInAgent(params);
      }
      // Unified Core Tools — single execution path shared with Built-in Agent
      case 'project.read':
        return this.execute('read_project', params, mcpCtx());
      case 'project.edit':
        return this.execute('publish_edit', params, mcpCtx());
      case 'models.list':
        return this.execute('list_models', params, mcpCtx());
      case 'presets.list':
        return this.execute('list_presets', params, mcpCtx());
      case 'presets.addClip':
        return this.execute('prepare_preset', { ...params, publish: true }, mcpCtx());
      case 'studio.list':
        return this.execute('list_studio_media', params, mcpCtx());
      case 'studio.prepare':
        return this.execute('prepare_studio_media', { ...params, publish: true }, mcpCtx());
      case 'assets.search':
        return this.execute('search_assets', params, mcpCtx());
      case 'vault.pull':
        return this.execute('pull_vault_item', params, mcpCtx());
      case 'clip.applyPresetKeyframes':
        return this.execute('apply_keyframe_preset', params, mcpCtx());
      case 'clip.detachAudio':
        return this.execute('detach_audio', params, mcpCtx());
      case 'component.compile':
        return this.execute('compile_component', params, mcpCtx());
      case 'media.import':
        return this.execute('import_asset', params, mcpCtx());
      case 'media.generate':
        return this.execute('generate_media', params, mcpCtx());
      case 'media.inspect':
        return this.execute('inspect_media', params, mcpCtx());
      case 'preview.frame':
        return this.execute('preview_frame', params, mcpCtx());
      case 'export.preflight':
        return this.execute('preflight_sequence', params, mcpCtx());
      case 'export.start':
        return this.execute('export_sequence', params, mcpCtx());
      default:
        throw new Error(`未知的 MCP 操作：${action}`);
    }
  }
}
