import React, { useMemo, useRef, useState } from 'react';
import { Compass, X } from 'lucide-react';
import {
  computeActorPathState,
  computeSpatialCameraPose,
  kelvinToHex,
  type SpatialActorPath,
  type SpatialCameraBookmark,
  type SpatialStageObject,
} from '../core/spatialStage';

export interface StageRadarOverlayProps {
  sceneType: string;
  isPortrait: boolean;
  is25D: boolean;
  timeSec: number;
  durationSec: number;
  cameraPreset: string;
  liveCamera: {
    yaw: number;
    pitch: number;
    distance: number;
    panX: number;
    panY: number;
    lens: number;
  };
  bookmarks: SpatialCameraBookmark[];
  activeBookmarkId?: string;
  stageObjects: SpatialStageObject[];
  selectedObjectId: string | null;
  actorPath: SpatialActorPath;
  actorStartX?: number;
  actorStartZ?: number;
  actorEndX?: number;
  actorEndZ?: number;
  onSelectBookmark: (bm: SpatialCameraBookmark) => void;
  onSelectObject: (id: string | null) => void;
  onPreviewStagePatch: (patch: Record<string, unknown>) => void;
  onCommitStagePatch: (label: string, patch: Record<string, unknown>) => void;
  onClose: () => void;
}

const WORLD_SPAN = 5.5; // -5.5 .. +5.5 meters
const VB_W = 220;
const VB_H = 176;
const CX = VB_W / 2;
const CY = VB_H / 2;
const SCALE_X = (VB_W - 24) / (WORLD_SPAN * 2);
const SCALE_Z = (VB_H - 22) / (WORLD_SPAN * 2);

const toSvgX = (wx: number) => CX + Math.max(-WORLD_SPAN, Math.min(WORLD_SPAN, wx)) * SCALE_X;
const toSvgY = (wz: number) => CY + Math.max(-WORLD_SPAN, Math.min(WORLD_SPAN, wz)) * SCALE_Z;

function cameraConePoints(pos: [number, number, number], tgt: [number, number, number], fov: number, len = 1.55) {
  const sx = toSvgX(pos[0]);
  const sy = toSvgY(pos[2]);
  const dx = tgt[0] - pos[0];
  const dz = tgt[2] - pos[2];
  const baseAngle = Math.atan2(dz, dx);
  const halfAngle = Math.max(0.16, Math.min(0.7, ((fov * Math.PI) / 180) * 0.52));
  const lx = sx + Math.cos(baseAngle - halfAngle) * len * SCALE_X;
  const ly = sy + Math.sin(baseAngle - halfAngle) * len * SCALE_Z;
  const rx = sx + Math.cos(baseAngle + halfAngle) * len * SCALE_X;
  const ry = sy + Math.sin(baseAngle + halfAngle) * len * SCALE_Z;
  return {
    sx,
    sy,
    polygon: `${sx.toFixed(1)},${sy.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)} ${rx.toFixed(1)},${ry.toFixed(1)}`,
  };
}

