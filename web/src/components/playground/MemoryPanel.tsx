import { useState } from 'react';

interface MemoryPanelProps {
  memoryWords: Record<string, number>;
  changedMemAddrs: Record<number, number>;
  flashNonce: number;
  canInspectRange: boolean;
  onInspectAddress?: (addr: number) => void;
}

type MemoryViewMode = 'word' | 'bytes';

function formatAsciiChar(byte: number): string {
  return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '·';
}

function wordToBytesLe(val: number): [number, number, number, number] {
  const u = val >>> 0;
  return [u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff];
}

/**
 * 通用内存监视器（支持 32 位字视图、字节/ASCII 视图及快捷地址区域跳转）。
 * 复用于第 1 章内存/字符串/程序代码区/栈帧及第 2~3 章内存观察。
 */
export function MemoryPanel({
  memoryWords,
  changedMemAddrs,
  flashNonce,
  canInspectRange,
  onInspectAddress,
}: MemoryPanelProps) {
  const [addrInput, setAddrInput] = useState('0x1000');
  const [viewMode, setViewMode] = useState<MemoryViewMode>('word');
  const [showHex, setShowHex] = useState(false);

  const changedWordKeys = new Set(
    Object.keys(changedMemAddrs).map((raw) => {
      const aligned = Number(raw) & ~3;
      return `0x${aligned.toString(16).toUpperCase().padStart(4, '0')}`;
    }),
  );

  const entries = Object.entries(memoryWords);

  const jumpTo = (addr: number, label: string) => {
    setAddrInput(label);
    onInspectAddress?.(addr);
  };

  const handleInspect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onInspectAddress) return;
    const trimmed = addrInput.trim();
    const parsed =
      trimmed.startsWith('0x') || trimmed.startsWith('0X')
        ? parseInt(trimmed.slice(2), 16)
        : parseInt(trimmed, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      onInspectAddress(parsed);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-200">内存监视器</span>
          <div className="inline-flex rounded-md border border-slate-800 bg-slate-950 p-0.5 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => setViewMode('word')}
              className={`rounded px-1.5 py-0.5 font-semibold transition ${
                viewMode === 'word' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              32位字
            </button>
            <button
              type="button"
              onClick={() => setViewMode('bytes')}
              className={`rounded px-1.5 py-0.5 font-semibold transition ${
                viewMode === 'bytes' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              字节/字符
            </button>
          </div>
          {viewMode === 'word' && (
            <button
              type="button"
              onClick={() => setShowHex((v) => !v)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition ${
                showHex
                  ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
              }`}
            >
              {showHex ? 'HEX' : 'DEC'}
            </button>
          )}
        </div>

        {canInspectRange && onInspectAddress && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => jumpTo(0x1000, '0x1000')}
              className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 hover:border-cyan-500/50 hover:text-cyan-200"
            >
              数据
            </button>
            <button
              type="button"
              onClick={() => jumpTo(0x0000, '0x0000')}
              className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 hover:border-cyan-500/50 hover:text-cyan-200"
            >
              代码
            </button>
            <button
              type="button"
              onClick={() => jumpTo(0xefe0, '0xEFE0')}
              className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 hover:border-cyan-500/50 hover:text-cyan-200"
            >
              栈区
            </button>
            <form onSubmit={handleInspect} className="flex items-center gap-1">
              <input
                type="text"
                value={addrInput}
                onChange={(e) => setAddrInput(e.target.value)}
                placeholder="0x1000"
                className="w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-200 outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700"
              >
                查看
              </button>
            </form>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="font-mono text-[11px] text-slate-500">
          暂无非零数据内存（运行或单步后，0x1000+ 数据区与变化地址会实时显示并高亮）。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {entries.map(([addr, val]) => {
            const changed = changedWordKeys.has(addr.toUpperCase());
            const bytes = wordToBytesLe(val);
            const hexStr = `0x${(val >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
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
                {viewMode === 'word' ? (
                  <div className="mt-0.5 truncate font-semibold">
                    {showHex ? hexStr : val}
                  </div>
                ) : (
                  <div className="mt-0.5 space-y-0.5">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      {bytes.map((b, i) => (
                        <span key={i}>{b.toString(16).toUpperCase().padStart(2, '0')}</span>
                      ))}
                    </div>
                    <div className="flex justify-between text-[11px] font-bold text-amber-200">
                      {bytes.map((b, i) => (
                        <span key={i}>{formatAsciiChar(b)}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
