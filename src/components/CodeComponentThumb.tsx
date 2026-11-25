import React, { useEffect, useState } from 'react';
import { Code2 } from 'lucide-react';
import type { CodeComponent } from '../core/types';

const posterUrlCache = new Map<string, string>();
const posterInFlight = new Map<string, Promise<string | null>>();

function makeCacheKey(component: CodeComponent, clipProps?: Record<string, unknown>): string {
  if (!clipProps) return component.hash;
  const diffs: [string, unknown][] = [];
  for (const k of Object.keys(clipProps).sort()) {
    const v = clipProps[k];
    if (v !== undefined && v !== (component.props as Record<string, unknown>)?.[k]) {
      diffs.push([k, v]);
    }
  }
  return diffs.length ? `${component.hash}::${JSON.stringify(diffs)}` : component.hash;
}

function requestPoster(
  component: CodeComponent,
  clipProps?: Record<string, unknown>,
  frame?: number,
): Promise<string | null> {
  const key = makeCacheKey(component, clipProps);
  const cached = posterUrlCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = posterInFlight.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      const res = await window.cocraft?.call<{ url: string | null }>('stage.componentPoster', {
        componentId: component.id,
        clipProps,
        frame,
      });
      if (res?.url) {
        posterUrlCache.set(key, res.url);
        return res.url;
      }
      return null;
    } catch {
      return null;
    } finally {
      posterInFlight.delete(key);
    }
  })();

  posterInFlight.set(key, task);
  return task;
}

export const CodeComponentThumb = React.memo(function CodeComponentThumb({
  component,
  clipProps,
  frame,
  label,
  showPill = true,
}: {
  component: CodeComponent;
  clipProps?: Record<string, unknown>;
  frame?: number;
  label?: string;
  showPill?: boolean;
}) {
  const key = makeCacheKey(component, clipProps);
  const [url, setUrl] = useState<string | null>(() => posterUrlCache.get(key) || null);
  const [loading, setLoading] = useState<boolean>(() => !posterUrlCache.has(key));

  useEffect(() => {
    const hit = posterUrlCache.get(key);
    if (hit) {
      setUrl(hit);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void requestPoster(component, clipProps, frame).then((resolved) => {
      if (!alive) return;
      setUrl(resolved);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [key, component, clipProps, frame]);

  if (url) {
    return (
      <div className="cc-code-thumb">
        <img src={url} alt={label || component.name} draggable={false} />
        {showPill && (
          <span className="cc-code-pill">
            <Code2 size={10} /> TSX
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="cc-code-thumb fallback">
      <Code2 size={16} />
      <span>{(label || component.name).slice(0, 22)}</span>
      <small>{loading ? '渲染预览中…' : 'TSX 动态组件'}</small>
    </div>
  );
});
