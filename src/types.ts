export interface PaneInfo {
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  paneId: string;
  paneTty: string;
  panePid: number;
  paneCurrentCommand: string;
  paneCurrentPath: string;
  paneActive: boolean;
  windowActive: boolean;
}

export interface Session {
  id: string;
  name: string;
  tty: string;
  cwd: string;
  project: string | null;
  branch: string | null;
  process: string;
  active: boolean;
  focused: boolean;
  signal: string | null;
  signalDetail: string;
  signalDuration: number | null;
  devServer: [string, number] | null;
  diffStat: { added: number; removed: number } | null;
  windowIndex: number;
  windowName: string;
}

export interface Todo {
  id: string;
  project: string | null;
  text: string;
  done: boolean;
  doneAt: number | null;
  source?: string;
}

export interface ProjectTracking {
  started?: number;
  lastSeen?: number;
  lastStatus?: string;
  ended?: number;
  finalDuration?: number;
  idleSince?: number;
}

export interface SignalData {
  tty?: string;
  projectDir?: string;
  sessionId?: string;
  status: string;
  detail: string;
  ts: number;
}

export interface AppState {
  todos: Todo[];
  projectAliases: Record<string, string>;
}
