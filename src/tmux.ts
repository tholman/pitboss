/**
 * tmux session management for pitboss.
 *
 * Layout: single window with TUI sidebar on the left and a 2x2 grid
 * of project panes on the right.
 *
 * ┌──────────┬───────────┬───────────┐
 * │          │     1     │     2     │
 * │   TUI    │           │           │
 * │          ├───────────┼───────────┤
 * │          │     3     │     4     │
 * │          │           │           │
 * └──────────┴───────────┴───────────┘
 *
 * Supports multiple concurrent sessions: pitboss, pitboss-2, pitboss-3, etc.
 */

import { execFileSync } from "child_process";
import os from "os";
import path from "path";

import type { PaneInfo } from "./types.js";
import { CODE_DIR } from "./config.js";

const SESSION_PREFIX = "pitboss";

// Active session name — set by launch() or detected from environment
let activeSession: string = SESSION_PREFIX;

/** Get the current active session name. */
export function getSession(): string {
  return activeSession;
}

/** Set the active session name (used when detecting from inside tmux). */
export function setSession(name: string): void {
  activeSession = name;
}

export function run(...args: string[]): string {
  const result = execFileSync("tmux", args, {
    encoding: "utf-8",
    timeout: 10_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.trim();
}

function runSafe(...args: string[]): string {
  try {
    return run(...args);
  } catch {
    return "";
  }
}

/** Check if a specific session exists. */
function sessionExists(name: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", name], {
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/** Check if the active session is running. */
export function isRunning(): boolean {
  return sessionExists(activeSession);
}

/** Find all running pitboss sessions. */
export function listSessions(): string[] {
  const raw = runSafe("list-sessions", "-F", "#{session_name}");
  if (!raw) return [];
  return raw.split("\n").filter((s) => s === SESSION_PREFIX || s.startsWith(SESSION_PREFIX + "-"));
}

/** Find the next available session name. */
function nextSessionName(): string {
  if (!sessionExists(SESSION_PREFIX)) return SESSION_PREFIX;
  for (let i = 2; i < 100; i++) {
    const name = `${SESSION_PREFIX}-${i}`;
    if (!sessionExists(name)) return name;
  }
  throw new Error("Too many pitboss sessions");
}

/** Detect which pitboss session we're inside (if any). */
export function detectCurrentSession(): string | null {
  if (!process.env.TMUX) return null;
  try {
    const name = run("display-message", "-p", "#{session_name}");
    if (name === SESSION_PREFIX || name.startsWith(SESSION_PREFIX + "-")) {
      return name;
    }
  } catch { /* ignore */ }
  return null;
}

const cliScript = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../dist/cli.js"
);

export function pitbossCmd(): string {
  try {
    execFileSync("which", ["pitboss"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return "pitboss";
  } catch {
    return `${process.execPath} ${cliScript}`;
  }
}

/** TUI command with --watch for hot-reload when dist/ changes */
export function pitbossTuiCmd(): string {
  return `${process.execPath} --watch ${cliScript} --tui`;
}

export function launch(panes = 4): string {
  // Pick next available name — allows multiple concurrent sessions
  const sessionName = nextSessionName();
  activeSession = sessionName;

  const cols = process.stdout.columns || 200;
  const rows = (process.stdout.rows || 50) - 1;

  // Create session with TUI in pane 0
  // node --watch auto-restarts when dist/ changes (pair with tsc --watch)
  const wrappedCmd = `${pitbossTuiCmd()}; exec $SHELL`;
  run(
    "new-session", "-d", "-s", sessionName, "-n", "main",
    "-x", String(cols), "-y", String(rows), "-c", CODE_DIR,
    "sh", "-c", wrappedCmd
  );

  // Build the grid
  buildGrid(panes);

  // Style
  const label = sessionName === SESSION_PREFIX ? "PITBOSS" : sessionName.toUpperCase();
  run("set-option", "-t", sessionName, "status-style", "bg=black,fg=white");
  run("set-option", "-t", sessionName, "status-left", `#[fg=cyan,bold] ${label} `);
  run("set-option", "-t", sessionName, "status-left-length", "20");
  run("set-option", "-t", sessionName, "status-right", " ");
  run("set-option", "-t", sessionName, "status-right-length", "0");
  run("set-option", "-t", sessionName, "mouse", "on");
  run("set-option", "-t", sessionName, "pane-border-status", "top");
  run("set-option", "-t", sessionName, "pane-border-format", " #{pane_title} ");
  run("set-option", "-t", sessionName, "pane-border-lines", "double");
  run("set-option", "-t", sessionName, "set-titles", "off");
  run("set-option", "-t", sessionName, "automatic-rename", "off");

  // Keybindings
  for (let i = 0; i < 5; i++) {
    run("bind-key", String(i), "select-pane", "-t", `${sessionName}:main.${i}`);
  }

  // Focus pane 1 (first shell)
  run("select-pane", "-t", `${sessionName}:main.1`);

  return sessionName;
}

export function buildGrid(n: number): void {
  const t = `${activeSession}:main`;

  // Split off right side (80%) — TUI gets ~20%
  run("split-window", "-t", `${t}.0`, "-h", "-l", "80%", "-c", CODE_DIR);

  if (n < 2) return;

  // Split right into top/bottom
  run("split-window", "-t", `${t}.1`, "-v", "-l", "50%", "-c", CODE_DIR);

  if (n < 3) return;

  // Split top-right into left/right
  run("split-window", "-t", `${t}.1`, "-h", "-l", "50%", "-c", CODE_DIR);

  if (n < 4) return;

  // Split bottom into left/right
  run("split-window", "-t", `${t}.3`, "-h", "-l", "50%", "-c", CODE_DIR);
}

export function addProject(name: string, projectDir?: string): void {
  if (!isRunning()) {
    throw new Error("pitboss session not running");
  }

  const dir = projectDir ?? path.join(CODE_DIR, name);
  const t = `${activeSession}:main`;
  const panes = listPanes();
  const projectPanes = panes.filter(
    (p) => p.windowName === "main" && p.paneIndex !== 0
  );

  if (projectPanes.length === 0) {
    run("split-window", "-t", `${t}.0`, "-h", "-l", "80%", "-c", dir);
    run("send-keys", "-t", `${t}.1`, `cd ${dir} && claude`, "Enter");
  } else {
    const last = projectPanes[projectPanes.length - 1];
    run("split-window", "-t", `${t}.${last.paneIndex}`, "-v", "-l", "50%", "-c", dir);
    const newPanes = listPanes();
    const newIdx = Math.max(...newPanes.map((p) => p.paneIndex));
    run("send-keys", "-t", `${t}.${newIdx}`, `cd ${dir} && claude`, "Enter");
  }

  run("select-pane", "-t", `${t}.0`);
}

export function focusPane(paneIndex: number): void {
  run("select-pane", "-t", `${activeSession}:main.${paneIndex}`);
}

export function focusProject(name: string): void {
  const panes = listPanes();
  for (const p of panes) {
    if (p.paneIndex === 0) continue;
    const proj = paneProject(p);
    if (proj && proj.toLowerCase() === name.toLowerCase()) {
      focusPane(p.paneIndex);
      return;
    }
  }
  throw new Error(`No pane found for project: ${name}`);
}

export function focusWindow(index: number): void {
  const panes = listPanes();
  const projectPanes = panes.filter((p) => p.paneIndex !== 0);
  if (index >= 1 && index <= projectPanes.length) {
    focusPane(projectPanes[index - 1].paneIndex);
  } else {
    throw new Error(`No project at index ${index}`);
  }
}

export function paneProject(pane: PaneInfo): string | null {
  const cwd = pane.paneCurrentPath || "";
  if (cwd.startsWith(CODE_DIR + "/")) {
    const rel = cwd.slice(CODE_DIR.length + 1);
    return rel ? rel.split("/")[0] : null;
  }
  return null;
}

export function listPanes(): PaneInfo[] {
  if (!isRunning()) return [];

  const fmt =
    "#{window_index}\t#{window_name}\t#{pane_index}\t#{pane_id}\t#{pane_tty}\t#{pane_pid}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_active}\t#{window_active}";
  const raw = runSafe("list-panes", "-s", "-t", activeSession, "-F", fmt);
  if (!raw) return [];

  const panes: PaneInfo[] = [];
  for (const line of raw.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 10) continue;
    panes.push({
      windowIndex: parseInt(parts[0], 10),
      windowName: parts[1],
      paneIndex: parseInt(parts[2], 10),
      paneId: parts[3],
      paneTty: parts[4],
      panePid: parseInt(parts[5], 10) || 0,
      paneCurrentCommand: parts[6],
      paneCurrentPath: parts[7],
      paneActive: parts[8] === "1",
      windowActive: parts[9] === "1",
    });
  }
  return panes;
}

export function fix(): void {
  if (!isRunning()) {
    throw new Error("pitboss session not running");
  }

  const t = `${activeSession}:main`;
  const panes = listPanes();

  const pane0 = panes.find((p) => p.paneIndex === 0);
  const hasTui = pane0 && (pane0.paneCurrentCommand === "node" || pane0.paneCurrentCommand === "pitboss");

  if (!hasTui) {
    const wrappedCmd = `${pitbossTuiCmd()}; exec $SHELL`;
    run("split-window", "-t", `${t}.0`, "-hb", "-l", "20%", "-c", CODE_DIR, "sh", "-c", wrappedCmd);
  }

  const refreshed = listPanes();
  const total = refreshed.length;

  if (total < 2) return;

  const winWidth = parseInt(runSafe("display-message", "-t", t, "-p", "#{window_width}"), 10);
  const winHeight = parseInt(runSafe("display-message", "-t", t, "-p", "#{window_height}"), 10);

  if (!winWidth || !winHeight) return;

  const sidebarWidth = Math.floor(winWidth * 0.2);
  const halfRight = Math.floor((winWidth - sidebarWidth - 1) / 2);
  const halfHeight = Math.floor(winHeight / 2);

  runSafe("resize-pane", "-t", `${t}.0`, "-x", String(sidebarWidth));

  const projectPanes = refreshed.filter((p) => p.paneIndex !== 0);
  if (projectPanes.length === 2 && projectPanes[0]) {
    runSafe("resize-pane", "-t", `${t}.${projectPanes[0].paneIndex}`, "-y", String(halfHeight));
  } else if (projectPanes.length === 3 && projectPanes[0]) {
    runSafe("resize-pane", "-t", `${t}.${projectPanes[0].paneIndex}`, "-x", String(halfRight), "-y", String(halfHeight));
  } else if (projectPanes.length >= 4 && projectPanes[0] && projectPanes[2]) {
    runSafe("resize-pane", "-t", `${t}.${projectPanes[0].paneIndex}`, "-x", String(halfRight), "-y", String(halfHeight));
    runSafe("resize-pane", "-t", `${t}.${projectPanes[2].paneIndex}`, "-x", String(halfRight));
  }

  runSafe("set-option", "-t", activeSession, "mouse", "on");
  runSafe("set-option", "-t", activeSession, "pane-border-status", "top");

  console.log(`Fixed layout: 1 TUI + ${projectPanes.length} project panes`);
}

export function attach(): void {
  if (!isRunning()) {
    throw new Error("pitboss session not running");
  }

  if (process.env.TMUX) {
    run("switch-client", "-t", activeSession);
  } else {
    execFileSync("tmux", ["attach-session", "-t", activeSession], {
      stdio: "inherit",
    });
  }
}
