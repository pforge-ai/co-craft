import React from 'react';
import { Lock, Unlock, ArrowUpRight, Copy, Trash2, Code2, SlidersHorizontal } from 'lucide-react';
import type { Clip, Sequence, Project, EditOperation } from '../core/types';
import { newClip, uid, clone } from '../core/project';
import { Field, IconButton } from './ui';
export function Inspector({
  clip,
  sequence,
  project,
  onEdit,
  onReference,
  onCode,
}: {
  clip: Clip | undefined;
  sequence: Sequence;
  project: Project;
  onEdit: (name: string, ops: EditOperation[]) => void;
  onReference: () => void;
  onCode: () => void;
}) {
  if (!clip)
    return (
      <div className="inspector-empty">
        <SlidersHorizontal size={25} />
        <h3>每一处细节，都能接管。</h3>
        <p>在时间线上选择片段，调整画面、声音与时间。</p>
        <div className="composition-info">
          <span>画幅</span>
          <b>
            {sequence.width} × {sequence.height}
          </b>
          <span>帧率</span>
          <b>{sequence.fps} fps</b>
          <span>片段</span>
          <b>{sequence.clips.length}</b>
        </div>
      </div>
    );
  const update = (changes: Partial<Clip>, name = '调整片段') =>
    onEdit(name, [{ type: 'updateClip', sequenceId: sequence.id, clipId: clip.id, changes }]);
  const prop = (key: string, value: unknown) => update({ props: { [key]: value } }, '调整' + clip.name);
  const isText = clip.kind === 'title' || clip.kind === 'caption',
    media = ['image', 'video', 'audio'].includes(clip.kind);
  const component = project.components.find((c) => c.id === clip.componentId);
  return (
    <div className="inspector">
      <div className="inspector-title">
        <div>
          <span className="eyebrow">
            {clip.kind === 'code' ? '可编程画面' : isText ? '文字' : clip.kind === 'audio' ? '音频' : '画面'}
          </span>
          <h3>{clip.name}</h3>
        </div>
        <IconButton
          label={clip.locked ? '解锁片段' : '锁定片段'}
          active={clip.locked}
          onClick={() => update({ locked: !clip.locked }, clip.locked ? '解锁片段' : '锁定片段')}
        >
          {clip.locked ? <Lock size={15} /> : <Unlock size={15} />}
        </IconButton>
      </div>
      {clip.locked && (
        <div className="lock-notice">
          <Lock size={12} /> 已锁定。Agent 与手动编辑都会保留它。
        </div>
      )}
      <section>
        <h4>时间</h4>
        <div className="field-row">
          <Field
            label="开始"
            type="number"
            value={Number((clip.start / sequence.fps).toFixed(2))}
            suffix="s"
            step={0.1}
            min={0}
            disabled={clip.locked}
            onCommit={(v) => update({ start: Math.max(0, Math.round(Number(v) * sequence.fps)) })}
          />
          <Field
            label="时长"
            type="number"
            value={Number((clip.duration / sequence.fps).toFixed(2))}
            suffix="s"
            step={0.1}
            min={1 / sequence.fps}
            disabled={clip.locked}
            onCommit={(v) => update({ duration: Math.max(1, Math.round(Number(v) * sequence.fps)) })}
          />
        </div>
        {media && clip.kind !== 'image' && (
          <Field
            label="原素材入点"
            type="number"
            value={Number((clip.sourceIn / sequence.fps).toFixed(2))}
            suffix="s"
            step={0.1}
            min={0}
            disabled={clip.locked}
            onCommit={(v) => update({ sourceIn: Math.round(Number(v) * sequence.fps) })}
          />
        )}
      </section>
      {isText && (
        <section>
          <h4>文字</h4>
          <Field
            key={clip.id + 'text'}
            label="文案"
            value={String(clip.props.text || '')}
            multiline
            disabled={clip.locked}
            onCommit={(v) => prop('text', v)}
          />
          {clip.kind === 'title' && (
            <Field
              label="副标题"
              value={String(clip.props.subtitle || '')}
              disabled={clip.locked}
              onCommit={(v) => prop('subtitle', v)}
            />
          )}
          <div className="field-row">
            <Field
              label="字号"
              type="number"
              value={Number(clip.props.fontSize || 72)}
              disabled={clip.locked}
              onCommit={(v) => prop('fontSize', Math.max(8, Number(v)))}
            />
            <label className="field">
              <span>颜色</span>
              <div className="color-field">
                <input
                  type="color"
                  aria-label="文字颜色"
                  value={
                    String(clip.props.color || '#ffffff').length === 7 ? String(clip.props.color) : '#ffffff'
                  }
                  disabled={clip.locked}
                  onChange={(e) => prop('color', e.target.value)}
                />
                <span>{String(clip.props.color || '#ffffff')}</span>
              </div>
            </label>
          </div>
          <label className="field">
            <span>位置</span>
            <select
              aria-label="文字位置"
              value={clip.props.position || 'center'}
              disabled={clip.locked}
              onChange={(e) => prop('position', e.target.value)}
            >
              <option value="top">上方</option>
              <option value="center">居中</option>
              <option value="bottom">下方</option>
            </select>
          </label>
          <label className="field">
            <span>入场动效</span>
            <select
              aria-label="入场动效"
              value={clip.props.animation || 'fade'}
              disabled={clip.locked}
              onChange={(e) => prop('animation', e.target.value)}
            >
              <option value="rise">缓缓浮现</option>
              <option value="fade">淡入淡出</option>
              <option value="type">逐字显现</option>
              <option value="none">无动效</option>
            </select>
          </label>
        </section>
      )}
      {media && clip.kind !== 'audio' && (
        <section>
          <h4>画面</h4>
          <label className="field">
            <span>适应画幅</span>
            <select
              aria-label="适应画幅"
              value={clip.props.fit || 'cover'}
              disabled={clip.locked}
              onChange={(e) => prop('fit', e.target.value)}
            >
              <option value="cover">填满画面</option>
              <option value="contain">完整显示</option>
            </select>
          </label>
          <Field
            label="缩放"
            type="number"
            value={Math.round(Number(clip.props.scale || 1) * 100)}
            suffix="%"
            disabled={clip.locked}
            onCommit={(v) => prop('scale', Math.max(0.1, Number(v) / 100))}
          />
          <div className="field-row">
            <Field
              label="水平偏移"
              type="number"
              value={Number(clip.props.x || 0)}
              disabled={clip.locked}
              onCommit={(v) => prop('x', Number(v))}
            />
            <Field
              label="垂直偏移"
              type="number"
              value={Number(clip.props.y || 0)}
              disabled={clip.locked}
              onCommit={(v) => prop('y', Number(v))}
            />
          </div>
        </section>
      )}
      {(clip.kind === 'audio' || clip.kind === 'video') && (
        <section>
          <h4>声音</h4>
          <Field
            label="音量"
            type="number"
            value={Math.round(Number(clip.props.volume ?? 1) * 100)}
            suffix="%"
            disabled={clip.locked}
            onCommit={(v) => prop('volume', Math.max(0, Math.min(2, Number(v) / 100)))}
          />
        </section>
      )}
      {component && (
        <section>
          <h4>
            组件参数 <span className="badge">CODE</span>
          </h4>
          {Object.entries({ ...component.props, ...clip.props })
            .filter(([k]) => !['opacity', 'scale', 'fit', 'volume'].includes(k))
            .map(([k, v]) =>
              typeof v === 'boolean' ? (
                <label className="check-field" key={k}>
                  <input
                    type="checkbox"
                    checked={v}
                    disabled={clip.locked}
                    onChange={(e) => prop(k, e.target.checked)}
                  />
                  {k}
                </label>
              ) : (
                <Field
                  key={k}
                  label={k}
                  value={String(v)}
                  type={typeof v === 'number' ? 'number' : 'text'}
                  disabled={clip.locked}
                  onCommit={(value) => prop(k, typeof v === 'number' ? Number(value) : value)}
                />
              ),
            )}
          <button className="button subtle full" onClick={onCode}>
            <Code2 size={14} /> 查看与编辑源码
          </button>
        </section>
      )}
      {clip.kind === 'shape' && (
        <section>
          <h4>背景</h4>
          <label className="field">
            <span>风格</span>
            <select
              value={String(clip.props.template || 'aurora')}
              disabled={clip.locked}
              onChange={(e) => prop('template', e.target.value)}
            >
              <option value="aurora">流动光晕</option>
              <option value="grid">动态网格</option>
              <option value="solid">纯色</option>
            </select>
          </label>
          <label className="field">
            <span>主色</span>
            <input
              type="color"
              aria-label="背景主色"
              value={String(clip.props.color || '#8faac2')}
              disabled={clip.locked}
              onChange={(e) => prop('color', e.target.value)}
            />
          </label>
        </section>
      )}
      <section className="inspector-actions">
        <button className="button full" onClick={onReference}>
          <ArrowUpRight size={14} /> 引用给 Agent
        </button>
        <div className="field-row">
          <button
            className="button subtle"
            onClick={() =>
              onEdit('复制片段', [
                {
                  type: 'addClip',
                  sequenceId: sequence.id,
                  clip: {
                    ...clone(clip),
                    id: uid('clip'),
                    name: clip.name + ' · 副本',
                    start: clip.start + clip.duration,
                    locked: false,
                  },
                },
              ])
            }
          >
            <Copy size={13} /> 复制
          </button>
          <button
            className="button subtle"
            disabled={clip.locked}
            onClick={() =>
              onEdit('删除片段', [{ type: 'deleteClip', sequenceId: sequence.id, clipId: clip.id }])
            }
          >
            <Trash2 size={13} /> 删除
          </button>
        </div>
      </section>
    </div>
  );
}
