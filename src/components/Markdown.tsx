import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export const Markdown = memo(function Markdown({text}:{text:string}) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({href, children}) => <a href={href} onClick={e=>{e.preventDefault();if(href?.startsWith('https://'))void window.cocraft.call('link.open',{url:href});}}>{children}</a>,
    pre: ({children}) => <pre className="markdown-code">{children}</pre>,
    img: ({alt}) => <span className="markdown-image-label">{alt || '图片参考'}</span>,
  }}>{text}</ReactMarkdown></div>;
});
