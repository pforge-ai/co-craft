import React, { useMemo } from 'react';
import rough from 'roughjs';
import type { Drawable, Options as RoughOptions } from 'roughjs/bin/core';

const generator = rough.generator();

export interface RoughBaseProps {
  seed: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  fillStyle?: RoughOptions['fillStyle'];
  fillWeight?: number;
  hachureAngle?: number;
  hachureGap?: number;
  roughness?: number;
  bowing?: number;
  strokeLineDash?: number[];
  /** Optional 0..1 deterministic draw-in progress for Remotion animation. */
  progress?: number;
  opacity?: number;
}

function buildRoughOptions(props: RoughBaseProps): RoughOptions {
  return {
    seed: Math.max(1, Math.round(props.seed)),
    stroke: props.stroke ?? '#1e293b',
    strokeWidth: props.strokeWidth ?? 2.4,
    fill: props.fill,
    fillStyle: props.fillStyle ?? 'hachure',
    fillWeight: props.fillWeight ?? Math.max(0.8, (props.strokeWidth ?? 2.4) * 0.55),
    hachureAngle: props.hachureAngle ?? -41,
    hachureGap: props.hachureGap ?? 7,
    roughness: props.roughness ?? 1.45,
    bowing: props.bowing ?? 1.15,
    ...(props.strokeLineDash ? { strokeLineDash: props.strokeLineDash } : {}),
  };
}

function RoughDrawablePaths({
  drawable,
  progress = 1,
  opacity = 1,
  strokeLineDash,
}: {
  drawable: Drawable;
  progress?: number;
  opacity?: number;
  strokeLineDash?: number[];
}) {
  const paths = useMemo(() => generator.toPaths(drawable), [drawable]);
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0.001) return null;

  return (
    <g opacity={opacity}>
      {paths.map((info, idx) => {
        const isFillPath = info.fill && info.fill !== 'none';
        const hasStroke = info.stroke && info.stroke !== 'none';
        const dashStr = strokeLineDash?.length ? strokeLineDash.join(' ') : undefined;
        const animateStroke = p < 0.999 && hasStroke && !dashStr;
        return (
          <path
            key={idx}
            d={info.d}
            fill={info.fill || 'none'}
            fillOpacity={isFillPath ? (p < 0.999 ? Math.max(0, (p - 0.25) / 0.75) : 1) : undefined}
            stroke={info.stroke || 'none'}
            strokeWidth={info.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={animateStroke ? '1' : dashStr}
            strokeDashoffset={animateStroke ? String(1 - p) : undefined}
            pathLength={animateStroke ? 1 : undefined}
          />
        );
      })}
    </g>
  );
}

export function RoughRect(
  props: RoughBaseProps & { x: number; y: number; width: number; height: number },
) {
  const { x, y, width, height, progress, opacity, strokeLineDash } = props;
  const opts = buildRoughOptions(props);
  const drawable = useMemo(
    () => generator.rectangle(x, y, width, height, opts),
    [
      x,
      y,
      width,
      height,
      opts.seed,
      opts.stroke,
      opts.strokeWidth,
      opts.fill,
      opts.fillStyle,
      opts.fillWeight,
      opts.hachureAngle,
      opts.hachureGap,
      opts.roughness,
      opts.bowing,
      strokeLineDash?.join(','),
    ],
  );
  return (
    <RoughDrawablePaths
      drawable={drawable}
      progress={progress}
      opacity={opacity}
      strokeLineDash={strokeLineDash}
    />
  );
}

export function RoughCircle(props: RoughBaseProps & { cx: number; cy: number; diameter: number }) {
  const { cx, cy, diameter, progress, opacity, strokeLineDash } = props;
  const opts = buildRoughOptions(props);
  const drawable = useMemo(
    () => generator.circle(cx, cy, diameter, opts),
    [
      cx,
      cy,
      diameter,
      opts.seed,
      opts.stroke,
      opts.strokeWidth,
      opts.fill,
      opts.fillStyle,
      opts.fillWeight,
      opts.hachureAngle,
      opts.hachureGap,
      opts.roughness,
      opts.bowing,
      strokeLineDash?.join(','),
    ],
  );
  return (
    <RoughDrawablePaths
      drawable={drawable}
      progress={progress}
      opacity={opacity}
      strokeLineDash={strokeLineDash}
    />
  );
}

