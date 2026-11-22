/// <reference lib="webworker" />
import init, { WasmEngine } from '../wasm-pkg/regzero_wasm.js';

export type WorkerMethod =
  | 'listLevels'
  | 'loadLevel'
  | 'listWiki'
  | 'loadWiki'
  | 'runCode'
  | 'runSandbox'
  | 'submitCode'
  | 'debugStart'
  | 'debugStartSandbox'
  | 'debugStep'
  | 'debugStepBack'
  | 'debugContinue'
  | 'debugReset'
  | 'debugQuit'
  | 'debugReadMemory';

export interface WorkerRequest {
  id: number;
  method: WorkerMethod;
  params: Record<string, unknown>;
}

export interface WorkerResponse {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: string;
}

let enginePromise: Promise<WasmEngine> | null = null;

async function getEngine(): Promise<WasmEngine> {
  if (!enginePromise) {
    enginePromise = init().then(() => new WasmEngine());
  }
  return enginePromise;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asOptionalNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

async function dispatch(req: WorkerRequest): Promise<unknown> {
  const engine = await getEngine();
  const p = req.params;

  switch (req.method) {
    case 'listLevels':
      return JSON.parse(engine.list_levels(asString(p.progressJson)));
    case 'loadLevel':
      return JSON.parse(engine.load_level(asString(p.levelId)));
    case 'listWiki':
      return JSON.parse(engine.list_wiki());
    case 'loadWiki':
      return JSON.parse(engine.load_wiki(asString(p.topic)));
    case 'runCode':
      return JSON.parse(
        engine.run_code(asString(p.levelId), asString(p.code), asOptionalNumber(p.caseIndex)),
      );
    case 'runSandbox':
      return JSON.parse(
        engine.run_sandbox(asString(p.language, 'asm'), asString(p.code), asString(p.inputText)),
      );
    case 'submitCode':
      return JSON.parse(
        engine.submit_code(asString(p.levelId), asString(p.code), asOptionalNumber(p.dynamicSeed)),
      );
    case 'debugStart':
      return JSON.parse(
        engine.debug_start(
          asString(p.levelId),
          asString(p.code),
          asOptionalNumber(p.caseIndex),
          asOptionalNumber(p.dynamicSeed),
        ),
      );
    case 'debugStartSandbox':
      return JSON.parse(
        engine.debug_start_sandbox(
          asString(p.language, 'asm'),
          asString(p.code),
          asString(p.inputText),
        ),
      );
    case 'debugStep':
      return JSON.parse(engine.debug_step(asOptionalNumber(p.steps) ?? 1));
    case 'debugStepBack':
      return JSON.parse(engine.debug_step_back(asOptionalNumber(p.steps) ?? 1));
    case 'debugContinue':
      return JSON.parse(engine.debug_continue());
    case 'debugReset':
      return JSON.parse(engine.debug_reset());
    case 'debugQuit':
      engine.debug_quit();
      return null;
    case 'debugReadMemory':
      return JSON.parse(
        engine.debug_read_memory(
          asOptionalNumber(p.startAddr) ?? 0x1000,
          asOptionalNumber(p.wordCount) ?? 16,
        ),
      );
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    const data = await dispatch(req);
    const resp: WorkerResponse = { id: req.id, ok: true, data };
    self.postMessage(resp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const resp: WorkerResponse = { id: req.id, ok: false, error: message };
    self.postMessage(resp);
  }
};
