import React, { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';

function parseTimecodeSeconds(raw: string): number | null {
  const clean = raw.trim();
  const hms = clean.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (hms) {
    return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  }
  const ms = clean.match(/^(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if (ms && Number(ms[2]) < 60) {
    return Number(ms[1]) * 60 + Number(ms[2]);
  }
  return null;
}

function CodeBlock({ lang, raw, children }: { lang: string; raw: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code-wrap">
      <div className="md-code-head">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          className="md-code-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(raw).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="markdown-code">{children}</pre>
    </div>
  );
}

export const Markdown = memo(function Markdown({
  text,
  onSeekTimecode,
}: {
  text: string;
  onSeekTimecode?: (seconds: number) => void;
}) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href?.startsWith('https://')) void window.cocraft.call('link.open', { url: href });
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => {
            const firstChild = React.Children.toArray(children)[0] as React.ReactElement<any> | undefined;
            const cls = String(firstChild?.props?.className || '');
            const lang = cls.match(/language-([\w-]+)/)?.[1] || '';
            const raw = String(firstChild?.props?.children ?? '').replace(/\n$/, '');
            return (
              <CodeBlock lang={lang} raw={raw}>
                {children}
              </CodeBlock>
            );
          },
          code: ({ className, children, ...rest }) => {
            const raw = String(children ?? '');
            const isBlock = Boolean(className) || raw.includes('\n');
            if (!isBlock && onSeekTimecode) {
              const sec = parseTimecodeSeconds(raw);
              if (sec !== null) {
                return (
                  <button
                    type="button"
                    className="md-timecode-btn"
                    title={`跳转到 ${raw.trim()}`}
                    onClick={() => onSeekTimecode(sec)}
                  >
                    {children}
                  </button>
                );
              }
            }
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="md-table-scroll">
              <table>{children}</table>
            </div>
          ),
          img: ({ alt }) => <span className="markdown-image-label">{alt || '图片参考'}</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
