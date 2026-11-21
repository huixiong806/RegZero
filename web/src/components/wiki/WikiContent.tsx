import type { FilteredWikiEntry } from '../../domain/knowledge';
import { SimpleMarkdown, renderInline } from '../level/SimpleMarkdown';

interface WikiContentProps {
  entry: FilteredWikiEntry;
  showTitle?: boolean;
}

/**
 * 结构化概念图鉴渲染器：
 * 只渲染经 `domain/knowledge.ts` 过滤后的已解锁分段、表格列与表格行，
 * 并为本关新解锁的知识项提供轻柔的 `NEW` 标记。
 */
export function WikiContent({ entry, showTitle = true }: WikiContentProps) {
  return (
    <div className="space-y-4">
      {showTitle && <h1 className="text-lg font-bold text-white">{entry.title}</h1>}

      {entry.summary && (
        <p className="text-xs leading-relaxed text-slate-300">{renderInline(entry.summary)}</p>
      )}

      {entry.sections.map((section) => (
        <section key={section.id} className="space-y-2">
          {section.heading && (
            <div className="flex items-center gap-2 pt-1">
              <h2 className="text-sm font-bold text-white">{section.heading}</h2>
              {section.isNew && section.kind === 'markdown' && (
                <span className="rounded-full border border-cyan-400/50 bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-300">
                  NEW
                </span>
              )}
            </div>
          )}

          {section.kind === 'markdown' ? (
            <SimpleMarkdown content={section.markdown} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/90 text-slate-300">
                  <tr>
                    {section.columns.map((col) => (
                      <th
                        key={col.id}
                        className="border-b border-slate-800 px-3 py-2 font-semibold whitespace-nowrap"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-950/60 text-slate-300">
                  {section.rows.map((row) => (
                    <tr key={row.id} className={row.isNew ? 'bg-cyan-950/20' : undefined}>
                      {section.columns.map((col, colIdx) => (
                        <td key={col.id} className="px-3 py-2 align-top">
                          <div className="flex items-center gap-1.5">
                            <span>{renderInline(row.cells[col.id] ?? '')}</span>
                            {colIdx === 0 && row.isNew && (
                              <span className="rounded bg-cyan-500/20 px-1 py-0.5 font-mono text-[9px] font-bold text-cyan-300">
                                NEW
                              </span>
                            )}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
