/**
 * JSON state management for pitboss (~/.pitboss/state.json).
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

import type { Todo, SignalData, AppState, ProjectTracking } from "./types.js";
import { CODE_DIR } from "./config.js";

const STATE_DIR = path.join(os.homedir(), ".pitboss");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const SIGNALS_DIR = path.join(STATE_DIR, "signals");
const TRACKING_FILE = path.join(STATE_DIR, "tracking.json");

const DEFAULT_STATE: AppState = {
  todos: [],
  projectAliases: {},
};

function ensureDir(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function load(): AppState {
  ensureDir();
  if (!fs.existsSync(STATE_FILE)) {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
}

export function save(state: AppState): void {
  ensureDir();
  const tmp = STATE_FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch {
    // Race condition — safe to ignore
  }
}

export function addTodo(text: string, project: string | null = null): Todo {
  const state = load();
  const todo: Todo = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 8),
    project,
    text,
    done: false,
    doneAt: null,
  };
  state.todos.push(todo);
  save(state);
  return todo;
}

export function toggleTodo(todoId: string): Todo | null {
  const state = load();
  for (const todo of state.todos) {
    if (todo.id === todoId) {
      todo.done = !todo.done;
      todo.doneAt = todo.done ? Date.now() / 1000 : null;
      save(state);
      return todo;
    }
  }
  return null;
}

export function cleanupDoneTodos(maxAge = 300): Todo[] {
  const now = Date.now() / 1000;
  const s = load();
  const before = s.todos.length;
  s.todos = s.todos.filter(
    (t) => !t.done || now - (t.doneAt || 0) < maxAge
  );
  if (s.todos.length < before) {
    save(s);
  }
  return s.todos;
}

export function deleteTodo(todoId: string): void {
  const state = load();
  state.todos = state.todos.filter((t) => t.id !== todoId);
  save(state);
}

export function listTodos(project?: string | null): Todo[] {
  const state = load();
  let todos = state.todos;
  if (project !== undefined && project !== null) {
    todos = todos.filter((t) => t.project === project);
  }
  return todos;
}

// --- TODO.md file monitoring ---

const TODO_CHECK_RE = /^[\s]*[-*]\s*\[([ xX])\]\s*(.*)/gm;

export function readFileTodos(projectName: string): Todo[] {
  const todoPath = path.join(CODE_DIR, projectName, "TODO.md");
  if (!fs.existsSync(todoPath)) {
    return [];
  }
  let content: string;
  try {
    content = fs.readFileSync(todoPath, "utf-8");
  } catch {
    return [];
  }
  const todos: Todo[] = [];
  let match: RegExpExecArray | null;
  while ((match = TODO_CHECK_RE.exec(content)) !== null) {
    const done = match[1].toLowerCase() === "x";
    if (done) continue;
    const text = match[2].trim();
    if (text) {
      const hash = (
        Array.from(text).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0) >>> 0
      )
        .toString(16)
        .padStart(8, "0");
      todos.push({
        id: `file_${hash}`,
        project: projectName,
        text,
        done: false,
        doneAt: null,
        source: "file",
      });
    }
  }
  // Reset lastIndex for the global regex
  TODO_CHECK_RE.lastIndex = 0;
  return todos;
}

// --- Session signals ---

export function signal(tty: string, status: string, detail = ""): void {
  fs.mkdirSync(SIGNALS_DIR, { recursive: true });
  const ttyName = tty.replace("/dev/", "").replace(/\//g, "_");
  const filePath = path.join(SIGNALS_DIR, `tty_${ttyName}.json`);
  const data: SignalData = {
    tty,
    status,
    detail,
    ts: Date.now() / 1000,
  };
  const tmp = filePath + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, filePath);
  } catch {
    // Race condition — safe to ignore
  }
}

export function readSignals(): {
  ttySignals: Record<string, SignalData>;
  projectSignals: Record<string, SignalData>;
} {
  if (!fs.existsSync(SIGNALS_DIR) || !fs.statSync(SIGNALS_DIR).isDirectory()) {
    return { ttySignals: {}, projectSignals: {} };
  }

  const ttySignals: Record<string, SignalData> = {};
  const projectSignals: Record<string, SignalData> = {};
  const now = Date.now() / 1000;

  for (const fname of fs.readdirSync(SIGNALS_DIR)) {
    if (!fname.endsWith(".json")) continue;
    const filePath = path.join(SIGNALS_DIR, fname);
    try {
      const data: SignalData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      // Expire signals older than 120 seconds
      if (now - (data.ts || 0) > 120) {
        fs.unlinkSync(filePath);
        continue;
      }
      const tty = data.tty || "";
      if (tty) {
        ttySignals[tty] = data;
      }
      if (data.projectDir) {
        const pdir = data.projectDir;
        if (!projectSignals[pdir] || data.ts > (projectSignals[pdir].ts || 0)) {
          projectSignals[pdir] = data;
        }
      }
    } catch {
      continue;
    }
  }

  return { ttySignals, projectSignals };
}

// --- Session tracking (busy start times) ---

function _loadTracking(): Record<string, ProjectTracking> {
  if (fs.existsSync(TRACKING_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(TRACKING_FILE, "utf-8"));
    } catch {
      // ignore
    }
  }
  return {};
}

function _saveTracking(data: Record<string, ProjectTracking>): void {
  ensureDir();
  const tmp = TRACKING_FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, TRACKING_FILE);
  } catch {
    // Race condition with concurrent pitboss instances — safe to ignore
  }
}

export function updateTracking(
  sessions: Array<{ project?: string | null; signal?: string | null }>
): Record<string, ProjectTracking> {
  const tracking = _loadTracking();
  const now = Date.now() / 1000;
  const activeProjects = new Set<string>();

  for (const s of sessions) {
    const proj = s.project;
    if (!proj) continue;
    const sig = s.signal;
    if (sig === "busy" || sig === "thinking" || sig === "waiting") {
      activeProjects.add(proj);
      if (!tracking[proj]) {
        tracking[proj] = { started: now, lastSeen: now, lastStatus: sig };
      } else {
        const prev = tracking[proj].lastStatus;
        // Reset timer on transition into busy (new action starting)
        // waiting→busy = new prompt, done→busy = new session, etc.
        if (sig === "busy" && prev !== "busy" && prev !== "thinking") {
          tracking[proj].started = now;
        }
        // Start timer if we never had one
        if (tracking[proj].started == null) {
          tracking[proj].started = now;
        }
        tracking[proj].lastSeen = now;
        tracking[proj].lastStatus = sig;
        delete tracking[proj].idleSince;
      }
    } else if (sig === "done" || sig === "error" || sig === "offline") {
      if (tracking[proj]) {
        if (tracking[proj].started !== undefined) {
          tracking[proj].finalDuration = now - tracking[proj].started!;
        }
        tracking[proj].ended = now;
        tracking[proj].lastStatus = sig;
        if (tracking[proj].idleSince === undefined) {
          tracking[proj].idleSince = now;
        }
      }
    }
  }

  // For projects with sessions but no signal (truly idle), track idle time
  const projNames = new Set<string>();
  for (const s of sessions) {
    if (s.project) projNames.add(s.project);
  }
  for (const p of projNames) {
    if (!activeProjects.has(p)) {
      if (!tracking[p]) {
        tracking[p] = { idleSince: now };
      } else if (tracking[p].idleSince === undefined) {
        tracking[p].idleSince = now;
      }
    }
  }

  // Clean up projects that have been idle for > 1 hour
  const expired = Object.keys(tracking).filter((p) => {
    if (activeProjects.has(p)) return false;
    const v = tracking[p];
    const lastTime = v.lastSeen ?? v.idleSince ?? now;
    return now - lastTime > 3600;
  });
  for (const p of expired) {
    delete tracking[p];
  }

  _saveTracking(tracking);
  return tracking;
}