export function StageRadarOverlay({
  sceneType,
  isPortrait,
  is25D,
  timeSec,
  durationSec,
  cameraPreset,
  liveCamera,
  bookmarks,
  activeBookmarkId,
  stageObjects,
  selectedObjectId,
  actorPath,
  actorStartX,
  actorStartZ,
  actorEndX,
  actorEndZ,
  onSelectBookmark,
  onSelectObject,
  onPreviewStagePatch,
  onCommitStagePatch,
  onClose,
}: StageRadarOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragHud, setDragHud] = useState<string | null>(null);
  const [draftObjects, setDraftObjects] = useState<SpatialStageObject[] | null>(null);
  const [draftHeroPath, setDraftHeroPath] = useState<{
    sx: number;
    sz: number;
    ex: number;
    ez: number;
  } | null>(null);

  const visibleObjects = draftObjects ?? stageObjects;
  const hasBuiltInHero = sceneType === 'previs-blocking';

  const heroPathState = useMemo(() => {
    if (!hasBuiltInHero) return null;
    const customStart: [number, number] | undefined =
      draftHeroPath
        ? [draftHeroPath.sx, draftHeroPath.sz]
        : actorStartX !== undefined && actorStartZ !== undefined
          ? [actorStartX, actorStartZ]
          : undefined;
    const customEnd: [number, number] | undefined =
      draftHeroPath
        ? [draftHeroPath.ex, draftHeroPath.ez]
        : actorEndX !== undefined && actorEndZ !== undefined
          ? [actorEndX, actorEndZ]
          : undefined;
    return computeActorPathState({
      path: actorPath,
      time: timeSec,
      durationSec,
      baseX: -1.15,
      baseZ: 0.95,
      baseYaw: Math.PI * 0.68,
      customStart,
      customEnd,
    });
  }, [hasBuiltInHero, actorPath, timeSec, durationSec, actorStartX, actorStartZ, actorEndX, actorEndZ, draftHeroPath]);

  const livePose = useMemo(
    () =>
      computeSpatialCameraPose({
        preset: cameraPreset,
        time: timeSec,
        speed: 1,
        isPortrait,
        is25D,
        lensMm: liveCamera.lens,
        yaw: liveCamera.yaw,
        pitch: liveCamera.pitch,
        distance: liveCamera.distance,
        panX: liveCamera.panX,
        panY: liveCamera.panY,
      }),
    [cameraPreset, timeSec, isPortrait, is25D, liveCamera],
  );

  const bookmarkCones = useMemo(
    () =>
      bookmarks.map((bm) => {
        const pose = computeSpatialCameraPose({
          preset: bm.cameraPreset,
          time: 0,
          speed: 1,
          isPortrait,
          is25D,
          lensMm: bm.cameraLens,
          yaw: bm.cameraYaw,
          pitch: bm.cameraPitch,
          distance: bm.cameraDistance,
          panX: bm.cameraPanX ?? 0,
          panY: bm.cameraPanY ?? 0,
        });
        return { bm, cone: cameraConePoints(pose.position, pose.target, pose.fov, 1.3) };
      }),
    [bookmarks, isPortrait, is25D],
  );

  const liveCone = useMemo(
    () => cameraConePoints(livePose.position, livePose.target, livePose.fov, 1.7),
    [livePose],
  );

  const clientToWorldXZ = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    const vx = ((clientX - rect.left) / Math.max(1, rect.width)) * VB_W;
    const vy = ((clientY - rect.top) / Math.max(1, rect.height)) * VB_H;
    const wx = Math.max(-5.2, Math.min(5.2, (vx - CX) / SCALE_X));
    const wz = Math.max(-5.2, Math.min(5.2, (vy - CY) / SCALE_Z));
    return [Number(wx.toFixed(2)), Number(wz.toFixed(2))];
  };

  const startObjectDrag = (
    e: React.PointerEvent<SVGElement>,
    objId: string,
    mode: 'position' | 'endPosition',
  ) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectObject(objId);
    const pointerId = e.pointerId;
    let latestList = stageObjects;
    let changed = false;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const [wx, wz] = clientToWorldXZ(ev.clientX, ev.clientY);
      latestList = stageObjects.map((item) => {
        if (item.id !== objId) return item;
        if (mode === 'endPosition') {
          return { ...item, endPosition: [wx, item.endPosition?.[1] ?? 0, wz] as [number, number, number] };
        }
        return { ...item, position: [wx, item.position[1], wz] as [number, number, number] };
      });
      changed = true;
      setDraftObjects(latestList);
      setDragHud(`${mode === 'endPosition' ? '终点' : '摆位'} X:${wx.toFixed(1)} Z:${wz.toFixed(1)}`);
      onPreviewStagePatch({ stageObjects: latestList });
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setDraftObjects(null);
      setDragHud(null);
      if (changed) {
        onCommitStagePatch(mode === 'endPosition' ? '在俯视图调整演员终点' : '在俯视图调整物体摆位', {
          stageObjects: latestList,
        });
      }
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  const startHeroWaypointDrag = (e: React.PointerEvent<SVGElement>, which: 'start' | 'end') => {
    if (!heroPathState) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectObject('__hero__');
    const pointerId = e.pointerId;
    let latest = {
      sx: heroPathState.startX,
      sz: heroPathState.startZ,
      ex: heroPathState.endX,
      ez: heroPathState.endZ,
    };
    let changed = false;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const [wx, wz] = clientToWorldXZ(ev.clientX, ev.clientY);
      latest = which === 'start' ? { ...latest, sx: wx, sz: wz } : { ...latest, ex: wx, ez: wz };
      changed = true;
      setDraftHeroPath(latest);
      setDragHud(`主角${which === 'start' ? '起点' : '终点'} X:${wx.toFixed(1)} Z:${wz.toFixed(1)}`);
      onPreviewStagePatch({
        actorStartX: latest.sx,
        actorStartZ: latest.sz,
        actorEndX: latest.ex,
        actorEndZ: latest.ez,
      });
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setDraftHeroPath(null);
      setDragHud(null);
      if (changed) {
        onCommitStagePatch('在俯视图调整主角走位路线', {
          actorStartX: latest.sx,
          actorStartZ: latest.sz,
          actorEndX: latest.ex,
          actorEndZ: latest.ez,
        });
      }
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  return (
    <div
      className="sds-radar-card"
      role="region"
      aria-label="3D 舞台俯视调度图"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="sds-radar-head">
        <span>
          <Compass size={11} /> 俯视调度图
        </span>
        {dragHud ? <code>{dragHud}</code> : <small>拖拽物体 · 点机位切视角</small>}
        <button type="button" title="收起俯视图" aria-label="收起俯视图" onClick={onClose}>
          <X size={11} />
        </button>
      </div>
      <svg ref={svgRef} className="sds-radar-svg" viewBox={`0 0 ${VB_W} ${VB_H}`}>
        {/* Floor coordinate grid */}
        {[-4, -2, 0, 2, 4].map((g) => (
          <g key={g}>
            <line
              x1={toSvgX(g)}
              y1={8}
              x2={toSvgX(g)}
              y2={VB_H - 8}
              stroke={g === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'}
              strokeWidth={g === 0 ? 1 : 0.7}
            />
            <line
              x1={8}
              y1={toSvgY(g)}
              x2={VB_W - 8}
              y2={toSvgY(g)}
              stroke={g === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'}
              strokeWidth={g === 0 ? 1 : 0.7}
            />
          </g>
        ))}

        {/* Saved Camera Bookmarks (clickable FOV cones) */}
        {bookmarkCones.map(({ bm, cone }) => {
          const active = activeBookmarkId === bm.id;
          return (
            <g
              key={bm.id}
              className="sds-radar-cam"
              onClick={() => onSelectBookmark(bm)}
              style={{ cursor: 'pointer' }}
            >
              <title>{`${bm.label} (${bm.cameraLens}mm) · 点击切换`}</title>
              <polygon
                points={cone.polygon}
                fill={active ? 'rgba(250, 204, 21, 0.22)' : 'rgba(148, 163, 184, 0.12)'}
                stroke={active ? '#facc15' : 'rgba(148, 163, 184, 0.45)'}
                strokeWidth={active ? 1.2 : 0.8}
              />
              <circle
                cx={cone.sx}
                cy={cone.sy}
                r={5.5}
                fill={active ? '#facc15' : '#1e293b'}
                stroke={active ? '#fef08a' : '#94a3b8'}
                strokeWidth={1}
              />
              <text
                x={cone.sx}
                y={cone.sy + 2.6}
                textAnchor="middle"
                fontSize={7}
                fontWeight={700}
                fill={active ? '#0f172a' : '#e2e8f0'}
              >
                {bm.shortKey}
              </text>
            </g>
          );
        })}

        {/* Live active camera frustum */}
        <g pointerEvents="none">
          <polygon
            points={liveCone.polygon}
            fill="rgba(56, 189, 248, 0.16)"
            stroke="#38bdf8"
            strokeWidth={1.1}
            strokeDasharray="2 2"
          />
          <circle cx={liveCone.sx} cy={liveCone.sy} r={3.5} fill="#38bdf8" />
        </g>

        {/* Built-in Previs Hero walk path + draggable start/end */}
        {heroPathState && (
          <g>
            <line
              x1={toSvgX(heroPathState.startX)}
              y1={toSvgY(heroPathState.startZ)}
              x2={toSvgX(heroPathState.endX)}
              y2={toSvgY(heroPathState.endZ)}
              stroke="#60a5fa"
              strokeWidth={1.4}
              strokeDasharray="3 2"
            />
            <circle
              cx={toSvgX(heroPathState.startX)}
              cy={toSvgY(heroPathState.startZ)}
              r={5.5}
              fill="#3b82f6"
              stroke="#dbeafe"
              strokeWidth={1.2}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => startHeroWaypointDrag(e, 'start')}
            >
              <title>拖动主角走线起点</title>
            </circle>
            <circle
              cx={toSvgX(heroPathState.endX)}
              cy={toSvgY(heroPathState.endZ)}
              r={4.5}
              fill="#0f172a"
              stroke="#60a5fa"
              strokeWidth={1.4}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => startHeroWaypointDrag(e, 'end')}
            >
              <title>拖动主角走线终点</title>
            </circle>
            <circle
              cx={toSvgX(heroPathState.x)}
              cy={toSvgY(heroPathState.z)}
              r={3}
              fill="#ffffff"
              pointerEvents="none"
            />
          </g>
        )}

        {/* Composable Scene Graph stageObjects (directly draggable on floor plan!) */}
        {visibleObjects.map((obj) => {
          const sx = toSvgX(obj.position[0]);
          const sy = toSvgY(obj.position[2]);
          const selected = selectedObjectId === obj.id;
          const color =
            obj.kind === 'light'
              ? kelvinToHex(obj.temperature ?? 3800)
              : obj.color || '#94a3b8';

          return (
            <g key={obj.id} data-radar-obj={obj.id}>
              {obj.kind === 'actor' && obj.endPosition && (
                <>
                  <line
                    x1={sx}
                    y1={sy}
                    x2={toSvgX(obj.endPosition[0])}
                    y2={toSvgY(obj.endPosition[2])}
                    stroke={color}
                    strokeWidth={1.2}
                    strokeDasharray="2.5 2"
                  />
                  <circle
                    cx={toSvgX(obj.endPosition[0])}
                    cy={toSvgY(obj.endPosition[2])}
                    r={4}
                    fill="#0f172a"
                    stroke={color}
                    strokeWidth={1.3}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => startObjectDrag(e, obj.id, 'endPosition')}
                  >
                    <title>{`${obj.name} · 拖动走线终点`}</title>
                  </circle>
                </>
              )}

              {selected && (
                <circle
                  cx={sx}
                  cy={sy}
                  r={9.5}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={1.2}
                  strokeDasharray="2 2"
                  pointerEvents="none"
                />
              )}

              {obj.kind === 'prop-box' || obj.kind === 'prop-arch' ? (
                <rect
                  x={sx - 5.5}
                  y={sy - 5.5}
                  width={11}
                  height={11}
                  rx={2}
                  fill={color}
                  stroke={selected ? '#ffffff' : '#0f172a'}
                  strokeWidth={1.2}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => startObjectDrag(e, obj.id, 'position')}
                >
                  <title>{`${obj.name} · 拖动摆位`}</title>
                </rect>
              ) : obj.kind === 'card-25d' ? (
                <rect
                  x={sx - 7}
                  y={sy - 2.5}
                  width={14}
                  height={5}
                  rx={1.5}
                  fill="#a78bfa"
                  stroke={selected ? '#ffffff' : '#0f172a'}
                  strokeWidth={1.1}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => startObjectDrag(e, obj.id, 'position')}
                >
                  <title>{`${obj.name} · 拖动 2D 立牌`}</title>
                </rect>
              ) : (
                <circle
                  cx={sx}
                  cy={sy}
                  r={obj.kind === 'light' ? 5.2 : 5.8}
                  fill={color}
                  stroke={selected ? '#ffffff' : '#0f172a'}
                  strokeWidth={1.3}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => startObjectDrag(e, obj.id, 'position')}
                >
                  <title>{`${obj.name} · 拖动摆位`}</title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
