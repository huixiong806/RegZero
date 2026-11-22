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

/**
 * 统一引擎客户端接口。
 *
 * 所有前端页面、Playground 与 4 套沙盘仅依赖此接口，
 * 未来切换至 `LocalBridgeClient`（127.0.0.1:17320）时零 UI 改造。
 */
export interface EngineClient {
  readonly backendKind: 'wasm' | 'bridge';

  listLevels(progress?: UserProgress): Promise<LevelSummary[]>;
  loadLevel(levelId: string): Promise<LevelPayload>;

  listWiki(): Promise<WikiEntry[]>;
  loadWiki(topic: string): Promise<WikiEntry>;

  runCode(levelId: string, code: string, caseIndex?: number): Promise<MachineSnapshot>;
  runSandbox(language: Language, code: string, inputText?: string): Promise<MachineSnapshot>;
  submitCode(levelId: string, code: string, dynamicSeed?: number): Promise<SubmitDto>;

  debugStart(
    levelId: string,
    code: string,
    caseIndex?: number,
    dynamicSeed?: number,
  ): Promise<MachineSnapshot>;
  debugStartSandbox(language: Language, code: string, inputText?: string): Promise<MachineSnapshot>;
  debugStep(steps?: number): Promise<StepPayload>;
  debugStepBack(steps?: number): Promise<StepPayload>;
  debugContinue(): Promise<MachineSnapshot>;
  debugReset(): Promise<MachineSnapshot>;
  debugQuit(): Promise<void>;
  debugReadMemory(startAddr: number, wordCount?: number): Promise<Record<string, number>>;
}
