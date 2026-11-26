import React, { useMemo, useRef, useState } from 'react';
import { Diamond, Plus, Trash2, X } from 'lucide-react';
import type {
  Clip,
  ClipKeyframe,
  EditOperation,
  KeyframeEasing,
  KeyframeProperty,
} from '../core/types';
import {
  KEYFRAME_EASING_OPTIONS,
  KEYFRAME_PROPERTY_LABELS,
  KEYFRAME_PROPERTY_RANGES,
  easingToDefaultBezier,
  evaluateKeyframeTrack,
  normalizeKeyframeTrack,
  removeClipKeyframe,
  upsertClipKeyframe,
} from '../core/keyframes';
import { isSpatialClip } from '../core/spatialStage';

export const CURVE_DRAWER_HEIGHT = 136;

export function availableCurvePropertiesForClip(clip: Clip): KeyframeProperty[] {
  if (clip.kind === 'audio') return ['volume'];
  const base: KeyframeProperty[] = ['opacity', 'scale', 'x', 'y', 'rotation'];
  if (clip.kind === 'video') base.push('volume');
  if (isSpatialClip(clip) || 'cameraYaw' in (clip.props || {})) {
    base.push('cameraYaw', 'cameraPitch', 'cameraDistance', 'cameraLens');
  }
  if (clip.keyframes) {
    for (const k of Object.keys(clip.keyframes) as KeyframeProperty[]) {
      if (!base.includes(k) && (clip.keyframes[k]?.length || 0) > 0) base.push(k);
    }
  }
  return base;
}

export function defaultCurvePropertyForClip(clip: Clip): KeyframeProperty {
  const avail = availableCurvePropertiesForClip(clip);
  if (clip.keyframes) {
    for (const p of avail) {
      if ((clip.keyframes[p]?.length || 0) > 0) return p;
    }
  }
  return avail[0] || 'opacity';
}

function formatPropValue(prop: KeyframeProperty, value: number): string {
  const spec = KEYFRAME_PROPERTY_RANGES[prop];
  const rounded = spec.step < 0.1 ? value.toFixed(2) : spec.step < 1 ? value.toFixed(1) : String(Math.round(value));
  return `${rounded}${spec.unit}`;
}

