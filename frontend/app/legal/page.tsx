"use client";

import { Fragment, type ReactNode, useEffect, useState } from "react";

type LegalDocument = {
  documentId: string;
  type: "PRIVACY_POLICY" | "TERMS_OF_SERVICE" | "AI_CONTENT_NOTICE";
  version: string;
  title: string;
  contentFormat: "MARKDOWN";
  content: string;
  publishedAt?: string;
};

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <Fragment key={index}>{part}</Fragment>,
  );
}

function cells(line: string) {
  return line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function MarkdownDocument({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const children = inline(heading[2]);
      blocks.push(level === 1 ? <h1 key={index}>{children}</h1> : level === 2 ? <h2 key={index}>{children}</h2> : <h3 key={index}>{children}</h3>);
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) quote.push(lines[index++].trim().replace(/^>\s?/, ""));
      blocks.push(<blockquote key={index}>{quote.map((item, quoteIndex) => <p key={quoteIndex}>{inline(item)}</p>)}</blockquote>);
      continue;
    }

    if (line.startsWith("|") && index + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[index + 1].trim())) {
      const head = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) rows.push(cells(lines[index++]));
      blocks.push(<div className="legal-table-wrap" key={index}><table><thead><tr>{head.map((item, cellIndex) => <th key={cellIndex}>{inline(item)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((item, cellIndex) => <td key={cellIndex}>{inline(item)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) items.push(lines[index++].trim().replace(/^[-*]\s+/, ""));
      blocks.push(<ul key={index}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) items.push(lines[index++].trim().replace(/^\d+\.\s+/, ""));
      blocks.push(<ol key={index}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ol>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^(#{1,3})\s+|^>|^\||^[-*]\s+|^\d+\.\s+/.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(<p key={index}>{inline(paragraph.join(" "))}</p>);
  }

  return <div className="legal-markdown">{blocks}</div>;
}

export default function LegalPage() {
  const [document, setDocument] = useState<LegalDocument | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const documentId = new URLSearchParams(window.location.search).get("documentId");
    if (!documentId) {
      const timer = window.setTimeout(() => setError("未找到需要阅读的协议"), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    fetch(`/api/v1/legal-documents/${encodeURIComponent(documentId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("协议暂时无法打开");
        const payload = await response.json() as { data?: LegalDocument };
        if (!payload.data?.content) throw new Error("协议内容暂时不可用");
        setDocument(payload.data);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "协议暂时无法打开");
      });
    return () => controller.abort();
  }, []);

  return <main className="legal-page">
    <header className="legal-header">
      <button type="button" onClick={() => window.history.back()} aria-label="返回">←</button>
      <div><strong>初见 <span>FRESH</span></strong><small>{document ? `版本 ${document.version}` : "协议与隐私"}</small></div>
      <i aria-hidden="true" />
    </header>
    <article className="legal-paper" aria-busy={!document && !error}>
      {!document && !error && <div className="legal-state"><i>芽</i><p>正在为你展开这份说明…</p></div>}
      {error && <div className="legal-state legal-error"><i>!</i><h1>暂时没有打开</h1><p>{error}，请稍后再试。</p><button type="button" onClick={() => window.location.reload()}>重新加载</button></div>}
      {document && <><div className="legal-title"><small>{document.type === "PRIVACY_POLICY" ? "PRIVACY" : "TERMS"}</small><h1>{document.title}</h1><p>请花一点时间阅读，了解我们如何提供服务与守护你的信息。</p></div><MarkdownDocument content={document.content} /><footer>身心游（成都）文化科技有限公司</footer></>}
    </article>
  </main>;
}
