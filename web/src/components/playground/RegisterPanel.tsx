import { useState } from 'react';
import { FULL_UI_DISCLOSURE, type UiDisclosure } from '../../domain/knowledge';
import {
  RV32_REGISTERS,
  formatRegValue,
  normalizeRegKey,
} from '../../domain/registers';

interface RegisterPanelProps {
  title?: string;
  regs: Record<string, number>;
  focusRegs?: string[];
  regRoles?: Record<string, string>;
  changedRegs: Record<string, number>;
  flashNonce: number;
  disclosure?: UiDisclosure;
}

export function RegisterPanel({
  title = '寄存器状态',
  regs,
  focusRegs = ['t0', 't1', 't2', 't3', 't4', 'a0', 'sp', 'ra'],
  regRoles,
  changedRegs,
  flashNonce,
  disclosure = FULL_UI_DISCLOSURE,
}: RegisterPanelProps) {
  const [radix, setRadix] = useState<'dec' | 'hex'>('dec');
  const [showAll, setShowAll] = useState(false);

  const effectiveRadix = disclosure.showHexToggle ? radix : 'dec';
  const effectiveShowAll = disclosure.showAllRegsToggle && showAll;

  const focusKeys = new Set(focusRegs.map(normalizeRegKey));
  const changedKeys = new Set(Object.keys(changedRegs).map(normalizeRegKey));

  const visibleRegs = effectiveShowAll
    ? RV32_REGISTERS
    : RV32_REGISTERS.filter(
        (r) =>
          focusKeys.has(r.xName) ||
          changedKeys.has(r.xName) ||
          (disclosure.showUntrackedNonZeroRegs && (regs[r.xName] ?? 0) !== 0),
      );

  const displayList = visibleRegs.length > 0 ? visibleRegs : RV32_REGISTERS.slice(0, 8);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-400">{title}</span>
        {(disclosure.showHexToggle || disclosure.showAllRegsToggle) && (
          <div className="flex items-center gap-1">
            {disclosure.showHexToggle && (
              <button
                type="button"
                onClick={() => setRadix((r) => (r === 'dec' ? 'hex' : 'dec'))}
                className="rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-slate-400 hover:text-cyan-300"
              >
                {effectiveRadix === 'dec' ? 'DEC' : 'HEX'}
              </button>
            )}
            {disclosure.showAllRegsToggle && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-slate-400 hover:text-cyan-300"
              >
                {effectiveShowAll ? 'FOCUS' : 'ALL 32'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
        {displayList.map((reg) => {
          const val = regs[reg.xName] ?? 0;
          const changed = changedKeys.has(reg.xName);
          const isFocus = focusKeys.has(reg.xName);
          const cornerTag = disclosure.showRegXName ? reg.xName : regRoles?.[reg.abi] ?? '';

          return (
            <div
              key={`${reg.xName}-${changed ? flashNonce : 0}`}
              className={`rounded-xl border px-2.5 py-1.5 font-mono transition ${
                changed
                  ? 'nmc-flash-write border-cyan-400 bg-cyan-950/35'
                  : isFocus
                    ? 'border-slate-700/80 bg-slate-950/80'
                    : 'border-slate-800/70 bg-slate-950/40'
              }`}
            >
              <div className="flex items-center justify-between gap-1 text-[10px]">
                <span className={isFocus ? 'font-bold text-amber-300' : 'text-slate-500'}>
                  {reg.abi}
                </span>
                {cornerTag && (
                  <span className="truncate font-sans text-[10px] text-slate-500">
                    {cornerTag}
                  </span>
                )}
              </div>
              <div
                className={`mt-0.5 truncate text-sm font-bold ${
                  changed ? 'text-cyan-200' : val !== 0 ? 'text-slate-100' : 'text-slate-600'
                }`}
              >
                {formatRegValue(val, effectiveRadix)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