export function TimelineCurveHeader({
  clip,
  sequenceId,
  prop,
  selectedFrame,
  currentFrame,
  onChangeProp,
  onSelectFrame,
  onEdit,
  onClose,
}: {
  clip: Clip;
  sequenceId: string;
  prop: KeyframeProperty;
  selectedFrame: number | null;
  currentFrame: number;
  onChangeProp: (p: KeyframeProperty) => void;
  onSelectFrame: (f: number | null) => void;
  onEdit: (name: string, ops: EditOperation[]) => void;
  onClose: () => void;
}) {
  const props = availableCurvePropertiesForClip(clip);
  const points = normalizeKeyframeTrack(clip.keyframes?.[prop]);
  const selectedPt = selectedFrame !== null ? points.find((p) => p.frame === selectedFrame) : undefined;
  const localPlayhead = Math.max(0, Math.min(Math.max(0, clip.duration - 1), currentFrame - clip.start));
  const spec = KEYFRAME_PROPERTY_RANGES[prop];
  const baseVal = clip.props[prop] !== undefined ? Number(clip.props[prop]) : spec.defaultVal;
  const currentVal = evaluateKeyframeTrack(points, localPlayhead, baseVal);

  const handleAddAtPlayhead = () => {
    if (clip.locked) return;
    const nextKf = upsertClipKeyframe(clip.keyframes, prop, localPlayhead, currentVal, 'ease-in-out');
    onEdit(`添加「${KEYFRAME_PROPERTY_LABELS[prop]}」关键帧 F${localPlayhead}`, [
      { type: 'updateClip', sequenceId, clipId: clip.id, changes: { keyframes: nextKf } },
    ]);
    onSelectFrame(localPlayhead);
  };

  const handleDeleteSelected = () => {
    if (clip.locked || !selectedPt) return;
    const nextKf = removeClipKeyframe(clip.keyframes, prop, selectedPt.frame);
    onEdit(`删除「${KEYFRAME_PROPERTY_LABELS[prop]}」关键帧 F${selectedPt.frame}`, [
      { type: 'updateClip', sequenceId, clipId: clip.id, changes: { keyframes: nextKf } },
    ]);
    onSelectFrame(null);
  };

  const handleChangeEasing = (nextEasing: KeyframeEasing) => {
    if (clip.locked || !selectedPt) return;
    const nextBezier =
      nextEasing === 'bezier'
        ? selectedPt.bezier || easingToDefaultBezier(selectedPt.easing || 'ease-in-out')
        : undefined;
    const nextKf = upsertClipKeyframe(
      clip.keyframes,
      prop,
      selectedPt.frame,
      selectedPt.value,
      nextEasing,
      nextBezier,
    );
    onEdit(`调整关键帧缓动为「${KEYFRAME_EASING_OPTIONS.find((e) => e.id === nextEasing)?.label || nextEasing}」`, [
      { type: 'updateClip', sequenceId, clipId: clip.id, changes: { keyframes: nextKf } },
    ]);
  };

  return (
    <div className="kf-curve-header" style={{ height: CURVE_DRAWER_HEIGHT }}>
      <div className="kf-curve-header-top">
        <span className="kf-curve-title" title={`关键帧曲线 · ${clip.name}`}>
          <Diamond size={10} />
          <b>曲线</b>
        </span>
        <button
          type="button"
          className="track-head-btn"
          aria-label="收起关键帧曲线抽屉"
          title="收起曲线抽屉"
          onClick={onClose}
        >
          <X size={11} />
        </button>
      </div>

      <select
        className="kf-curve-prop-select"
        aria-label="选择关键帧曲线属性"
        value={prop}
        onChange={(e) => {
          onChangeProp(e.target.value as KeyframeProperty);
          onSelectFrame(null);
        }}
      >
        {props.map((p) => {
          const count = clip.keyframes?.[p]?.length || 0;
          return (
            <option key={p} value={p}>
              {count > 0 ? '◆ ' : ''}
              {KEYFRAME_PROPERTY_LABELS[p]}
              {count > 0 ? ` (${count})` : ''}
            </option>
          );
        })}
      </select>

      <div className="kf-curve-header-actions">
        <button
          type="button"
          className="kf-curve-mini-btn"
          disabled={clip.locked}
          title={`在当前播放头 (F${localPlayhead}) 添加关键帧`}
          onClick={handleAddAtPlayhead}
        >
          <Plus size={10} /> 打点
        </button>
        <button
          type="button"
          className="kf-curve-mini-btn danger"
          disabled={clip.locked || !selectedPt}
          title="删除当前选中的关键帧"
          onClick={handleDeleteSelected}
        >
          <Trash2 size={10} />
        </button>
      </div>

      {selectedPt ? (
        <select
          className="kf-curve-ease-select"
          aria-label="选中关键帧缓动模式"
          disabled={clip.locked}
          value={selectedPt.easing || 'ease-in-out'}
          onChange={(e) => handleChangeEasing(e.target.value as KeyframeEasing)}
        >
          {KEYFRAME_EASING_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <small className="kf-curve-hint">双击曲线加点 · 拖点调值</small>
      )}
    </div>
  );
}

export function TimelineCurveLane({
  clip,
  sequenceId,
  prop,
  totalFrames,
  selectedFrame,
  onSelectFrame,
  onSeek,
  onEndScrub,
  onEdit,
}: {
  clip: Clip;
  sequenceId: string;
  prop: KeyframeProperty;
  totalFrames: number;
  selectedFrame: number | null;
  onSelectFrame: (f: number | null) => void;
  onSeek: (frame: number, options?: { scrubbing?: boolean }) => void;
  onEndScrub?: (frame: number) => void;
  onEdit: (name: string, ops: EditOperation[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draftPoints, setDraftPoints] = useState<ClipKeyframe[] | null>(null);
  const [hud, setHud] = useState<string | null>(null);

  const spec = KEYFRAME_PROPERTY_RANGES[prop];
  const committedPoints = useMemo(() => normalizeKeyframeTrack(clip.keyframes?.[prop]), [clip.keyframes, prop]);
  const points = draftPoints ?? committedPoints;
  const maxLocalFrame = Math.max(1, clip.duration - 1);

  // Dynamic Y-domain: starts from property bounds, expands slightly if custom values exceed it
  const { minVal, maxVal } = useMemo(() => {
    let lo = spec.min;
    let hi = spec.max;
    // Keep narrow comfortable windows for scale/volume/opacity while allowing outliers
    if (prop === 'scale') {
      lo = 0.2;
      hi = 2.2;
    } else if (prop === 'volume') {
      lo = 0;
      hi = 1.5;
    }
    for (const pt of points) {
      if (pt.value < lo) lo = pt.value;
      if (pt.value > hi) hi = pt.value;
    }
    if (hi - lo < 1e-4) hi = lo + 1;
    return { minVal: lo, maxVal: hi };
  }, [spec, prop, points]);

  const PAD_TOP = 14;
  const PAD_BOT = 14;
  const VB_W = 1000;
  const VB_H = CURVE_DRAWER_HEIGHT;
  const usableH = VB_H - PAD_TOP - PAD_BOT;

  const frameToX = (f: number) => (Math.max(0, Math.min(maxLocalFrame, f)) / maxLocalFrame) * VB_W;
  const valToY = (v: number) => PAD_TOP + (1 - (v - minVal) / (maxVal - minVal)) * usableH;
  const xToFrame = (xNorm: number) => Math.max(0, Math.min(maxLocalFrame, Math.round(xNorm * maxLocalFrame)));
  const yToVal = (yPx: number) => {
    const ratio = 1 - (yPx - PAD_TOP) / usableH;
    const raw = minVal + Math.max(0, Math.min(1, ratio)) * (maxVal - minVal);
    const snapped = Math.round(raw / spec.step) * spec.step;
    return Number(Math.max(spec.min, Math.min(spec.max, snapped)).toFixed(3));
  };

  const baseDefault = clip.props[prop] !== undefined ? Number(clip.props[prop]) : spec.defaultVal;

  const { linePath, areaPath } = useMemo(() => {
    const samples = 110;
    const cmds: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const f = (i / samples) * maxLocalFrame;
      const v = evaluateKeyframeTrack(points, f, baseDefault);
      const x = frameToX(f);
      const y = Math.max(4, Math.min(VB_H - 4, valToY(v)));
      cmds.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const line = cmds.join(' ');
    const area = `${line} L${VB_W},${VB_H - PAD_BOT} L0,${VB_H - PAD_BOT} Z`;
    return { linePath: line, areaPath: area };
  }, [points, maxLocalFrame, baseDefault, minVal, maxVal]);

  const commitPoints = (label: string, nextPts: ClipKeyframe[]) => {
    const nextKeyframes = {
      ...(clip.keyframes || {}),
      [prop]: normalizeKeyframeTrack(nextPts),
    };
    onEdit(label, [{ type: 'updateClip', sequenceId, clipId: clip.id, changes: { keyframes: nextKeyframes } }]);
  };

  const handlePointDrag = (e: React.PointerEvent<HTMLElement>, pt: ClipKeyframe) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectFrame(pt.frame);
    onSeek(clip.start + pt.frame);
    if (clip.locked || !svgRef.current) return;

    const svgEl = svgRef.current;
    const rect = svgEl.getBoundingClientRect();
    let latestPts = points;
    let latestFrame = pt.frame;
    let latestVal = pt.value;
    const origFrame = pt.frame;

    const onMove = (ev: PointerEvent) => {
      const xNorm = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const yLocal = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * VB_H;
      latestFrame = xToFrame(xNorm);
      latestVal = yToVal(yLocal);
      const rest = committedPoints.filter((p) => p.frame !== origFrame && p.frame !== latestFrame);
      latestPts = normalizeKeyframeTrack([
        ...rest,
        { ...pt, frame: latestFrame, value: latestVal },
      ]);
      setDraftPoints(latestPts);
      onSelectFrame(latestFrame);
      setHud(`F${latestFrame} · ${formatPropValue(prop, latestVal)}`);
      onSeek(clip.start + latestFrame, { scrubbing: true });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setDraftPoints(null);
      setHud(null);
      onEndScrub?.(clip.start + latestFrame);
      if (latestFrame !== origFrame || latestVal !== pt.value) {
        commitPoints(`调整「${KEYFRAME_PROPERTY_LABELS[prop]}」关键帧 F${latestFrame}`, latestPts);
      }
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  const handleBezierDrag = (
    e: React.PointerEvent<HTMLElement>,
    segIdx: number,
    handle: 'out' | 'in',
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (clip.locked || !svgRef.current) return;
    const ptA = points[segIdx];
    const ptB = points[segIdx + 1];
    if (!ptA || !ptB) return;

    const svgEl = svgRef.current;
    const rect = svgEl.getBoundingClientRect();
    const xA = frameToX(ptA.frame);
    const xB = frameToX(ptB.frame);
    const yA = valToY(ptA.value);
    const yB = valToY(ptB.value);
    const dx = Math.max(1, xB - xA);
    const dy = yB - yA;
    const startBez: [number, number, number, number] =
      ptA.bezier || easingToDefaultBezier(ptA.easing || 'ease-in-out');
    let latestBez: [number, number, number, number] = [...startBez];
    let latestPts = points;

    const onMove = (ev: PointerEvent) => {
      const mx = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * VB_W;
      const my = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * VB_H;
      const nx = Math.max(0.02, Math.min(0.98, (mx - xA) / dx));
      const ny =
        Math.abs(dy) > 4
          ? Math.max(-0.8, Math.min(1.8, (my - yA) / dy))
          : Math.max(-0.5, Math.min(1.5, 0.5 - (my - yA) / 40));
      latestBez =
        handle === 'out'
          ? [Number(nx.toFixed(2)), Number(ny.toFixed(2)), latestBez[2], latestBez[3]]
          : [latestBez[0], latestBez[1], Number(nx.toFixed(2)), Number(ny.toFixed(2))];
      latestPts = committedPoints.map((p) =>
        p.frame === ptA.frame ? { ...p, easing: 'bezier' as const, bezier: latestBez } : p,
      );
      setDraftPoints(latestPts);
      setHud(`bezier(${latestBez.join(', ')})`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setDraftPoints(null);
      setHud(null);
      commitPoints(`微调「${KEYFRAME_PROPERTY_LABELS[prop]}」贝塞尔曲线`, latestPts);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  const handleSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    e.stopPropagation();
    if (clip.locked || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const yLocal = ((e.clientY - rect.top) / Math.max(1, rect.height)) * VB_H;
    const f = xToFrame(xNorm);
    const v = yToVal(yLocal);
    const nextKf = upsertClipKeyframe(clip.keyframes, prop, f, v, 'ease-in-out');
    onEdit(`添加「${KEYFRAME_PROPERTY_LABELS[prop]}」关键帧 F${f}`, [
      { type: 'updateClip', sequenceId, clipId: clip.id, changes: { keyframes: nextKf } },
    ]);
    onSelectFrame(f);
    onSeek(clip.start + f);
  };

  // Identify selected segment for rendering cubic-bezier tangent handles
  const selectedSegIdx = useMemo(() => {
    if (selectedFrame === null || points.length < 2) return -1;
    const idx = points.findIndex((p) => p.frame === selectedFrame);
    if (idx < 0) return -1;
    return idx < points.length - 1 ? idx : idx - 1;
  }, [selectedFrame, points]);

  const segA = selectedSegIdx >= 0 ? points[selectedSegIdx] : undefined;
  const segB = selectedSegIdx >= 0 ? points[selectedSegIdx + 1] : undefined;
  const showHandles = Boolean(segA && segB && segA.easing !== 'hold');

  let h1x = 0;
  let h1y = 0;
  let h2x = 0;
  let h2y = 0;
  if (showHandles && segA && segB) {
    const bez = segA.bezier || easingToDefaultBezier(segA.easing || 'ease-in-out');
    const xA = frameToX(segA.frame);
    const xB = frameToX(segB.frame);
    const yA = valToY(segA.value);
    const yB = valToY(segB.value);
    h1x = xA + bez[0] * (xB - xA);
    h1y = Math.max(6, Math.min(VB_H - 6, yA + bez[1] * (yB - yA)));
    h2x = xA + bez[2] * (xB - xA);
    h2y = Math.max(6, Math.min(VB_H - 6, yA + bez[3] * (yB - yA)));
  }

  return (
    <div
      className="kf-curve-lane"
      style={{ height: CURVE_DRAWER_HEIGHT }}
      aria-label={`关键帧曲线轨道 ${clip.name}`}
    >
      <div
        className="kf-curve-clip-box"
        style={{
          left: `${(clip.start / totalFrames) * 100}%`,
          width: `${(clip.duration / totalFrames) * 100}%`,
        }}
      >
        <div className="kf-curve-y-labels" aria-hidden="true">
          <span>{formatPropValue(prop, maxVal)}</span>
          <span>{formatPropValue(prop, (minVal + maxVal) / 2)}</span>
          <span>{formatPropValue(prop, minVal)}</span>
        </div>

        <svg
          ref={svgRef}
          className="kf-curve-svg"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          onDoubleClick={handleSvgDoubleClick}
        >
          {/* Horizontal guide lines */}
          <line x1={0} y1={PAD_TOP} x2={VB_W} y2={PAD_TOP} className="kf-grid-line" />
          <line
            x1={0}
            y1={PAD_TOP + usableH / 2}
            x2={VB_W}
            y2={PAD_TOP + usableH / 2}
            className="kf-grid-line mid"
          />
          <line x1={0} y1={VB_H - PAD_BOT} x2={VB_W} y2={VB_H - PAD_BOT} className="kf-grid-line" />

          {/* Curve fill + stroke */}
          <path d={areaPath} className="kf-curve-area" />
          <path d={linePath} className="kf-curve-stroke" vectorEffect="non-scaling-stroke" />

          {/* Cubic-Bezier Tangent Lines for selected segment */}
          {showHandles && segA && segB && (
            <g className="kf-bezier-handles">
              <line
                x1={frameToX(segA.frame)}
                y1={valToY(segA.value)}
                x2={h1x}
                y2={h1y}
                className="kf-tangent-line"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={frameToX(segB.frame)}
                y1={valToY(segB.value)}
                x2={h2x}
                y2={h2y}
                className="kf-tangent-line"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </svg>

        {/* Aspect-ratio-independent HTML Bezier control handles */}
        {showHandles && segA && segB && (
          <>
            <button
              type="button"
              className="kf-handle-dot"
              style={{ left: `${(h1x / VB_W) * 100}%`, top: `${(h1y / VB_H) * 100}%` }}
              aria-label="出点贝塞尔手柄"
              title="拖动调整出点贝塞尔曲线"
              onPointerDown={(e) => handleBezierDrag(e, selectedSegIdx, 'out')}
            />
            <button
              type="button"
              className="kf-handle-dot"
              style={{ left: `${(h2x / VB_W) * 100}%`, top: `${(h2y / VB_H) * 100}%` }}
              aria-label="入点贝塞尔手柄"
              title="拖动调整入点贝塞尔曲线"
              onPointerDown={(e) => handleBezierDrag(e, selectedSegIdx, 'in')}
            />
          </>
        )}

        {/* Aspect-ratio-independent HTML Diamond Keyframe Nodes */}
        {points.map((pt) => {
          const x = frameToX(pt.frame);
          const y = valToY(pt.value);
          const isSel = selectedFrame === pt.frame;
          return (
            <button
              key={pt.frame}
              type="button"
              className={`kf-curve-node ${isSel ? 'selected' : ''}`}
              style={{ left: `${(x / VB_W) * 100}%`, top: `${(y / VB_H) * 100}%` }}
              aria-label={`曲线关键帧 F${pt.frame}`}
              title={`F${pt.frame} · ${formatPropValue(prop, pt.value)}（拖拽改时间与数值）`}
              onPointerDown={(e) => handlePointDrag(e, pt)}
            />
          );
        })}

        {hud && <div className="kf-curve-hud">{hud}</div>}
      </div>
    </div>
  );
}
