import { useState } from 'react';
import { Copy, Zap } from 'lucide-react';
import type { ManualCpuAluOp, ManualCpuSandboxConfig } from '../../engine/types';
import type { SourceOperand } from './model';

export const OPERAND_DRAG_MIME = 'application/x-nmc-operand';
export const ALU_RESULT_DRAG_MIME = 'application/x-nmc-alu-result';

export type ActiveSlot = 'left' | 'right' | 'dest' | 'copySrc';

interface AluDeskProps {
  config: ManualCpuSandboxConfig;
  regs: Record<string, number>;
  left: SourceOperand | null;
  right: SourceOperand | null;
  op: ManualCpuAluOp;
  destReg: string | null;
  activeSlot: ActiveSlot;
  copySrc: SourceOperand | null;
  onSelectSlot: (slot: ActiveSlot) => void;
  onSelectOp: (op: ManualCpuAluOp) => void;
  onDropToSlot: (slot: 'left' | 'right', payload: SourceOperand) => void;
  onDropToDest: (payload: SourceOperand) => void;
  onExecuteAlu: () => void;
  onExecuteCopy: (dest: string) => void;
}

function parseDragPayload(raw: string): SourceOperand | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Partial<SourceOperand>;
    if (obj.kind === 'reg' && typeof obj.name === 'string') return { kind: 'reg', name: obj.name };
    if (obj.kind === 'const' && obj.card) return { kind: 'const', card: obj.card };
    return null;
  } catch {
    return null;
  }
}

function slotLabel(operand: SourceOperand | null, regs: Record<string, number>): { top: string; val: string } {
  if (!operand) return { top: '输入', val: '?' };
  if (operand.kind === 'reg') {
    return { top: operand.name, val: String(regs[operand.name] ?? 0) };
  }
  return { top: `#${operand.card.label}`, val: String(operand.card.value) };
}

