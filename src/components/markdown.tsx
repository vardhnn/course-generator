import React from "react";

/**
 * Minimal markdown renderer for generated lesson bodies.
 * Deliberately supports only the subset the pipeline emits — headings,
 * paragraphs, fenced code, blockquotes, unordered lists and inline code.
 */

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`${keyPrefix}-c${n++}`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={`${keyPrefix}-b${n++}`}>{token.slice(2, -2)}</strong>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={`pre-${key++}`} data-lang={lang || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Heading
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s*/, "");
      blocks.push(
        level <= 2 ? (
          <h2 key={`h-${key++}`}>{inline(text, `h${key}`)}</h2>
        ) : (
          <h3 key={`h-${key++}`}>{inline(text, `h${key}`)}</h3>
        ),
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={`q-${key++}`}>
          <p>{inline(body.join(" ").trim(), `q${key}`)}</p>
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s/, ""));
        i++;
      }
      blocks.push(
        <ul key={`ul-${key++}`}>
          {items.map((item, idx) => (
            <li key={idx}>{inline(item, `li${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Paragraph — consume until a blank line or a new block marker
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !lines[i].startsWith(">") &&
      !/^\s*[-*]\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={`p-${key++}`}>{inline(para.join(" ").trim(), `p${key}`)}</p>);
  }

  return <div className="prose-lesson">{blocks}</div>;
}