import { useState } from 'react';

interface MemoryPanelProps {
  memoryWords: Record<string, number>;
  changedMemAddrs: Record<number, number>;
  flashNonce: number;
  canInspectRange: boolean;
  onInspectAddress?: (addr: number) => void;
}

export function MemoryPanel({
  memoryWords,
  changedMemAddrs,
  flashNonce,
  canInspectRange,
  onInspectAddress,
}: MemoryPanelProps) {
  const [addrInput, setAddrInput] = useState('0x1000');

  const changedWordKeys = new Set(
    Object.keys(changedMemAddrs).map((raw) => {
      const aligned = Number(raw) & ~3;
      return `0x${aligned.toString(16).toUpperCase().padStart(4, '0')}`;
    }),
  );

  const entries = Object.entries(memoryWords);

  const handleInspect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onInspectAddress) return;
    const trimmed = addrInput.trim();
    const parsed = trimmed.startsWith('0x') || trimmed.startsWith('0X')
      ? parseInt(trimmed.slice(2), 16)
      : parseInt(trimmed, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      onInspectAddress(parsed);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-200">内存监视器（32 位字视图）</span>
        {canInspectRange && onInspectAddress && (
          <form onSubmit={handleInspect} className="flex items-center gap-1">
            <input
              type="text"
              value={addrInput}
              onChange={(e) => setAddrInput(e.target.value)}
              placeholder="0x1000"
              className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-200 outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700"
            >
              查看地址
            </button>
          </form>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="font-mono text-[11px] text-slate-500">
          暂无非零数据内存（进入内存关卡或写入 0x1000+ 后会实时显示并高亮变化）。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {entries.map(([addr, val]) => {
            const changed = changedWordKeys.has(addr.toUpperCase());
            return (
              <div
                key={`${addr}-${changed ? flashNonce : 0}`}
                className={`rounded-lg border px-2 py-1.5 font-mono text-xs ${
                  changed
                    ? 'rz-flash-write border-cyan-400/70 bg-cyan-950/30 text-cyan-200'
                    : 'border-slate-800 bg-slate-950/60 text-slate-200'
                }`}
              >
                <div className="text-[10px] text-slate-500">{addr}</div>
                <div className="mt-0.5 font-semibold">{val}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
