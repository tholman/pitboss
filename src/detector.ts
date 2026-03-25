/**
 * Session and project detection via tmux.
 */

import { execFileSync } from "child_process";
import os from "os";
import path from "path";

import type { Session, PaneInfo, SignalData } from "./types.js";
import { CODE_DIR } from "./config.js";
import * as tmux from "./tmux.js";
import * as state from "./state.js";

const IDLE_COMMANDS = new Set(["zsh", "bash", "fish", "login", "sh"]);
const BACKGROUND_NOISE = new Set([
  "gitstatusd",
  "gitstatusd-darwin-arm64",
  "caffeinate",
]);

const DEV_SERVER_PATTERNS: Record<string, number | null> = {
  next: 3000,
  vite: 5173,
  node: null,
  npm: null,
  python3: null,
  python: null,
  ruby: null,
  cargo: null,
  go: null,
};

export function detectProcess(tty: string): [string, boolean] {
  if (!tty || tty === "unknown") return ["unknown", false];
  const ttyShort = tty.replace("/dev/", "");
  try {
    const result = execFileSync("ps", ["-t", ttyShort, "-o", "command="], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = result
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.startsWith("-") || line.includes("ps -t") || line.startsWith("login")) {
        continue;
      }
      const parts = line.split(/\s+/);
      const cmd = path.basename(parts[0]);
      if (IDLE_COMMANDS.has(cmd) || BACKGROUND_NOISE.has(cmd)) continue;
      if (cmd === "pitboss") continue;
      // Clean up display: use basename for script paths, skip long absolute paths
      let arg1 = parts.length > 1 ? parts[1] : "";
      if (arg1.startsWith("/") || arg1.startsWith("~")) {
        arg1 = path.basename(arg1, path.extname(arg1));
      }
      const label = arg1 ? `${cmd} ${arg1}` : cmd;
      return [label, true];
    }
    return ["zsh", false];
  } catch {
    return ["unknown", false];
  }
}

