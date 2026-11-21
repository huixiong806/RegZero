import type { ReactNode } from 'react';
import type { UiDisclosure } from '../domain/knowledge';
import type { SandboxConfig } from '../engine/types';
import { ManualCpuSandbox } from './manual-cpu/ManualCpuSandbox';

export interface SandboxRenderProps {
  config: SandboxConfig;
  disclosure?: UiDisclosure;
  onFocusEditor?: () => void;
}

/**
 * 可扩展沙盘注册表。
 *
 * 关卡页只调用 `renderSandbox`，后续接入第 2~7 章的
 * `memory-canvas` / `lexer-ast-lab` / `pipeline-stage` 时只需在此注册新引擎，零侵入页面层。
 */
export function renderSandbox({
  config,
  disclosure,
  onFocusEditor,
}: SandboxRenderProps): ReactNode {
  switch (config.type) {
    case 'manual-cpu':
      return (
        <ManualCpuSandbox
          config={config}
          showRegXName={disclosure?.showRegXName ?? false}
          onFocusEditor={onFocusEditor}
        />
      );
    case 'memory-canvas':
    case 'lexer-ast-lab':
    case 'pipeline-stage':
      return (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-xs text-slate-300">
          沙盘引擎 <code className="text-cyan-300">{config.type}</code> 已预留注册接口，将在对应阶段启用。
        </div>
      );
  }
}
