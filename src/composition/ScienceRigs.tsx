import React from 'react';
import { Html5Video, Img, OffthreadVideo, getRemotionEnvironment } from 'remotion';

const family = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", sans-serif';
const mono = '"SFMono-Regular", Consolas, monospace';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - Math.pow(1 - clamp(v), 3);

export interface RigRenderContext {
  width: number;
  height: number;
  frame: number;
  fps: number;
  duration: number;
  props: Record<string, unknown>;
  assetUrl?: string;
  assetKind?: 'video' | 'image' | 'audio' | 'model-3d';
  sourceIn?: number;
}

export function SeeCodeRig({ width: w, height: h, frame, fps, props: p }: RigRenderContext) {
  const u = Math.min(w, h) / 1080;
  const portrait = h > w * 1.1;
  const t = frame / fps;
  const light = p.surface === 'light';
  const accent = String(p.accent || '#3b82f6');
  const bg = light ? '#f8fafc' : '#090e1a';
  const ink = light ? '#0f172a' : '#f8fafc';
  const muted = light ? '#64748b' : '#94a3b8';
  const cardBg = light ? '#ffffff' : '#11192c';
  const border = light ? '#e2e8f0' : '#1e293b';

  const nodes = String(p.nodes || '输入解码|帧级合成核|硬件编码器')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
  const metrics = String(p.metrics || '99.4% 帧准率 · 3.2x 吞吐提升 · <8ms 调度延迟')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  const maxStep = Math.max(1, Number(p.activeStep ?? nodes.length));
  const enter = easeOut(t / 0.55);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: bg,
        color: ink,
        fontFamily: family,
        overflow: 'hidden',
        padding: `${(portrait ? 88 : 64) * u}px ${(portrait ? 64 : 76) * u}px`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {/* Subtle architectural grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(${accent}14 1px, transparent 1px), linear-gradient(90deg, ${accent}14 1px, transparent 1px)`,
          backgroundSize: `${56 * u}px ${56 * u}px`,
          pointerEvents: 'none',
        }}
      />

      {/* Header */}
      <div style={{ position: 'relative', transform: `translateY(${(1 - enter) * 18 * u}px)`, opacity: enter }}>
        <div
          style={{
            fontFamily: mono,
            fontSize: 17 * u,
            letterSpacing: 3 * u,
            color: accent,
            fontWeight: 600,
            marginBottom: 12 * u,
          }}
        >
          {String(p.subtitle || '系统架构与流程演进')}
        </div>
        <div style={{ fontSize: (portrait ? 58 : 54) * u, fontWeight: 700, letterSpacing: -0.8 * u }}>
          {String(p.text || '零拷贝渲染与并发管线')}
        </div>
      </div>

      {/* Pipeline Nodes */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: portrait ? 'column' : 'row',
          alignItems: 'stretch',
          gap: 26 * u,
          margin: `${24 * u}px 0`,
        }}
      >
        {nodes.map((label, idx) => {
          const stepAppear = easeOut((t - 0.18 * idx) / 0.45);
          const isLit = idx + 1 <= maxStep && t >= idx * 0.35;
          const pulse = isLit ? 0.5 + 0.5 * Math.sin(t * 4 - idx) : 0;
          return (
            <React.Fragment key={idx}>
              <div
                style={{
                  flex: 1,
                  background: cardBg,
                  border: `1.5px solid ${isLit ? accent : border}`,
                  borderRadius: 18 * u,
                  padding: `${28 * u}px ${26 * u}px`,
                  boxShadow: isLit ? `0 16px 40px ${accent}22` : 'none',
                  opacity: stepAppear,
                  transform: `translateY(${(1 - stepAppear) * 20 * u}px)`,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: (portrait ? 150 : 210) * u,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 15 * u,
                      padding: `${4 * u}px ${10 * u}px`,
                      borderRadius: 999,
                      background: isLit ? `${accent}24` : border,
                      color: isLit ? accent : muted,
                      fontWeight: 600,
                    }}
                  >
                    STAGE 0{idx + 1}
                  </span>
                  <span
                    style={{
                      width: 10 * u,
                      height: 10 * u,
                      borderRadius: '50%',
                      background: isLit ? accent : muted,
                      boxShadow: isLit ? `0 0 ${12 + pulse * 8}px ${accent}` : 'none',
                    }}
                  />
                </div>
                <div style={{ fontSize: 30 * u, fontWeight: 650, marginTop: 18 * u }}>{label}</div>
                {/* Throughput mini bar */}
                <div style={{ marginTop: 20 * u }}>
                  <div
                    style={{
                      height: 6 * u,
                      borderRadius: 999,
                      background: light ? '#e2e8f0' : '#1e293b',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${isLit ? Math.min(100, (68 + idx * 14) * stepAppear) : 18}%`,
                        background: accent,
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </div>
              </div>
              {idx < nodes.length - 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isLit ? accent : muted,
                    fontFamily: mono,
                    fontSize: 26 * u,
                    fontWeight: 700,
                  }}
                >
                  {portrait ? '↓' : '→'}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Metrics Footer */}
      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, metrics.length)}, 1fr)`,
          gap: 18 * u,
          borderTop: `1px solid ${border}`,
          paddingTop: 24 * u,
        }}
      >
        {metrics.map((mItem, i) => (
          <div key={i} style={{ fontSize: 21 * u, fontWeight: 600, color: i === 0 ? accent : ink }}>
            {mItem}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TinychartsRig({ width: w, height: h, frame, fps, props: p }: RigRenderContext) {
  const u = Math.min(w, h) / 1080;
  const portrait = h > w * 1.1;
  const t = frame / fps;
  const dark = p.surface === 'dark';
  const bg = dark ? '#111622' : '#fbf9f3';
  const ink = dark ? '#f1f5f9' : '#1e293b';
  const accent = String(p.accent || '#2563eb');
  const reject = p.mode === 'reject';
  const states = String(p.states || '草稿编辑|版本校验|原子发布')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  // Token progression along 0 -> 1 -> 2 (or bounce at 1 when reject)
  const rawProgress = clamp((t - 0.35) / 2.2);
  let tokenPos = rawProgress * (states.length - 1);
  let rejectedNow = false;
  if (reject && tokenPos > 1.0) {
    rejectedNow = true;
    const bounce = clamp((tokenPos - 1.0) / 0.8);
    tokenPos = 1.0 - Math.sin(bounce * Math.PI * 0.85) * 0.55;
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: bg,
        color: ink,
        fontFamily: family,
        overflow: 'hidden',
        padding: `${68 * u}px ${76 * u}px`,
        boxSizing: 'border-box',
      }}
    >
      {/* Dot paper background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `radial-gradient(${dark ? '#334155' : '#cbd5e1'} 1.4px, transparent 1.4px)`,
          backgroundSize: `${28 * u}px ${28 * u}px`,
          opacity: 0.65,
        }}
      />

      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          <filter id="cc-sketch- wobble">
            <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" result="noise" seed="3" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={2.6 * u} />
          </filter>
        </defs>
      </svg>

      <div style={{ position: 'relative' }}>
        <div style={{ fontFamily: mono, fontSize: 17 * u, color: accent, fontWeight: 700, letterSpacing: 2 * u }}>
          {String(p.subtitle || '规则逻辑与状态推演')}
        </div>
        <div style={{ fontSize: 52 * u, fontWeight: 750, marginTop: 8 * u }}>
          {String(p.text || '编辑锁与快照发布状态机')}
        </div>
      </div>

      {/* Hand-drawn SVG Statechart */}
      <svg
        width={w - 152 * u}
        height={h * 0.54}
        viewBox={`0 0 ${w - 152 * u} ${h * 0.54}`}
        style={{ position: 'relative', marginTop: 32 * u, overflow: 'visible' }}
      >
        {states.map((st, idx) => {
          const totalW = w - 152 * u;
          const totalH = h * 0.54;
          const cx = portrait ? totalW * 0.5 : totalW * (0.17 + idx * 0.33);
          const cy = portrait ? totalH * (0.18 + idx * 0.34) : totalH * 0.48;
          const boxW = (portrait ? 460 : 320) * u;
          const boxH = 118 * u;
          const isCurrent = Math.round(tokenPos) === idx;
          const isBlockedNode = reject && idx === 2;
          const strokeCol = isBlockedNode && rejectedNow ? '#ef4444' : isCurrent ? accent : ink;

          const nextCx = portrait ? totalW * 0.5 : totalW * (0.17 + (idx + 1) * 0.33);
          const nextCy = portrait ? totalH * (0.18 + (idx + 1) * 0.34) : totalH * 0.48;

          return (
            <g key={idx}>
              {idx < states.length - 1 && (
                <g>
                  <line
                    x1={portrait ? cx : cx + boxW / 2 + 10 * u}
                    y1={portrait ? cy + boxH / 2 + 8 * u : cy}
                    x2={portrait ? nextCx : nextCx - boxW / 2 - 14 * u}
                    y2={portrait ? nextCy - boxH / 2 - 12 * u : nextCy}
                    stroke={reject && idx === 1 && rejectedNow ? '#ef4444' : ink}
                    strokeWidth={3.5 * u}
                    strokeDasharray={reject && idx === 1 ? `${10 * u} ${8 * u}` : undefined}
                    opacity={0.75}
                  />
                  {reject && idx === 1 && rejectedNow && (
                    <text
                      x={(cx + nextCx) / 2}
                      y={(cy + nextCy) / 2 - 18 * u}
                      textAnchor="middle"
                      fill="#ef4444"
                      fontSize={28 * u}
                      fontWeight={800}
                    >
                      ✕ 条件拦截
                    </text>
                  )}
                </g>
              )}
              {/* Double-stroke sketchy marker box */}
              <rect
                x={cx - boxW / 2}
                y={cy - boxH / 2}
                width={boxW}
                height={boxH}
                rx={18 * u}
                fill={dark ? '#1e293b' : '#ffffff'}
                stroke={strokeCol}
                strokeWidth={3.5 * u}
              />
              <rect
                x={cx - boxW / 2 + 4 * u}
                y={cy - boxH / 2 - 3 * u}
                width={boxW}
                height={boxH}
                rx={18 * u}
                fill="none"
                stroke={strokeCol}
                strokeWidth={1.6 * u}
                opacity={0.45}
              />
              <text
                x={cx}
                y={cy + 9 * u}
                textAnchor="middle"
                fill={ink}
                fontSize={29 * u}
                fontWeight={700}
                fontFamily={family}
              >
                {st}
              </text>
            </g>
          );
        })}

        {/* Traveling State Token */}
        {(() => {
          const totalW = w - 152 * u;
          const totalH = h * 0.54;
          const tx = portrait ? totalW * 0.5 - 185 * u : totalW * (0.17 + tokenPos * 0.33);
          const ty = portrait ? totalH * (0.18 + tokenPos * 0.34) : totalH * 0.48 - 82 * u;
          const col = rejectedNow ? '#ef4444' : accent;
          return (
            <g>
              <circle cx={tx} cy={ty} r={16 * u} fill={col} opacity={0.24} />
              <circle cx={tx} cy={ty} r={9.5 * u} fill={col} />
            </g>
          );
        })()}
      </svg>

      {/* Bottom Guard Note */}
      <div
        style={{
          position: 'absolute',
          bottom: 58 * u,
          left: 76 * u,
          padding: `${14 * u}px ${24 * u}px`,
          borderRadius: 14 * u,
          border: `2px solid ${rejectedNow ? '#ef4444' : accent}`,
          background: dark ? '#0f172acc' : '#ffffffee',
          fontSize: 22 * u,
          fontWeight: 600,
          color: rejectedNow ? '#ef4444' : ink,
        }}
      >
        {String(p.guardNote || '基线版本匹配 → 生成新快照 v+1')}
      </div>
    </div>
  );
}

export function AnatomyRig({ width: w, height: h, frame, fps, props: p }: RigRenderContext) {
  const u = Math.min(w, h) / 1080;
  const portrait = h > w * 1.1;
  const t = frame / fps;
  const isLight = p.surface === 'light';
  const accent = String(p.accent || '#14b8a6');
  const ink = isLight ? '#0f172a' : '#f1f5f9';
  const mutedInk = isLight ? '#475569' : '#94a3b8';
  const bg = isLight
    ? 'radial-gradient(circle at 50% 52%, #ffffff 0%, #f1f5f9 78%)'
    : 'radial-gradient(circle at 50% 52%, #0f1f2e 0%, #070b12 76%)';
  const badgeBg = isLight ? 'rgba(255,255,255,0.9)' : '#0f172acc';
  const chamberFill = isLight ? '#f8fafc' : '#0d1b2a';
  const cellA = isLight ? '#e0f2fe' : '#132a3a';
  const cellB = isLight ? '#eff6ff' : '#132238';
  const dividerCol = isLight ? '#cbd5e1' : '#1e293b';
  const biomed = p.domain === 'biomed';
  const flow = Math.max(10, Math.min(100, Number(p.flowRate ?? 78)));
  const particleCount = Math.round((flow / 100) * 26);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: bg,
        color: ink,
        fontFamily: family,
        overflow: 'hidden',
        padding: `${60 * u}px ${72 * u}px`,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 16 * u, letterSpacing: 3 * u, color: accent, fontWeight: 600 }}>
            {String(p.subtitle || '内部机制与传导剖面')}
          </div>
          <div style={{ fontSize: 50 * u, fontWeight: 700, marginTop: 8 * u }}>
            {String(p.text || '令牌桶限流与突发放行机制')}
          </div>
        </div>
        <div
          style={{
            fontFamily: mono,
            padding: `${10 * u}px ${18 * u}px`,
            borderRadius: 10 * u,
            background: badgeBg,
            border: `1px solid ${accent}55`,
            fontSize: 16 * u,
            color: accent,
          }}
        >
          {biomed ? '微观信号传导' : '稳态缓冲流控'} · {flow}%
        </div>
      </div>

      {/* Central Cross-Section SVG + Deterministic Particle Stream */}
      <svg
        width={w - 144 * u}
        height={h * 0.56}
        viewBox="0 0 1000 500"
        style={{ marginTop: 22 * u, width: '100%', height: portrait ? '50%' : '58%' }}
      >
        {/* Cross-section chamber walls */}
        {biomed ? (
          <g>
            <path
              d="M 140 130 C 320 130, 360 200, 430 250 C 360 300, 320 370, 140 370"
              fill={cellA}
              stroke={accent}
              strokeWidth="4"
            />
            <path
              d="M 860 110 C 660 110, 620 190, 570 250 C 620 310, 660 390, 860 390"
              fill={cellB}
              stroke="#60a5fa"
              strokeWidth="4"
            />
            <text x="240" y="95" fill={mutedInk} fontFamily={family} fontSize="18">
              突触前囊泡
            </text>
            <text x="640" y="95" fill={mutedInk} fontFamily={family} fontSize="18">
              受体膜通道
            </text>
          </g>
        ) : (
          <g>
            <rect x="330" y="90" width="340" height="310" rx="26" fill={chamberFill} stroke={accent} strokeWidth="4" />
            {/* Fluid / Token level inside bucket */}
            <rect
              x="342"
              y={90 + 298 * (1 - flow / 115)}
              width="316"
              height={298 * (flow / 115)}
              rx="18"
              fill={`${accent}28`}
            />
            <line x1="120" y1="245" x2="330" y2="245" stroke="#64748b" strokeWidth="10" />
            <line x1="670" y1="245" x2="880" y2="245" stroke={accent} strokeWidth="10" />
            <text x="500" y="70" textAnchor="middle" fill={mutedInk} fontFamily={family} fontSize="18">
              缓冲腔体 · 限流阀门
            </text>
          </g>
        )}

        {/* Deterministic flowing particles */}
        {Array.from({ length: particleCount }, (_, i) => {
          const phase = ((i / particleCount) + t * (0.28 + (flow / 100) * 0.35)) % 1;
          const px = 140 + phase * 720;
          const spread = Math.sin(i * 7.3 + phase * Math.PI * 4) * (biomed ? 46 : 32);
          const py = 250 + spread;
          return (
            <circle
              key={i}
              cx={px}
              cy={py}
              r={biomed ? 6.5 : 7.5}
              fill={i % 3 === 0 ? '#60a5fa' : accent}
              opacity={0.88}
            />
          );
        })}
      </svg>

      {/* Telemetry Readouts + Citation */}
      <div
        style={{
          position: 'absolute',
          bottom: 48 * u,
          left: 72 * u,
          right: 72 * u,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: `1px solid ${dividerCol}`,
          paddingTop: 20 * u,
        }}
      >
        <div style={{ display: 'flex', gap: 36 * u, fontFamily: mono, fontSize: 18 * u }}>
          <span>
            通量 <b style={{ color: accent }}>{(flow * 1.24).toFixed(1)} 次/秒</b>
          </span>
          <span>
            抖动 <b style={{ color: isLight ? '#2563eb' : '#60a5fa' }}>±{(2.4 - flow * 0.015).toFixed(2)} ms</b>
          </span>
          <span>
            流态 <b style={{ color: ink }}>稳态层流</b>
          </span>
        </div>
        <div style={{ fontSize: 16 * u, color: mutedInk, fontFamily: mono }}>
          {String(p.citation || '')}
        </div>
      </div>
    </div>
  );
}

export function ScreenFocusRig({
  width: w,
  height: h,
  frame,
  fps,
  duration,
  props: p,
  assetUrl,
  assetKind,
  sourceIn = 0,
}: RigRenderContext) {
  const u = Math.min(w, h) / 1080;
  const t = frame / fps;
  const totalSec = Math.max(1.5, duration / fps);
  const isLight = p.surface === 'light';
  const accent = String(p.accent || '#3b82f6');
  const targetZoom = Math.max(1, Math.min(2.8, Number(p.zoomLevel ?? 1.75)));
  const fx = Math.max(10, Math.min(90, Number(p.focusX ?? 68)));
  const fy = Math.max(10, Math.min(90, Number(p.focusY ?? 36)));

  const frameStyle = String(p.frameStyle || 'macos');
  const isPhone = frameStyle === 'phone';
  const isTerminal = frameStyle === 'terminal';
  const isBrowser = frameStyle === 'browser';

  // Smooth zoom-in then zoom-out envelope + animated cursor approach
  const zoomIn = easeOut((t - 0.45) / 0.75);
  const zoomOut = easeOut((totalSec - t - 0.25) / 0.65);
  const focusAmt = Math.min(zoomIn, zoomOut);
  const scale = 1 + (targetZoom - 1) * focusAmt;
  const tx = (50 - fx) * 0.75 * focusAmt;
  const ty = (50 - fy) * 0.75 * focusAmt;
  const cursorMove = easeOut((t - 0.2) / 0.65);
  const cursorX = 24 + (fx - 24) * cursorMove;
  const cursorY = 76 + (fy - 76) * cursorMove;
  const clickWave = t > 0.9 && t < 1.55 ? (t - 0.9) / 0.65 : 0;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: isLight
          ? `radial-gradient(circle at 22% 18%, ${accent}1c 0%, transparent 48%), radial-gradient(circle at 82% 84%, #14b8a618 0%, #f1f5f9 72%)`
          : `radial-gradient(circle at 22% 18%, ${accent}38 0%, transparent 48%), radial-gradient(circle at 82% 84%, #14b8a626 0%, #080c16 70%)`,
        fontFamily: family,
        color: isLight ? '#0f172a' : '#f8fafc',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Zoomed Device / Window Shell Container */}
      <div
        style={{
          width: isPhone ? `${Math.min(440 * u, w * 0.42)}px` : '82%',
          height: isPhone ? '82%' : '76%',
          borderRadius: (isPhone ? 42 : 20) * u,
          background: isTerminal ? '#090d14' : '#0f172a',
          border: isPhone ? `${5 * u}px solid #334155` : '1px solid rgba(255,255,255,0.16)',
          boxShadow: '0 44px 100px rgba(0,0,0,0.68)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transform: `scale(${scale.toFixed(4)}) translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%)`,
          transformOrigin: 'center center',
        }}
      >
        {/* Adaptive Shell Header */}
        {isPhone ? (
          <div
            style={{
              height: 34 * u,
              background: '#0b1120',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <div style={{ width: 96 * u, height: 18 * u, borderRadius: 999, background: '#020617' }} />
          </div>
        ) : (
          <div
            style={{
              height: (isBrowser ? 46 : 38) * u,
              background: isTerminal ? '#0b0f19' : '#162033',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              padding: `0 ${18 * u}px`,
              gap: 9 * u,
              flexShrink: 0,
            }}
          >
            <span style={{ width: 11 * u, height: 11 * u, borderRadius: '50%', background: '#ef4444' }} />
            <span style={{ width: 11 * u, height: 11 * u, borderRadius: '50%', background: '#f59e0b' }} />
            <span style={{ width: 11 * u, height: 11 * u, borderRadius: '50%', background: '#22c55e' }} />
            {isBrowser ? (
              <div
                style={{
                  marginLeft: 14 * u,
                  flex: 1,
                  maxWidth: 420 * u,
                  height: 26 * u,
                  borderRadius: 7 * u,
                  background: '#0b1120',
                  border: '1px solid rgba(255,255,255,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: `0 ${12 * u}px`,
                  fontFamily: mono,
                  fontSize: 12.5 * u,
                  color: '#cbd5e1',
                }}
              >
                https://{String(p.subtitle || 'cocraft.studio/demo')}
              </div>
            ) : (
              <span style={{ marginLeft: 14 * u, fontFamily: mono, fontSize: 13 * u, color: '#94a3b8' }}>
                {isTerminal ? `zsh — ${String(p.subtitle || 'workspace')}` : String(p.subtitle || '产品界面操作特写')}
              </span>
            )}
          </div>
        )}

        {/* Screen Content: Real Imported Screen Recording/Image OR Built-in Interactive Demo Surface */}
        <div style={{ position: 'relative', flex: 1, background: '#0b1120', overflow: 'hidden' }}>
          {assetUrl && assetKind === 'image' ? (
            <Img src={assetUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : assetUrl && assetKind === 'video' ? (
            getRemotionEnvironment().isRendering ? (
              <OffthreadVideo
                src={assetUrl}
                startFrom={sourceIn}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <Html5Video
                src={assetUrl}
                startFrom={sourceIn}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )
          ) : (
            /* Clean built-in UI preview when no recording asset is bound yet */
            <div
              style={{
                width: '100%',
                height: '100%',
                padding: 36 * u,
                boxSizing: 'border-box',
                display: 'grid',
                gridTemplateColumns: '240px 1fr',
                gap: 28 * u,
              }}
            >
              <div
                style={{
                  background: '#111a2e',
                  borderRadius: 14 * u,
                  padding: 20 * u,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14 * u,
                }}
              >
                <div style={{ height: 14 * u, width: '65%', borderRadius: 6, background: '#334155' }} />
                <div style={{ height: 12 * u, width: '85%', borderRadius: 6, background: '#1e293b' }} />
                <div style={{ height: 12 * u, width: '72%', borderRadius: 6, background: '#1e293b' }} />
                <div style={{ height: 34 * u, width: '100%', borderRadius: 8, background: `${accent}33`, marginTop: 10 }} />
              </div>
              <div
                style={{
                  background: '#111a2e',
                  borderRadius: 14 * u,
                  padding: 28 * u,
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 24 * u, fontWeight: 650 }}>实时渲染管线状态</div>
                  <div
                    style={{
                      padding: `${8 * u}px ${18 * u}px`,
                      borderRadius: 999,
                      background: accent,
                      fontSize: 15 * u,
                      fontWeight: 600,
                    }}
                  >
                    已启用硬件加速
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 * u }}>
                  {['60 FPS', '0 闪屏', 'H.264 SDR'].map((tag, k) => (
                    <div
                      key={k}
                      style={{
                        background: '#0b1120',
                        border: '1px solid #1e293b',
                        borderRadius: 12 * u,
                        padding: 18 * u,
                        fontSize: 22 * u,
                        fontWeight: 700,
                        color: k === 1 ? accent : '#e2e8f0',
                      }}
                    >
                      {tag}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Optional Focus Spotlight Ring + Animated Pointer Cursor */}
          {p.showRing !== false && (
            <>
              {clickWave > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${fx}%`,
                    top: `${fy}%`,
                    width: (48 + clickWave * 110) * u,
                    height: (48 + clickWave * 110) * u,
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                    border: `2.5px solid ${accent}`,
                    opacity: 1 - clickWave,
                    pointerEvents: 'none',
                  }}
                />
              )}
              <svg
                width={32 * u}
                height={32 * u}
                viewBox="0 0 24 24"
                style={{
                  position: 'absolute',
                  left: `${cursorX}%`,
                  top: `${cursorY}%`,
                  filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.55))',
                  pointerEvents: 'none',
                }}
              >
                <path
                  d="M4 3L19 11.5L12.2 13.3L9.2 20L4 3Z"
                  fill="#ffffff"
                  stroke="#0f172a"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </>
          )}
        </div>
      </div>

      {/* Caption Callout Pill */}
      <div
        style={{
          position: 'absolute',
          bottom: 34 * u,
          padding: `${12 * u}px ${26 * u}px`,
          borderRadius: 999,
          background: isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)',
          color: isLight ? '#0f172a' : '#f8fafc',
          border: `1px solid ${accent}66`,
          fontSize: 24 * u,
          fontWeight: 650,
          boxShadow: isLight ? '0 10px 28px rgba(15,23,42,0.12)' : '0 12px 32px rgba(0,0,0,0.45)',
        }}
      >
        {String(p.text || '一键聚焦核心操作细节')}
      </div>
    </div>
  );
}