export function detectBranch(cwd: string): string | null {
  if (!cwd || cwd === "unknown") return null;
  // Try rev-parse first (works when commits exist)
  try {
    const result = execFileSync(
      "git",
      ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
      { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
    );
    return result.trim() || null;
  } catch {
    // Fallback: symbolic-ref works even before first commit
    try {
      const result = execFileSync(
        "git",
        ["-C", cwd, "symbolic-ref", "--short", "HEAD"],
        { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
      );
      return result.trim() || null;
    } catch {
      return null;
    }
  }
}

export function cwdToProject(cwd: string): string | null {
  if (!cwd || cwd === "unknown") return null;
  const expanded = cwd.startsWith("~")
    ? path.join(os.homedir(), cwd.slice(1))
    : cwd;
  if (expanded.startsWith(CODE_DIR + "/")) {
    const rel = expanded.slice(CODE_DIR.length + 1);
    return rel ? rel.split("/")[0] : null;
  }
  return null;
}

export function findPort(pid: number): number | null {
  try {
    const result = execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-i", "TCP", "-sTCP:LISTEN", "-Fn"],
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    );
    for (const line of result.trim().split("\n")) {
      if (line.startsWith("n") && line.includes(":")) {
        const portStr = line.split(":").pop()!;
        const port = parseInt(portStr, 10);
        if (!isNaN(port)) return port;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function detectDevServer(tty: string, cwd?: string): [string, number] | null {
  // First: scan processes on this TTY
  if (tty && tty !== "unknown") {
    const ttyShort = tty.replace("/dev/", "");
    try {
      const result = execFileSync("ps", ["-t", ttyShort, "-o", "pid=,command="], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const found = matchDevServer(result);
      if (found) return found;
    } catch {
      // ignore
    }
  }

  // Fallback: find listening ports from processes whose CWD matches the project.
  // This catches dev servers started as background tasks (e.g. by Claude).
  if (cwd && cwd !== "unknown") {
    try {
      // Find all PIDs with CWD under this project
      const psResult = execFileSync("ps", ["-eo", "pid=,command="], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      for (const line of psResult.trim().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        const pid = parseInt(parts[0], 10);
        if (isNaN(pid)) continue;
        const cmdLine = parts.slice(1).join(" ");
        // Check if this process's command references the project dir
        if (!cmdLine.includes(cwd) && !cmdLine.includes(path.basename(cwd))) continue;
        const port = findPort(pid);
        if (port) {
          const cmdBase = path.basename(cmdLine.split(/\s+/)[0]);
          return [cmdBase, port];
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function matchDevServer(psOutput: string): [string, number] | null {
  for (const line of psOutput.trim().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const pid = parseInt(parts[0], 10);
    const cmdLine = parts.slice(1).join(" ");
    const cmdBase = path.basename(cmdLine.split(/\s+/)[0]);
    if (IDLE_COMMANDS.has(cmdBase) || BACKGROUND_NOISE.has(cmdBase)) continue;
    if (cmdBase.startsWith("-")) continue;

    for (const [pattern, defaultPort] of Object.entries(DEV_SERVER_PATTERNS)) {
      if (cmdLine.toLowerCase().includes(pattern)) {
        const port = findPort(pid) ?? defaultPort;
        if (port) return [cmdLine.split(/\s+/)[0], port];
      }
    }
    if (
      ["dev", "serve", "server", "start"].some((kw) =>
        cmdLine.toLowerCase().includes(kw)
      )
    ) {
      const port = findPort(pid);
      if (port) return [cmdBase, port];
    }
  }
  return null;
}

export function applySignal(
  session: Session,
  ttySignals: Record<string, SignalData>,
  projectSignals: Record<string, SignalData>
): void {
  const tty = session.tty;
  const cwd = session.cwd;

  let sig = ttySignals[tty] ?? null;
  if (!sig && cwd in projectSignals) {
    const psig = projectSignals[cwd];
    if (!psig.tty) {
      sig = psig;
    }
  }

  let signalStatus: string | null = null;
  let signalDetail = "";
  let active = session.active;

  if (sig) {
    const sigAge = Date.now() / 1000 - (sig.ts || 0);
    signalStatus = sig.status;
    signalDetail = sig.detail || "";
    if (signalStatus === "thinking" && sigAge > 30) {
      signalStatus = "done";
    }
    if (signalStatus === "busy" && sigAge > 10) {
      signalStatus = "thinking";
    }
    // waiting doesn't time out — Claude is waiting for user input until they act
    if (signalStatus === "offline") {
      signalStatus = null;
    }
    if (signalStatus === "busy" || signalStatus === "thinking") {
      active = true;
    } else if (
      signalStatus === "idle" ||
      signalStatus === "done" ||
      signalStatus === "waiting"
    ) {
      active = false;
    }
  }

  let signalDuration: number | null = null;
  if (sig && sig.ts) {
    signalDuration = Date.now() / 1000 - sig.ts;
  }

  session.active = active;
  session.signal = signalStatus;
  session.signalDetail = signalDetail;
  session.signalDuration = signalDuration;
}

/**
 * Fast detection path — only tmux pane data + signal files, no subprocess calls.
 * Good enough for a first render (~30ms).
 */
export function detectSessionsFast(): Session[] {
  const panes = tmux.listPanes();
  if (panes.length === 0) return [];

  const { ttySignals, projectSignals } = state.readSignals();
  const sessions: Session[] = [];

  for (const pane of panes) {
    if (pane.paneIndex === 0) continue;

    const tty = pane.paneTty;
    const cwd = pane.paneCurrentPath;
    const project = cwdToProject(cwd);

    const rawCmd = pane.paneCurrentCommand ?? "unknown";
    const cmdBase = path.basename(rawCmd);
    const active = !IDLE_COMMANDS.has(cmdBase);

    if (cmdBase === "pitboss") continue;

    const session: Session = {
      id: pane.paneId,
      name: pane.windowName,
      tty,
      cwd,
      project,
      branch: null,
      process: rawCmd,
      active,
      focused: pane.paneActive && pane.windowActive,
      signal: null,
      signalDetail: "",
      signalDuration: null,
      devServer: null,
      diffStat: null,
      windowIndex: pane.windowIndex,
      windowName: pane.windowName,
    };

    applySignal(session, ttySignals, projectSignals);
    sessions.push(session);
  }

  return sessions;
}

/**
 * Enriches a session with expensive data: accurate process, branch, dev server.
 */
export function detectDiffStat(cwd: string): { added: number; removed: number } | null {
  if (!cwd || cwd === "unknown") return null;
  try {
    const result = execFileSync(
      "git",
      ["-C", cwd, "diff", "--shortstat"],
      { encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
    );
    const trimmed = result.trim();
    if (!trimmed) return null;
    const addMatch = trimmed.match(/(\d+) insertion/);
    const delMatch = trimmed.match(/(\d+) deletion/);
    const added = addMatch ? parseInt(addMatch[1], 10) : 0;
    const removed = delMatch ? parseInt(delMatch[1], 10) : 0;
    if (added === 0 && removed === 0) return null;
    return { added, removed };
  } catch {
    return null;
  }
}

export function enrichSession(session: Session): Session {
  const [process, active] = detectProcess(session.tty);
  const branch = detectBranch(session.cwd);
  const devServer = detectDevServer(session.tty, session.cwd);

  const diffStat = detectDiffStat(session.cwd);
  return {
    ...session,
    process: process.includes("pitboss") ? session.process : process,
    active: session.signal ? session.active : active,
    branch,
    devServer,
    diffStat,
  };
}

export function detectSessions(): Session[] {
  const panes = tmux.listPanes();
  if (panes.length === 0) return [];

  const { ttySignals, projectSignals } = state.readSignals();
  const sessions: Session[] = [];

  for (const pane of panes) {
    // Skip the TUI pane (pane 0)
    if (pane.paneIndex === 0) continue;

    const tty = pane.paneTty;
    const cwd = pane.paneCurrentPath;

    const project = cwdToProject(cwd);
    const branch = detectBranch(cwd);

    const [process, active] = detectProcess(tty);

    const devServer = detectDevServer(tty, cwd);
    const diffStat = detectDiffStat(cwd);

    // Skip pitboss's own process
    if (process.includes("pitboss")) continue;

    const session: Session = {
      id: pane.paneId,
      name: pane.windowName,
      tty,
      cwd,
      project,
      branch,
      process,
      active,
      focused: pane.paneActive && pane.windowActive,
      signal: null,
      signalDetail: "",
      signalDuration: null,
      devServer,
      diffStat,
      windowIndex: pane.windowIndex,
      windowName: pane.windowName,
    };

    applySignal(session, ttySignals, projectSignals);
    sessions.push(session);
  }

  return sessions;
}

export function detectProjects(
  sessions?: Session[]
): Record<string, { name: string; sessions: string[] }> {
  const sess = sessions ?? detectSessions();
  const projects: Record<string, { name: string; sessions: string[] }> = {};
  for (const s of sess) {
    const p = s.project;
    if (p) {
      if (!projects[p]) {
        projects[p] = { name: p, sessions: [] };
      }
      projects[p].sessions.push(s.id);
    }
  }
  return projects;
}
