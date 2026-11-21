import { ALL_DATAPATH_STAGES, stageOrder, type DatapathStage } from './datapathTimeline';

interface StageStripProps {
  activeStage: DatapathStage;
  memoryUnlocked: boolean;
  /** 本条指令是否实际使用访存阶段（非直通）。 */
  memoryActiveInOp?: boolean;
}

/**
 * 顶部 5 阶段状态灯带：`取指 → 译码 → 执行 → 访存 → 写回`。
 * 未学到内存前，`访存` 保持柔和虚线直通样式，种下完整 5 阶段体系结构心智。
 */
export function StageStrip({
  activeStage,
  memoryUnlocked,
  memoryActiveInOp = false,
}: StageStripProps) {
  const currentOrd = stageOrder(activeStage);
  const visibleStages = ALL_DATAPATH_STAGES.filter(
    (s) => s.id !== 'memory' || memoryUnlocked || memoryActiveInOp,
  );

  return (
    <div className="flex items-center justify-between gap-1 rounded-xl border border-slate-800/90 bg-slate-950/90 px-2 py-1.5">
      {visibleStages.map((item, idx) => {
        const ord = stageOrder(item.id);
        const isCurrent = activeStage === item.id;
        const isDone = currentOrd > ord;
        const isWriteback = item.id === 'writeback';
        const isMemMuted = item.id === 'memory' && !memoryActiveInOp;

        let pillCls = 'border-slate-800 bg-slate-900/60 text-slate-500';
        if (isCurrent) {
          pillCls = isWriteback
            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200 shadow-[0_0_12px_rgba(52,211,153,0.3)]'
            : isMemMuted
              ? 'border-slate-600 bg-slate-800/80 text-slate-300'
              : 'border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.28)]';
        } else if (isDone) {
          pillCls = isMemMuted
            ? 'border-dashed border-slate-800 bg-slate-900/40 text-slate-500'
            : 'border-cyan-500/35 bg-cyan-950/25 text-cyan-300/80';
        } else if (isMemMuted) {
          pillCls = 'border-dashed border-slate-800/80 bg-slate-950/50 text-slate-600';
        }

        return (
          <div key={item.id} className="flex flex-1 items-center gap-1">
            <div
              className={`flex w-full items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] font-semibold transition-all duration-150 ${pillCls}`}
            >
              <span className="font-mono text-[9px] opacity-70">{idx + 1}</span>
              <span className="whitespace-nowrap">{item.label}</span>
            </div>
            {idx < visibleStages.length - 1 && (
              <span
                className={`text-[10px] ${
                  isDone ? 'text-cyan-400/80' : 'text-slate-700'
                }`}
              >
                ›
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