export function RoughEllipse(
  props: RoughBaseProps & { cx: number; cy: number; width: number; height: number },
) {
  const { cx, cy, width, height, progress, opacity, strokeLineDash } = props;
  const opts = buildRoughOptions(props);
  const drawable = useMemo(
    () => generator.ellipse(cx, cy, width, height, opts),
    [
      cx,
      cy,
      width,
      height,
      opts.seed,
      opts.stroke,
      opts.strokeWidth,
      opts.fill,
      opts.fillStyle,
      opts.fillWeight,
      opts.hachureAngle,
      opts.hachureGap,
      opts.roughness,
      opts.bowing,
      strokeLineDash?.join(','),
    ],
  );
  return (
    <RoughDrawablePaths
      drawable={drawable}
      progress={progress}
      opacity={opacity}
      strokeLineDash={strokeLineDash}
    />
  );
}

export function RoughLine(
  props: RoughBaseProps & { x1: number; y1: number; x2: number; y2: number },
) {
  const { x1, y1, x2, y2, progress, opacity, strokeLineDash } = props;
  const opts = buildRoughOptions(props);
  const drawable = useMemo(
    () => generator.line(x1, y1, x2, y2, opts),
    [
      x1,
      y1,
      x2,
      y2,
      opts.seed,
      opts.stroke,
      opts.strokeWidth,
      opts.roughness,
      opts.bowing,
      strokeLineDash?.join(','),
    ],
  );
  return (
    <RoughDrawablePaths
      drawable={drawable}
      progress={progress}
      opacity={opacity}
      strokeLineDash={strokeLineDash}
    />
  );
}

export function RoughArrow(
  props: RoughBaseProps & { x1: number; y1: number; x2: number; y2: number; headSize?: number },
) {
  const { x1, y1, x2, y2, headSize = 14, progress = 1, opacity = 1, strokeLineDash } = props;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 6.5;
  const hx1 = x2 - headSize * Math.cos(angle - spread);
  const hy1 = y2 - headSize * Math.sin(angle - spread);
  const hx2 = x2 - headSize * Math.cos(angle + spread);
  const hy2 = y2 - headSize * Math.sin(angle + spread);
  const headProg = Math.max(0, Math.min(1, (progress - 0.65) / 0.35));

  return (
    <g>
      <RoughLine
        {...props}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        progress={Math.min(1, progress / 0.85)}
        opacity={opacity}
        strokeLineDash={strokeLineDash}
      />
      {headProg > 0.01 && (
        <>
          <RoughLine
            {...props}
            seed={props.seed + 101}
            x1={x2}
            y1={y2}
            x2={hx1}
            y2={hy1}
            progress={headProg}
            opacity={opacity}
            strokeLineDash={undefined}
          />
          <RoughLine
            {...props}
            seed={props.seed + 202}
            x1={x2}
            y1={y2}
            x2={hx2}
            y2={hy2}
            progress={headProg}
            opacity={opacity}
            strokeLineDash={undefined}
          />
        </>
      )}
    </g>
  );
}

export function RoughPolygon(props: RoughBaseProps & { points: [number, number][] }) {
  const { points, progress, opacity, strokeLineDash } = props;
  const opts = buildRoughOptions(props);
  const key = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(';');
  const drawable = useMemo(
    () => generator.polygon(points, opts),
    [
      key,
      opts.seed,
      opts.stroke,
      opts.strokeWidth,
      opts.fill,
      opts.fillStyle,
      opts.fillWeight,
      opts.hachureAngle,
      opts.hachureGap,
      opts.roughness,
      opts.bowing,
      strokeLineDash?.join(','),
    ],
  );
  return (
    <RoughDrawablePaths
      drawable={drawable}
      progress={progress}
      opacity={opacity}
      strokeLineDash={strokeLineDash}
    />
  );
}

export function RoughPath(props: RoughBaseProps & { d: string }) {
  const { d, progress, opacity, strokeLineDash } = props;
  const opts = buildRoughOptions(props);
  const drawable = useMemo(
    () => generator.path(d, opts),
    [
      d,
      opts.seed,
      opts.stroke,
      opts.strokeWidth,
      opts.fill,
      opts.fillStyle,
      opts.fillWeight,
      opts.hachureAngle,
      opts.hachureGap,
      opts.roughness,
      opts.bowing,
      strokeLineDash?.join(','),
    ],
  );
  return (
    <RoughDrawablePaths
      drawable={drawable}
      progress={progress}
      opacity={opacity}
      strokeLineDash={strokeLineDash}
    />
  );
}

export { rough };
export default {
  rough,
  RoughRect,
  RoughCircle,
  RoughEllipse,
  RoughLine,
  RoughArrow,
  RoughPolygon,
  RoughPath,
};