export function AluDesk({
  config,
  regs,
  left,
  right,
  op,
  destReg,
  activeSlot,
  copySrc,
  onSelectSlot,
  onSelectOp,
  onDropToSlot,
  onDropToDest,
  onExecuteAlu,
  onExecuteCopy,
}: AluDeskProps) {
  const [dragOverTarget, setDragOverTarget] = useState<'left' | 'right' | 'dest' | null>(null);

  const ops = config.aluOps && config.aluOps.length > 0 ? config.aluOps : (['+'] as ManualCpuAluOp[]);
  const writableRegs = config.focusRegs.filter((r) => r !== 'zero');
  const inputsReady = Boolean(left && right);
  const canExecute = Boolean(left && right && destReg);
  const leftView = slotLabel(left, regs);
  const rightView = slotLabel(right, regs);

  const handleDragOverSlot = (target: 'left' | 'right' | 'dest') => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(OPERAND_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverTarget !== target) setDragOverTarget(target);
  };

  const handleDragLeaveSlot = (target: 'left' | 'right' | 'dest') => () => {
    setDragOverTarget((prev) => (prev === target ? null : prev));
  };

  const handleDrop = (slot: 'left' | 'right') => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTarget(null);
    const payload = parseDragPayload(e.dataTransfer.getData(OPERAND_DRAG_MIME));
    if (payload) onDropToSlot(slot, payload);
  };

  const handleDropDest = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTarget(null);
    const payload = parseDragPayload(e.dataTransfer.getData(OPERAND_DRAG_MIME));
    if (payload) onDropToDest(payload);
  };

  const handleDragResultStart = (e: React.DragEvent) => {
    if (!inputsReady) return;
    e.dataTransfer.setData(ALU_RESULT_DRAG_MIME, '1');
    e.dataTransfer.effectAllowed = 'copy';
  };

  const destActive = activeSlot === 'dest';
  const destOver = dragOverTarget === 'dest';

  return (
    <div className="space-y-2.5">
      {/* 图形化运算台 */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-3.5">
        {/* 上方双输入引脚 */}
        <div className="grid grid-cols-2 gap-4 px-2">
          {(['left', 'right'] as const).map((slot) => {
            const view = slot === 'left' ? leftView : rightView;
            const filled = slot === 'left' ? Boolean(left) : Boolean(right);
            const active = activeSlot === slot;
            const over = dragOverTarget === slot;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => onSelectSlot(slot)}
                onDragOver={handleDragOverSlot(slot)}
                onDragLeave={handleDragLeaveSlot(slot)}
                onDrop={handleDrop(slot)}
                className={`group flex flex-col items-center justify-center rounded-xl border-2 px-3 py-2 font-mono transition ${
                  over
                    ? 'scale-[1.02] border-cyan-300 bg-cyan-500/25 shadow-[0_0_18px_rgba(34,211,238,0.35)]'
                    : active
                      ? 'border-cyan-400 bg-cyan-500/15 shadow-[0_0_16px_rgba(34,211,238,0.2)]'
                      : filled
                        ? 'border-cyan-500/50 bg-slate-900'
                        : 'border-dashed border-slate-700 bg-slate-900/50 hover:border-slate-500'
                }`}
              >
                <span className="pointer-events-none text-[10px] font-semibold tracking-wider text-slate-400">
                  {view.top}
                </span>
                <span
                  className={`pointer-events-none text-lg font-bold ${
                    filled ? 'text-cyan-200' : 'text-slate-600'
                  }`}
                >
                  {view.val}
                </span>
              </button>
            );
          })}
        </div>

        {/* SVG 导线 + 梯形运算单元 */}
        <div className="relative mx-auto my-1 flex flex-col items-center">
          <svg
            viewBox="0 0 320 92"
            className="h-24 w-full max-w-[320px] select-none"
            aria-label="运算单元"
          >
            {/* 左/右输入导线 */}
            <path
              d="M 76 0 L 76 14 L 106 20"
              fill="none"
              stroke={left ? '#22d3ee' : '#334155'}
              strokeWidth={left ? 2.5 : 1.5}
              strokeDasharray={left ? undefined : '4 3'}
            />
            <path
              d="M 244 0 L 244 14 L 214 20"
              fill="none"
              stroke={right ? '#22d3ee' : '#334155'}
              strokeWidth={right ? 2.5 : 1.5}
              strokeDasharray={right ? undefined : '4 3'}
            />
            {/* 梯形运算外壳 */}
            <polygon
              points="70,20 142,20 160,33 178,20 250,20 222,76 98,76"
              fill={inputsReady ? 'rgba(8, 51, 68, 0.75)' : 'rgba(15, 23, 42, 0.9)'}
              stroke={inputsReady ? '#22d3ee' : '#334155'}
              strokeWidth={inputsReady ? 2 : 1.5}
            />
            {/* 输出导线 */}
            <line
              x1="160"
              y1="76"
              x2="160"
              y2="92"
              stroke={inputsReady || destReg ? '#34d399' : '#334155'}
              strokeWidth={inputsReady || destReg ? 2.5 : 1.5}
              strokeDasharray={inputsReady || destReg ? undefined : '4 3'}
            />
          </svg>

          {/* 嵌在运算单元中央的运算符胶囊（单运算符为静态标识，多运算符可点击切换） */}
          <div className="absolute top-[38px] flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/95 p-0.5 shadow">
            {ops.length === 1 ? (
              <span className="flex h-7 min-w-[28px] items-center justify-center rounded-full bg-cyan-400 px-2 font-mono text-sm font-bold text-slate-950 shadow select-none">
                {ops[0]}
              </span>
            ) : (
              ops.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onSelectOp(item)}
                  className={`h-7 min-w-[28px] rounded-full px-2 font-mono text-sm font-bold transition ${
                    op === item
                      ? 'bg-cyan-400 text-slate-950 shadow'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item}
                </button>
              ))
            )}
          </div>
        </div>

        {/* 输出端：存入拖放槽（居中对齐输出导线）+ 触发按钮 */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
          <button
            type="button"
            aria-label="输出目标寄存器"
            draggable={inputsReady}
            onDragStart={handleDragResultStart}
            onClick={() => onSelectSlot('dest')}
            onDragOver={handleDragOverSlot('dest')}
            onDragLeave={handleDragLeaveSlot('dest')}
            onDrop={handleDropDest}
            className={`col-start-2 flex min-w-[104px] flex-col items-center justify-center rounded-xl border-2 px-4 py-1.5 font-mono transition ${
              destOver
                ? 'scale-[1.02] border-emerald-300 bg-emerald-500/25 shadow-[0_0_18px_rgba(52,211,153,0.35)]'
                : destActive
                  ? 'border-emerald-400 bg-emerald-500/15 shadow-[0_0_16px_rgba(52,211,153,0.22)]'
                  : destReg
                    ? 'border-emerald-500/55 bg-slate-900 hover:border-emerald-400'
                    : 'border-dashed border-slate-700 bg-slate-900/50 hover:border-emerald-500/60'
            }`}
          >
            <span className="pointer-events-none font-sans text-[10px] font-semibold text-emerald-400">
              存入
            </span>
            <span
              className={`pointer-events-none text-base font-bold ${
                destReg ? 'text-emerald-200' : 'text-slate-600'
              }`}
            >
              {destReg ?? '?'}
            </span>
          </button>

          <button
            type="button"
            disabled={!canExecute}
            onClick={onExecuteAlu}
            className="col-start-3 inline-flex items-center justify-self-start gap-1.5 whitespace-nowrap rounded-xl bg-cyan-400 px-3.5 py-2 text-xs font-bold text-slate-950 shadow transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            <Zap className="h-3.5 w-3.5" /> 执行
          </button>
        </div>
      </div>

      {/* 极简搬运通道（仅允许 mv 关启用） */}
      {config.allowCopy && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Copy className="h-3.5 w-3.5 text-amber-400" />
            <button
              type="button"
              onClick={() => onSelectSlot('copySrc')}
              className={`rounded-md border px-2 py-0.5 font-mono text-xs font-semibold transition ${
                activeSlot === 'copySrc'
                  ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300'
              }`}
            >
              {copySrc ? slotLabel(copySrc, regs).top : '选源'}
            </button>
            <span className="text-xs text-slate-500">→</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {writableRegs.map((target) => (
              <button
                key={target}
                type="button"
                disabled={!copySrc || (copySrc.kind === 'reg' && copySrc.name === target)}
                onClick={() => onExecuteCopy(target)}
                className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-30"
              >
                {target}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
