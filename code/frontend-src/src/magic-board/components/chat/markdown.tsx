import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Ánh xạ GFM tối giản — chỉ văn xuôi, giữ giao diện trò chuyện phẳng. */
const MD_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  a: ({ node: _node, ...props }: any) => (
    <a
      {...props}
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noreferrer"
    />
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className="mb-0.5">{children}</li>,
  code: ({ node: _node, ...props }: any) => (
    <code {...props} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]" />
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed last:mb-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}
