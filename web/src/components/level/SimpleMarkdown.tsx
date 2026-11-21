import type { ReactNode } from 'react';

interface SimpleMarkdownProps {
  content: string;
}

/** 行内格式渲染（粗体 + 行内代码），零外部重型依赖。 */
export function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return tokens.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[0.9em] text-cyan-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/** 轻量 Markdown 渲染器，支持标题、围栏代码块、表格、引用与列表。 */
export function SimpleMarkdown({ content }: SimpleMarkdownProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 代码块
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={blocks.length}
          className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-cyan-200"
        >
          {codeLines.join('\n')}
        </pre>,
      );
      continue;
    }

    // 表格
    if (trimmed.startsWith('|') && i + 1 < lines.length && (lines[i + 1] ?? '').includes('---')) {
      const parseRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      const headers = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(parseRow(lines[i] ?? ''));
        i++;
      }
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi} className="border-b border-slate-800 px-3 py-1.5 font-semibold">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-950/60 text-slate-300">
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 标题
    if (trimmed.startsWith('### ')) {
      blocks.push(
        <h3 key={blocks.length} className="pt-2 text-sm font-bold text-cyan-300">
          {renderInline(trimmed.slice(4))}
        </h3>,
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push(
        <h2 key={blocks.length} className="pt-2 text-base font-bold text-white">
          {renderInline(trimmed.slice(3))}
        </h2>,
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push(
        <h1 key={blocks.length} className="text-lg font-bold text-white">
          {renderInline(trimmed.slice(2))}
        </h1>,
      );
      i++;
      continue;
    }

    // 引用
    if (trimmed.startsWith('> ')) {
      blocks.push(
        <blockquote
          key={blocks.length}
          className="rounded-r-lg border-l-2 border-cyan-500 bg-cyan-950/20 px-3 py-2 text-xs leading-relaxed text-slate-300"
        >
          {renderInline(trimmed.slice(2))}
        </blockquote>,
      );
      i++;
      continue;
    }

    // 无序列表
    if (trimmed.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('- ')) {
        items.push((lines[i] ?? '').trim().slice(2));
        i++;
      }
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-5 text-xs text-slate-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // 普通段落
    blocks.push(
      <p key={blocks.length} className="text-xs leading-relaxed text-slate-300">
        {renderInline(trimmed)}
      </p>,
    );
    i++;
  }

  return <div className="space-y-2.5">{blocks}</div>;
}
