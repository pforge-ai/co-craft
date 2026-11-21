import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Lock, Move, RotateCcw } from 'lucide-react';
import { pointerDrag } from '../lib/pointerDrag';
import { getPreset } from '../core/presets';
import type { Clip, EditOperation, Project, Sequence } from '../core/types';

export interface StageDomBox {
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

export interface StageOverlayProps {
  project?: Project;
  sequence: Sequence;
  frame: number;
  playing: boolean;
  scrubbing?: boolean;
  selectedId: string | null;
  pinMode: boolean;
  activePin?: { x: number; y: number; frame: number };
  domBoxes?: Record<string, StageDomBox>;
  onLiveTransform?: (override: { clipId: string; props: Record<string, unknown> } | null) => void;
  onSelect: (id: string | null) => void;
  onEdit: (name: string, ops: EditOperation[]) => void;
  onPin: (pin: { x: number; y: number; frame: number; clipId?: string }) => void;
}

interface StageBox {
  left: number;
  top: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

function textVisualEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    em += /[\u0000-\u00ff]/.test(ch) ? 0.58 : 1.02;
  }
  return Math.max(2, em);
}

function isEditableTextClip(clip: Clip): boolean {
  if (clip.locked) return false;
  if (clip.kind === 'title' || clip.kind === 'caption') return true;
  const presetId = String(clip.props.presetId || '');
  if (!presetId) return false;
  return Boolean(getPreset(presetId)?.parameters.some((p) => p.key === 'text'));
}

function computeClipStageBox(
  clip: Clip,
  stageW: number,
  stageH: number,
  pxRatio: number,
  seqWidth: number,
  override?: { x: number; y: number; scale: number },
): StageBox {
  const presetId = String(clip.props.presetId || '');
  const x = override?.x ?? Number(clip.props.x || 0);
  const y = override?.y ?? Number(clip.props.y || 0);
  const scale = override?.scale ?? Number(clip.props.scale || 1);

  if (presetId === 'lower-third') {
    const width = Math.min(stageW * 1.3, Math.max(100, stageW * 0.44 * scale));
    const height = Math.min(stageH * 0.9, Math.max(32, stageH * 0.14 * scale));
    const cx = stageW * 0.27 + x / pxRatio;
    const cy = stageH * 0.83 + y / pxRatio;
    return { left: cx - width / 2, top: cy - height / 2, width, height, cx, cy };
  }

  const isPlainText = !presetId && (clip.kind === 'title' || clip.kind === 'caption');
  if (!isPlainText) {
    const width = Math.min(stageW * 1.5, Math.max(48, stageW * scale));
    const height = Math.min(stageH * 1.5, Math.max(36, stageH * scale));
    const cx = stageW * 0.5 + x / pxRatio;
    const cy = stageH * 0.5 + y / pxRatio;
    return { left: cx - width / 2, top: cy - height / 2, width, height, cx, cy };
  }

  const isCap = clip.kind === 'caption';
  const fontSize = Number(clip.props.fontSize || (isCap ? 48 : 88));
  const editorial = clip.props.template === 'editorial';
  const text = String(clip.props.text || clip.name || '文字');
  const lines = text.split('\n');
  const maxEm = Math.max(...lines.map(textVisualEm), 2);
  const sub = clip.props.subtitle ? String(clip.props.subtitle) : '';
  const subEm = sub ? textVisualEm(sub) * 0.34 : 0;
  const maxCompW = seqWidth * 0.85;
  const rawW = Math.max(maxEm * fontSize * (editorial ? 1.04 : 1), subEm * fontSize) + (isCap ? 64 : 44);
  const compW = Math.min(maxCompW, Math.max(fontSize * 2.4, rawW));
  const wrapLines = lines.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil((textVisualEm(line) * fontSize) / Math.max(40, compW - 44))),
    0,
  );
  const subH = sub ? fontSize * (editorial ? 0.65 : 0.55) : 0;
  const compH = wrapLines * fontSize * 1.32 + subH + (isCap ? 32 : 24);

  const width = Math.min(stageW * 1.35, Math.max(44, (compW / pxRatio) * scale));
  const height = Math.min(stageH * 1.35, Math.max(24, (compH / pxRatio) * scale));

  const padX = stageW * 0.075;
  const padY = stageH * 0.09;
  const align = String(clip.props.align || 'center');
  const pos = String(clip.props.position || (isCap ? 'bottom' : 'center'));

  const anchorX =
    align === 'left' ? padX + width / 2 : align === 'right' ? stageW - padX - width / 2 : stageW * 0.5;
  const anchorY =
    pos === 'top' ? padY + height / 2 : pos === 'bottom' ? stageH - padY - height / 2 : stageH * 0.5;

  const cx = anchorX + x / pxRatio;
  const cy = anchorY + y / pxRatio;
  return { left: cx - width / 2, top: cy - height / 2, width, height, cx, cy };
}

