import type { EngineClient } from './EngineClient';
import { loadProgress } from './progressStorage';
import type {
  Language,
  LevelPayload,
  LevelSummary,
  MachineSnapshot,
  StepPayload,
  SubmitDto,
  UserProgress,
  WikiEntry,
} from './types';
import type { WorkerMethod, WorkerRequest, WorkerResponse } from './worker';

const REQUEST_TIMEOUT_MS = 10_000;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: number;
}

/**
 * 基于浏览器 Web Worker + `regzero-wasm` 的零安装在线引擎客户端。
 * 若发生异常超时，自动终止并重建 Worker，避免冻结主线程。
 */
export class OnlineWasmClient implements EngineClient {
  readonly backendKind = 'wasm' as const;

  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const resp = event.data;
      const entry = this.pending.get(resp.id);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      this.pending.delete(resp.id);
      if (resp.ok) {
        entry.resolve(resp.data);
      } else {
        entry.reject(new Error(resp.error ?? 'WASM 引擎返回未知错误'));
      }
    };
    worker.onerror = (err) => {
      this.resetWorker(new Error(`WASM Worker 异常：${err.message || '执行中断'}`));
    };
    this.worker = worker;
    return worker;
  }

  private resetWorker(reason: Error): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, entry] of this.pending) {
      window.clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.pending.clear();
  }

  private call<T>(method: WorkerMethod, params: Record<string, unknown> = {}): Promise<T> {
    const worker = this.ensureWorker();
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        this.resetWorker(new Error('执行超时（可能存在死循环），引擎已自动重启'));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      const req: WorkerRequest = { id, method, params };
      worker.postMessage(req);
    });
  }

  listLevels(progress?: UserProgress): Promise<LevelSummary[]> {
    const p = progress ?? loadProgress();
    return this.call<LevelSummary[]>('listLevels', { progressJson: JSON.stringify(p) });
  }

  loadLevel(levelId: string): Promise<LevelPayload> {
    return this.call<LevelPayload>('loadLevel', { levelId });
  }

  listWiki(): Promise<WikiEntry[]> {
    return this.call<WikiEntry[]>('listWiki');
  }

  loadWiki(topic: string): Promise<WikiEntry> {
    return this.call<WikiEntry>('loadWiki', { topic });
  }

  runCode(levelId: string, code: string, caseIndex?: number): Promise<MachineSnapshot> {
    return this.call<MachineSnapshot>('runCode', { levelId, code, caseIndex });
  }

  runSandbox(language: Language, code: string, inputText = ''): Promise<MachineSnapshot> {
    return this.call<MachineSnapshot>('runSandbox', { language, code, inputText });
  }

  submitCode(levelId: string, code: string): Promise<SubmitDto> {
    return this.call<SubmitDto>('submitCode', { levelId, code });
  }

  debugStart(levelId: string, code: string, caseIndex?: number): Promise<MachineSnapshot> {
    return this.call<MachineSnapshot>('debugStart', { levelId, code, caseIndex });
  }

  debugStartSandbox(language: Language, code: string, inputText = ''): Promise<MachineSnapshot> {
    return this.call<MachineSnapshot>('debugStartSandbox', { language, code, inputText });
  }

  debugStep(steps = 1): Promise<StepPayload> {
    return this.call<StepPayload>('debugStep', { steps });
  }

  debugStepBack(steps = 1): Promise<StepPayload> {
    return this.call<StepPayload>('debugStepBack', { steps });
  }

  debugContinue(): Promise<MachineSnapshot> {
    return this.call<MachineSnapshot>('debugContinue');
  }

  debugReset(): Promise<MachineSnapshot> {
    return this.call<MachineSnapshot>('debugReset');
  }

  async debugQuit(): Promise<void> {
    await this.call<null>('debugQuit');
  }

  debugReadMemory(startAddr: number, wordCount = 16): Promise<Record<string, number>> {
    return this.call<Record<string, number>>('debugReadMemory', { startAddr, wordCount });
  }
}

export const defaultEngineClient: EngineClient = new OnlineWasmClient();