export function StageOverlay({
  project,
  sequence,
  frame,
  playing,
  scrubbing = false,
  selectedId,
  pinMode,
  activePin,
  domBoxes,
  onLiveTransform,
  onSelect,
  onEdit,
  onPin,
}: StageOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [liveTransform, setLiveTransform] = useState<{
    clipId: string;
    x: number;
    y: number;
    scale: number;
    snapX: boolean;
    snapY: boolean;
  } | null>(null);
  const [liveOrbit, setLiveOrbit] = useState<{
    clipId: string;
    yaw: number;
    pitch: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setBounds({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (playing || scrubbing || editingClipId !== selectedId) {
      setEditingClipId(null);
    }
  }, [playing, scrubbing, selectedId, editingClipId]);

  if (playing || scrubbing || sequence.clips.length === 0) {
    return (
      <div
        ref={containerRef}
        className="stage-overlay"
        style={{ pointerEvents: 'none' }}
        aria-hidden="true"
      />
    );
  }

  const muted = new Set(sequence.mutedTracks || []);
  const trackOrder = { visual: 0, audio: 1, overlay: 2, caption: 3 };
  const visibleAtFrame = sequence.clips
    .filter(
      (c) =>
        c.kind !== 'audio' &&
        !muted.has(c.track) &&
        frame >= c.start &&
        frame < c.start + c.duration,
    )
    .sort(
      (a, b) =>
        trackOrder[b.track] - trackOrder[a.track] ||
        (b.layer ?? 0) - (a.layer ?? 0) ||
        b.start - a.start,
    );

  const selectedClip = visibleAtFrame.find((c) => c.id === selectedId);
  const editingClip = editingClipId ? visibleAtFrame.find((c) => c.id === editingClipId) : undefined;
  const linkedAsset = selectedClip?.assetId ? project?.assets.find((a) => a.id === selectedClip.assetId) : undefined;
  const presetId = String(selectedClip?.props.presetId || '');
  const is3DStage = Boolean(selectedClip && (presetId === 'teardown-3d' || linkedAsset?.kind === 'model-3d'));

  // Compute fitted stage rectangle inside preview container
  const aspect = sequence.width / sequence.height;
  let stageW = bounds.width;
  let stageH = bounds.width / aspect;
  if (stageH > bounds.height) {
    stageH = bounds.height;
    stageW = bounds.height * aspect;
  }
  const stageLeft = (bounds.width - stageW) / 2;
  const stageTop = (bounds.height - stageH) / 2;
  const pxRatio = stageW > 0 ? sequence.width / stageW : 1;

  const boxForClip = (c: Clip): StageBox => {
    const measured = domBoxes?.[c.id];
    if (measured && stageW > 0 && stageH > 0) {
      const left = measured.nx * stageW;
      const top = measured.ny * stageH;
      const width = Math.max(20, measured.nw * stageW);
      const height = Math.max(16, measured.nh * stageH);
      return { left, top, width, height, cx: left + width / 2, cy: top + height / 2 };
    }
    const isLive = Boolean(liveTransform && liveTransform.clipId === c.id);
    return computeClipStageBox(
      c,
      stageW,
      stageH,
      pxRatio,
      sequence.width,
      isLive
        ? { x: liveTransform!.x, y: liveTransform!.y, scale: liveTransform!.scale }
        : undefined,
    );
  };

  const hitTestClips = (lx: number, ly: number): Clip[] => {
    if (lx < 0 || ly < 0 || lx > stageW || ly > stageH) return [];
    const hits: Clip[] = [];
    for (const c of visibleAtFrame) {
      const b = boxForClip(c);
      if (lx >= b.left && lx <= b.left + b.width && ly >= b.top && ly <= b.top + b.height) {
        hits.push(c);
      }
    }
    return hits;
  };

  const beginMove = (e: React.PointerEvent<HTMLElement>, clip: Clip) => {
    if (pinMode) return;
    e.stopPropagation();
    if (clip.locked) return;
    const clipAsset = clip.assetId ? project?.assets.find((a) => a.id === clip.assetId) : undefined;
    const orbit3D = clip.props.presetId === 'teardown-3d' || clipAsset?.kind === 'model-3d';
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    if (orbit3D) {
      const origYaw = Number(clip.props.cameraYaw || 0);
      const origPitch = Number(clip.props.cameraPitch || 0);
      let nextYaw = origYaw;
      let nextPitch = origPitch;
      let moved = false;
      cleanupRef.current?.();
      cleanupRef.current = pointerDrag(
        e,
        (cx, cy) => {
          if (Math.hypot(cx - startClientX, cy - startClientY) > 2) moved = true;
          if (!moved) return;
          const wrapYaw = Math.round(origYaw + (cx - startClientX) * 0.45);
          nextYaw = Math.max(-180, Math.min(180, wrapYaw));
          nextPitch = Math.max(-60, Math.min(60, Math.round(origPitch + (cy - startClientY) * 0.35)));
          setLiveOrbit({ clipId: clip.id, yaw: nextYaw, pitch: nextPitch });
        },
        () => {
          setLiveOrbit(null);
          if (moved && (nextYaw !== origYaw || nextPitch !== origPitch)) {
            onEdit(`旋转三维视角「${clip.name}」`, [
              {
                type: 'updateClip',
                sequenceId: sequence.id,
                clipId: clip.id,
                changes: { props: { cameraYaw: nextYaw, cameraPitch: nextPitch } },
              },
            ]);
          }
        },
        'grabbing',
      );
      return;
    }
    const origX = Number(clip.props.x || 0);
    const origY = Number(clip.props.y || 0);
    const origScale = Number(clip.props.scale || 1);
    let nextX = origX;
    let nextY = origY;
    let moved = false;
    cleanupRef.current?.();
    cleanupRef.current = pointerDrag(
      e,
      (cx, cy) => {
        if (Math.hypot(cx - startClientX, cy - startClientY) > 2) moved = true;
        if (!moved) return;
        let rawX = Math.round(origX + (cx - startClientX) * pxRatio);
        let rawY = Math.round(origY + (cy - startClientY) * pxRatio);
        const snapThreshold = Math.max(8, Math.round(6 * pxRatio));
        const snapX = !e.shiftKey && Math.abs(rawX) <= snapThreshold;
        const snapY = !e.shiftKey && Math.abs(rawY) <= snapThreshold;
        if (snapX) rawX = 0;
        if (snapY) rawY = 0;
        nextX = rawX;
        nextY = rawY;
        setLiveTransform({ clipId: clip.id, x: nextX, y: nextY, scale: origScale, snapX, snapY });
        onLiveTransform?.({ clipId: clip.id, props: { x: nextX, y: nextY } });
      },
      () => {
        setLiveTransform(null);
        if (moved && (nextX !== origX || nextY !== origY)) {
          onEdit(`移动画面「${clip.name}」`, [
            {
              type: 'updateClip',
              sequenceId: sequence.id,
              clipId: clip.id,
              changes: { props: { x: nextX, y: nextY } },
            },
          ]);
        } else {
          onLiveTransform?.(null);
        }
      },
      'move',
    );
  };

  const beginScale = (e: React.PointerEvent<HTMLElement>, clip: Clip, signX: number, signY: number) => {
    e.stopPropagation();
    if (clip.locked) return;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origX = Number(clip.props.x || 0);
    const origY = Number(clip.props.y || 0);
    const origScale = Number(clip.props.scale || 1);
    let nextScale = origScale;
    cleanupRef.current?.();
    cleanupRef.current = pointerDrag(
      e,
      (cx, cy) => {
        const dx = (cx - startClientX) * signX;
        const dy = (cy - startClientY) * signY;
        const delta = (dx + dy) / Math.max(120, stageW * 0.45);
        let candidate = Math.max(0.15, Math.min(4, Math.round((origScale + delta) * 100) / 100));
        if (!e.shiftKey && Math.abs(candidate - 1) <= 0.03) candidate = 1;
        nextScale = candidate;
        setLiveTransform({
          clipId: clip.id,
          x: origX,
          y: origY,
          scale: nextScale,
          snapX: false,
          snapY: false,
        });
        onLiveTransform?.({ clipId: clip.id, props: { scale: nextScale } });
      },
      () => {
        setLiveTransform(null);
        if (nextScale !== origScale) {
          onEdit(`缩放画面「${clip.name}」`, [
            {
              type: 'updateClip',
              sequenceId: sequence.id,
              clipId: clip.id,
              changes: { props: { scale: nextScale } },
            },
          ]);
        } else {
          onLiveTransform?.(null);
        }
      },
      signX * signY > 0 ? 'nwse-resize' : 'nesw-resize',
    );
  };

  const getLocalCoords = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { lx: -1, ly: -1 };
    return {
      lx: clientX - rect.left - stageLeft,
      ly: clientY - rect.top - stageTop,
    };
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stageW <= 0 || stageH <= 0 || pinMode) return;
    if ((e.target as HTMLElement).closest('.stage-gizmo-badge, .stage-handle, .stage-inline-editor')) return;
    if (editingClipId) return;

    const { lx, ly } = getLocalCoords(e.clientX, e.clientY);
    if (lx < 0 || ly < 0 || lx > stageW || ly > stageH) {
      onSelect(null);
      return;
    }

    const hits = hitTestClips(lx, ly);
    if (!hits.length) {
      onSelect(null);
      return;
    }

    let target = hits[0];
    if (e.altKey && selectedClip) {
      const curIdx = hits.findIndex((c) => c.id === selectedClip.id);
      if (curIdx >= 0 && hits.length > 1) {
        target = hits[(curIdx + 1) % hits.length];
      }
    }

    if (target.id !== selectedId) {
      onSelect(target.id);
    }
    beginMove(e, target);
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (stageW <= 0 || stageH <= 0 || !pinMode) return;
    const { lx, ly } = getLocalCoords(e.clientX, e.clientY);
    if (lx < 0 || ly < 0 || lx > stageW || ly > stageH) return;
    const xPct = Math.round((lx / stageW) * 1000) / 10;
    const yPct = Math.round((ly / stageH) * 1000) / 10;
    const hits = hitTestClips(lx, ly);
    onPin({ x: xPct, y: yPct, frame, clipId: (hits[0] || selectedClip)?.id });
  };

  const handleStageDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (pinMode || stageW <= 0 || stageH <= 0) return;
    const { lx, ly } = getLocalCoords(e.clientX, e.clientY);
    const hits = hitTestClips(lx, ly);
    const target = hits.find(isEditableTextClip);
    if (!target) return;
    e.stopPropagation();
    onSelect(target.id);
    setEditingClipId(target.id);
    setEditDraft(String(target.props.text || ''));
  };

  const commitInlineEdit = (target: Clip) => {
    setEditingClipId(null);
    if (editDraft !== String(target.props.text || '')) {
      onEdit(`修改文字「${target.name}」`, [
        {
          type: 'updateClip',
          sequenceId: sequence.id,
          clipId: target.id,
          changes: { props: { text: editDraft } },
        },
      ]);
    }
  };

  const isLive = !!(liveTransform && selectedClip && liveTransform.clipId === selectedClip.id);
  const isOrbitLive = !!(liveOrbit && selectedClip && liveOrbit.clipId === selectedClip.id);
  const activeX = isLive ? liveTransform!.x : Number(selectedClip?.props.x || 0);
  const activeY = isLive ? liveTransform!.y : Number(selectedClip?.props.y || 0);
  const activeScale = isLive ? liveTransform!.scale : Number(selectedClip?.props.scale || 1);
  const activeYaw = isOrbitLive ? liveOrbit!.yaw : Number(selectedClip?.props.cameraYaw || 0);
  const activePitch = isOrbitLive ? liveOrbit!.pitch : Number(selectedClip?.props.cameraPitch || 0);

  const selectedBox = selectedClip ? boxForClip(selectedClip) : null;
  const hoveredClip =
    hoveredId && hoveredId !== selectedId ? visibleAtFrame.find((c) => c.id === hoveredId) : undefined;
  const hoveredBox = hoveredClip && !pinMode ? boxForClip(hoveredClip) : null;
  const editingBox = editingClip ? boxForClip(editingClip) : null;

  return (
    <div
      ref={containerRef}
      className={`stage-overlay ${pinMode ? 'pin-mode' : ''}`}
      onPointerDown={handleStagePointerDown}
      onPointerMove={(e) => {
        if (stageW <= 0 || stageH <= 0 || pinMode || editingClipId) return;
        const { lx, ly } = getLocalCoords(e.clientX, e.clientY);
        const hits = hitTestClips(lx, ly);
        setHoveredId(hits[0]?.id ?? null);
      }}
      onPointerLeave={() => setHoveredId(null)}
      onClick={handleStageClick}
      onDoubleClick={handleStageDoubleClick}
      aria-label="预览舞台直接操控层"
    >
      {stageW > 0 && stageH > 0 && (
        <div
          className="stage-viewport"
          style={{ left: stageLeft, top: stageTop, width: stageW, height: stageH }}
        >
          {liveTransform?.snapX && <i className="stage-snap-line vertical" />}
          {liveTransform?.snapY && <i className="stage-snap-line horizontal" />}

          {activePin && activePin.frame === frame && (
            <div
              className="stage-pin-marker"
              style={{ left: `${activePin.x}%`, top: `${activePin.y}%` }}
              title={`画面锚点 (${activePin.x}%, ${activePin.y}%)`}
            >
              <Crosshair size={12} />
            </div>
          )}

          {hoveredBox && (
            <div
              className="stage-hover-box"
              style={{
                left: hoveredBox.left,
                top: hoveredBox.top,
                width: hoveredBox.width,
                height: hoveredBox.height,
              }}
            />
          )}

          {selectedClip && selectedBox && !pinMode && (
            <div
              className={`stage-gizmo ${selectedClip.locked ? 'locked' : ''}`}
              style={{
                left: selectedBox.left,
                top: selectedBox.top,
                width: selectedBox.width,
                height: selectedBox.height,
              }}
            >
              <div
                className={`stage-gizmo-badge ${
                  selectedBox.height > stageH * 0.85 ? 'inside' : selectedBox.top < 26 ? 'below' : 'above'
                }`}
              >
                {selectedClip.locked ? <Lock size={10} /> : <Move size={10} />}
                <span>{selectedClip.name}</span>
                {is3DStage ? (
                  <small>
                    视角 {Math.round(activeYaw)}° / {Math.round(activePitch)}°
                    {isOrbitLive ? '' : ' · 拖拽旋转'}
                  </small>
                ) : (
                  (activeX !== 0 || activeY !== 0 || activeScale !== 1) && (
                    <small>
                      {activeX},{activeY} · {Math.round(activeScale * 100)}%
                    </small>
                  )
                )}
                {!selectedClip.locked &&
                  (is3DStage
                    ? activeYaw !== 0 ||
                      activePitch !== 0 ||
                      activeX !== 0 ||
                      activeY !== 0 ||
                      activeScale !== 1
                    : activeX !== 0 || activeY !== 0 || activeScale !== 1) && (
                    <button
                      type="button"
                      className="stage-gizmo-reset"
                      title={is3DStage ? '重置三维视角与变换' : '重置位置与缩放'}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(`重置「${selectedClip.name}」${is3DStage ? '视角' : '变换'}`, [
                          {
                            type: 'updateClip',
                            sequenceId: sequence.id,
                            clipId: selectedClip.id,
                            changes: {
                              props: is3DStage
                                ? { x: 0, y: 0, scale: 1, cameraYaw: 0, cameraPitch: 0 }
                                : { x: 0, y: 0, scale: 1 },
                            },
                          },
                        ]);
                      }}
                    >
                      <RotateCcw size={10} />
                    </button>
                  )}
              </div>
              {!selectedClip.locked && !is3DStage && (
                <>
                  <span
                    className="stage-handle nw"
                    onPointerDown={(e) => beginScale(e, selectedClip, -1, -1)}
                  />
                  <span
                    className="stage-handle ne"
                    onPointerDown={(e) => beginScale(e, selectedClip, 1, -1)}
                  />
                  <span
                    className="stage-handle sw"
                    onPointerDown={(e) => beginScale(e, selectedClip, -1, 1)}
                  />
                  <span
                    className="stage-handle se"
                    onPointerDown={(e) => beginScale(e, selectedClip, 1, 1)}
                  />
                </>
              )}
            </div>
          )}

          {editingClip && editingBox && (
            <textarea
              autoFocus
              className="stage-inline-editor"
              aria-label={`原地编辑 ${editingClip.name}`}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => commitInlineEdit(editingClip)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                  setEditingClipId(null);
                  return;
                }
                if (
                  ((e.metaKey || e.ctrlKey) && e.key === 'Enter') ||
                  (editingClip.kind === 'caption' && e.key === 'Enter' && !e.shiftKey)
                ) {
                  e.preventDefault();
                  commitInlineEdit(editingClip);
                }
              }}
              style={{
                left: Math.max(4, Math.min(stageW - Math.max(110, editingBox.width) - 4, editingBox.left)),
                top: Math.max(4, Math.min(stageH - Math.max(36, editingBox.height) - 4, editingBox.top)),
                width: Math.max(110, editingBox.width),
                height: Math.max(36, editingBox.height),
                fontSize: Math.max(
                  12,
                  Math.round(
                    (Number(editingClip.props.fontSize || (editingClip.kind === 'caption' ? 48 : 88)) / pxRatio) *
                      Number(editingClip.props.scale || 1),
                  ),
                ),
                textAlign: (editingClip.props.align as 'left' | 'center' | 'right') || 'center',
                color: String(editingClip.props.color || '#f4f0e8'),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
