/**
 * Ink-based TUI dashboard for pitboss.
 *
 * Displays project cards for Claude Code sessions running in tmux panes.
 * Two-phase rendering: instant skeleton from tmux panes, async enrichment.
 * Tick-based animation system for status indicators and future features.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { execSync } from "child_process";

import * as detector from "../detector.js";
import * as state from "../state.js";
import * as tmux from "../tmux.js";
import { statusIcon } from "../animate.js";
import type { Session, Todo, ProjectTracking } from "../types.js";
import { CODE_DIR, loadConfig, saveConfig } from "../config.js";
import { getTheme, listThemes, type Theme } from "../themes.js";

// ---------------------------------------------------------------------------
// Theme — loaded from config, switchable at runtime with `t`
// ---------------------------------------------------------------------------

let T: Theme = getTheme(loadConfig().theme);

/** Status color for the selected card's name highlight. */
function statusColor(status: Status): string {
  switch (status) {
    case "error":
      return T.error;
    case "waiting":
      return T.waiting;
    case "busy":
    case "thinking":
      return T.busy;
    case "done":
      return T.done;
    case "active":
      return T.active;
    case "idle":
    default:
      return T.text;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEADER_ART = [
  "┏━┓╻╺┳╸┏┓ ┏━┓┏━┓┏━┓",
  "┣━┛┃ ┃ ┣┻┓┃ ┃┗━┓┗━┓",
  "╹  ╹ ╹ ┗━┛┗━┛┗━┛┗━┛",
];

type Status = "error" | "waiting" | "busy" | "thinking" | "done" | "active" | "idle";

const STATUS_LABELS: Record<Status, string> = {
  busy: "running",
  thinking: "thinking",
  waiting: "waiting",
  error: "error",
  done: "done",
  active: "active",
  idle: "idle",
};

const KEY_HINTS = " j/k nav  enter focus  n new  a todo  x done  t theme  q quit";

// Animation tick rate (ms) — drives all animations
const TICK_INTERVAL = 150;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe6f) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x2fffd) ||
      (cp >= 0x30000 && cp <= 0x3fffd)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function truncateToWidth(s: string, target: number): string {
  let w = 0;
  let i = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const cw =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe6f) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x2fffd) ||
      (cp >= 0x30000 && cp <= 0x3fffd)
        ? 2
        : 1;
    if (w + cw > target) break;
    w += cw;
    i += ch.length;
  }
  return s.slice(0, i);
}

function padToWidth(s: string, target: number): string {
  s = truncateToWidth(s, target);
  const cur = displayWidth(s);
  return s + " ".repeat(Math.max(0, target - cur));
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm}m`;
}

// ---------------------------------------------------------------------------
// ProjectCard model
// ---------------------------------------------------------------------------

interface ContentLine {
  text: string;
  color: string;
  /** If set, this line has an animated prefix driven by the tick */
  animStatus?: string;
  /** If set, render with green/red split */
  diffStat?: { added: number; removed: number };
  /** If set, truncate with … when text exceeds card width */
  ellipsis?: boolean;
}

interface ProjectCard {
  name: string;
  sessions: Session[];
  status: Status;
  color: string;
  branch: string | null;
  port: number | null;
  duration: number | null;
  idleDuration: number | null;
  diffStat: { added: number; removed: number } | null;
  contentLines: (ContentLine | null)[]; // null = section divider
  todos: Todo[];
  focused: boolean;
}

function buildCards(
  sessions: Session[],
  tracking: Record<string, ProjectTracking>,
  todos: Todo[]
): ProjectCard[] {
  const byProject = new Map<string, Session[]>();
  for (const s of sessions) {
    if (!s.project) continue;
    let arr = byProject.get(s.project);
    if (!arr) {
      arr = [];
      byProject.set(s.project, arr);
    }
    arr.push(s);
  }

  const cards: ProjectCard[] = [];
  for (const [name, projSessions] of byProject) {
    cards.push(buildCard(name, projSessions, tracking, todos));
  }
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return cards;
}

function buildCard(
  name: string,
  sessions: Session[],
  tracking: Record<string, ProjectTracking>,
  allTodos: Todo[]
): ProjectCard {
  const projectTodos = allTodos.filter((t) => t.project === name);

  // Classify
  const claudes = sessions.filter((s) =>
    (s.process || "").toLowerCase().includes("claude")
  );
  const servers = sessions.filter((s) => s.devServer);
  const shells = sessions.filter(
    (s) => !claudes.includes(s) && !servers.includes(s) && !s.active
  );
  const other = sessions.filter(
    (s) => !claudes.includes(s) && !servers.includes(s) && !shells.includes(s)
  );

  // Aggregate status
  const claudesBusy = claudes.filter((s) => s.signal === "busy");
  const claudesThinking = claudes.filter((s) => s.signal === "thinking");
  const claudesWaiting = claudes.filter((s) => s.signal === "waiting");
  const claudesError = claudes.filter((s) => s.signal === "error");
  const claudesDone = claudes.filter((s) => s.signal === "done");

  let status: Status;
  if (claudesError.length) status = "error";
  else if (claudesWaiting.length) status = "waiting";
  else if (claudesBusy.length) status = "busy";
  else if (claudesThinking.length) status = "thinking";
  else if (claudesDone.length) status = "done";
  else if (sessions.some((s) => s.active)) status = "active";
  else status = "idle";

  // Branch
  let branch: string | null = null;
  for (const s of sessions) {
    if (s.branch) {
      branch = s.branch;
      break;
    }
  }

  // Dev server
  let port: number | null = null;
  for (const s of servers) {
    if (s.devServer) {
      port = s.devServer[1];
      break;
    }
  }

  // Focused
  const focused = sessions.some((s) => s.focused);

  // Duration
  let duration: number | null = null;
  let idleDuration: number | null = null;
  const track = tracking[name];
  if (track) {
    const now = Date.now() / 1000;
    if (
      track.started != null &&
      (status === "busy" || status === "thinking" || status === "waiting")
    ) {
      duration = now - track.started;
    } else if (status === "done" && track.finalDuration != null) {
      duration = track.finalDuration;
    }
    if (track.idleSince != null && status === "idle") {
      idleDuration = now - track.idleSince;
    }
  }

  // Content lines
  const lines: (ContentLine | null)[] = [];

  // Claude sessions — animated status
  for (const c of claudes) {
    const sig = c.signal;
    const detail = c.signalDetail || "";
    if (sig === "busy") {
      let label = "clauding…";
      if (detail) {
        label = "claude";
        // Clean up tool names: "AskUserQuestion" -> "asking", "Bash" -> "bash", etc.
        const toolLabels: Record<string, string> = {
          Bash: "bash", Read: "reading", Write: "writing", Edit: "editing",
          Grep: "searching", Glob: "searching", Agent: "agent",
          AskUserQuestion: "asking", WebSearch: "searching",
          WebFetch: "fetching", NotebookEdit: "notebook",
        };
        label += ` ${toolLabels[detail] || detail.toLowerCase()}`;
      }
      lines.push({ text: label, color: T.busy, animStatus: "busy" });
    } else if (sig === "thinking") {
      lines.push({ text: "claude thinking", color: T.thinking, animStatus: "thinking" });
    } else if (sig === "waiting") {
      lines.push({ text: "claude waiting", color: T.waiting, animStatus: "waiting" });
    } else if (sig === "error") {
      lines.push({ text: "claude error", color: T.error, animStatus: "error" });
    } else if (sig === "done") {
      lines.push({ text: "claude done", color: T.done, animStatus: "done" });
    } else {
      lines.push({ text: "claude idle", color: T.muted, animStatus: "idle" });
    }
  }

  // Diff stat
  let diffStat: { added: number; removed: number } | null = null;
  for (const s of sessions) {
    if (s.diffStat) {
      diffStat = s.diffStat;
      break;
    }
  }

  // Infra: servers + shells + diff
  const infraParts: string[] = [];
  let infraColor = T.muted;
  if (port) {
    infraParts.push(`http://localhost:${port}`);
    infraColor = T.accent;
  }
  const nShells = shells.length + other.length;
  if (nShells === 1) {
    const proc = (shells[0] || other[0])?.process || "shell";
    infraParts.push(proc);
  } else if (nShells > 1) {
    infraParts.push(`${nShells} shells`);
  }
  if (infraParts.length) {
    if (lines.length) lines.push(null);
    lines.push({ text: infraParts.join(" | "), color: infraColor });
  }
  if (diffStat) {
    if (lines.length && !infraParts.length) lines.push(null);
    const diffParts: string[] = [];
    if (diffStat.added) diffParts.push(`+${diffStat.added}`);
    if (diffStat.removed) diffParts.push(`-${diffStat.removed}`);
    // Single line with mixed color — use added color if only adds, removed if only dels
    const diffColor = diffStat.added && !diffStat.removed ? T.done
      : !diffStat.added && diffStat.removed ? T.error
      : T.text;
    lines.push({ text: diffParts.join(" "), color: diffColor, diffStat });
  }

  // Todos
  const undone = projectTodos.filter((t) => !t.done);
  const recentlyDone = projectTodos.filter((t) => {
    if (!t.done || !t.doneAt) return false;
    return (Date.now() / 1000 - t.doneAt) < 5;
  });
  const hasTodos = undone.length > 0 || recentlyDone.length > 0;
  if (hasTodos && lines.length) lines.push(null);
  for (const t of recentlyDone) {
    lines.push({ text: `☑ ${t.text}`, color: T.muted, ellipsis: true });
  }
  for (const t of undone.slice(0, 4)) {
    lines.push({ text: `☐ ${t.text}`, color: T.text, ellipsis: true });
  }
  if (undone.length >= 5) {
    lines.push({ text: `  +${undone.length - 4} more`, color: T.muted });
  }
  if (!hasTodos) {
    if (lines.length) lines.push(null);
    lines.push({ text: "a: add todo", color: T.muted });
  }

  return {
    name,
    sessions,
    status,
    color: statusColor(status),
    branch,
    port,
    duration,
    idleDuration,
    diffStat,
    contentLines: lines,
    todos: projectTodos,
    focused,
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function Header({ cols }: { cols: number }): React.ReactElement {
  const artWidth = displayWidth(HEADER_ART[0]);
  const innerW = cols - 2;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      {HEADER_ART.map((line, i) => {
        const padL = Math.max(0, Math.floor((innerW - artWidth) / 2));
        const padR = Math.max(0, innerW - artWidth - padL);
        const isWing = i === 0 || i === HEADER_ART.length - 1;
        return (
          <Text key={i} bold color={T.accent}>
            {" "}
            {isWing ? "━".repeat(padL) : " ".repeat(padL)}
            {line}
            {isWing ? "━".repeat(padR) : " ".repeat(padR)}
          </Text>
        );
      })}
      <Text> </Text>
    </Box>
  );
}

function SummaryStrip({ cards }: { cards: ProjectCard[] }): React.ReactElement {
  const n = cards.length;
  const nBusy = cards.filter((c) => c.status === "busy" || c.status === "thinking").length;
  const nWait = cards.filter((c) => c.status === "waiting").length;
  const nDone = cards.filter((c) => c.status === "done").length;
  const nErr = cards.filter((c) => c.status === "error").length;
  const nIdle = cards.filter((c) => c.status === "idle" || c.status === "active").length;
  const nSrv = cards.filter((c) => c.port).length;

  const parts: { label: string; count: number; color: string }[] = [];
  parts.push({ label: "projects", count: n, color: T.textDim });
  if (nBusy) parts.push({ label: "working", count: nBusy, color: T.busy });
  if (nWait) parts.push({ label: "waiting", count: nWait, color: T.waiting });
  if (nDone) parts.push({ label: "done", count: nDone, color: T.done });
  if (nErr) parts.push({ label: "error", count: nErr, color: T.error });
  if (nIdle) parts.push({ label: "idle", count: nIdle, color: T.muted });
  if (nSrv) parts.push({ label: "server", count: nSrv, color: T.accent });

  return (
    <Text>
      {" "}
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Text color={T.divider}> · </Text>}
          <Text color={p.color} bold>{p.count}</Text>
          <Text color={p.color}> {p.label}</Text>
        </React.Fragment>
      ))}
    </Text>
  );
}

function Divider({ cols }: { cols: number }): React.ReactElement {
  return <Text color={T.muted}>{" " + "─".repeat(Math.max(0, cols - 3))}</Text>;
}

function CardView({
  card,
  selected,
  width,
  tick,
  index,
}: {
  card: ProjectCard;
  selected: boolean;
  width: number;
  tick: number;
  index: number;
}): React.ReactElement {
  const { name, color, branch, duration, idleDuration, status, contentLines, focused } = card;

  const innerW = width - 2;
  // Selected cards get status-colored borders, like terminator
  const borderColor = selected ? color : T.border;
  const icon = statusIcon(status, tick);

  // Build top border: index + name (status icon lives in content lines only)
  const cursor = selected ? "› " : "  ";
  const left = `${cursor}${index}. ${name} `;
  const leftDw = displayWidth(left);

  const rightParts: string[] = [];
  if (duration != null && (status === "busy" || status === "thinking" || status === "waiting")) {
    rightParts.push(fmtDuration(duration));
  } else if (duration != null && status === "done") {
    rightParts.push(`took ${fmtDuration(duration)}`);
  } else if (idleDuration != null && status === "idle") {
    rightParts.push(`idle ${fmtDuration(idleDuration)}`);
  }
  if (branch) rightParts.push(`⎇ ${branch}`);
  let right = rightParts.join("  ");
  let rightDw = displayWidth(right);
  if (right) {
    right = ` ${right} `;
    rightDw += 2;
  }

  const maxRight = innerW - leftDw - 3;
  if (rightDw > maxRight) {
    right = truncateToWidth(right, Math.max(0, maxRight));
    rightDw = displayWidth(right);
  }

  const fillW = Math.max(1, innerW - leftDw - rightDw);
  const bottomLine = `╰${"─".repeat(innerW)}╯`;

  // Build content
  const bodyLines: React.ReactElement[] = [];
  for (let li = 0; li < contentLines.length; li++) {
    const entry = contentLines[li];
    if (entry === null) {
      bodyLines.push(
        <Text key={`d${li}`} color={borderColor}>
          {`├${"─".repeat(innerW)}┤`}
        </Text>
      );
    } else if (entry.diffStat) {
      // Dual-color diff stat line: green for adds, red for dels
      const ds = entry.diffStat;
      let diffContent = " ";
      if (ds.added) diffContent += `+${ds.added}`;
      if (ds.added && ds.removed) diffContent += " ";
      const addPart = ds.added ? `+${ds.added}` : "";
      const delPart = ds.removed ? `-${ds.removed}` : "";
      const spacer = addPart && delPart ? " " : "";
      const fullText = ` ${addPart}${spacer}${delPart}`;
      const remaining = innerW - displayWidth(fullText);
      bodyLines.push(
        <Text key={`l${li}`}>
          <Text color={borderColor}>│</Text>
          {addPart && <Text color={T.done}> {addPart}</Text>}
          {!addPart && <Text> </Text>}
          {delPart && <Text color={T.error}>{spacer}{delPart}</Text>}
          <Text>{" ".repeat(Math.max(0, remaining))}</Text>
          <Text color={borderColor}>│</Text>
        </Text>
      );
    } else {
      // Animated prefix for claude status lines
      let prefix = " ";
      if (entry.animStatus) {
        prefix = " " + statusIcon(entry.animStatus, tick) + " ";
      }
      let content = `${prefix}${entry.text}`;
      if (entry.ellipsis && displayWidth(content) > innerW - 1) {
        content = truncateToWidth(content, innerW - 2) + "…";
      }
      const padded = padToWidth(content, innerW);
      bodyLines.push(
        <Text key={`l${li}`}>
          <Text color={borderColor}>│</Text>
          <Text color={entry.color}>{padded}</Text>
          <Text color={borderColor}>│</Text>
        </Text>
      );
    }
  }

  // Selected cards: colored border + bold name, no inverse
  if (selected) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={color} bold>╭</Text>
          <Text color={color} bold>{left}</Text>
          <Text color={color}>{"─".repeat(fillW)}</Text>
          <Text color={color}>{right}</Text>
          <Text color={color} bold>╮</Text>
        </Text>
        {bodyLines}
        <Text color={color} bold>{"╰" + "─".repeat(innerW) + "╯"}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={borderColor}>╭</Text>
        <Text color={T.text} bold>{left}</Text>
        <Text color={borderColor}>{"─".repeat(fillW)}</Text>
        <Text color={T.textDim}>{right}</Text>
        <Text color={borderColor}>╮</Text>
      </Text>
      {bodyLines}
      <Text color={borderColor}>{bottomLine}</Text>
    </Box>
  );
}

function EmptyState(): React.ReactElement {
  const lines = [
    "No sessions detected.",
    "",
    "cd into a project in any pane and run claude",
    "to see it appear here.",
    "",
    "  pitboss setup    install signal hooks",
    "  pitboss doctor   check your setup",
  ];
  return (
    <Box flexDirection="column" paddingLeft={3}>
      {lines.map((line, i) => (
        <Text key={i} color={T.textDim}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

export function App(): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [cards, setCards] = useState<ProjectCard[]>([]);
  const [orphanCount, setOrphanCount] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [inputMode, setInputMode] = useState(false);
  const [inputBuffer, setInputBuffer] = useState("");
  const [cols, setCols] = useState(stdout?.columns ?? 80);
  const [rows, setRows] = useState(stdout?.rows ?? 24);
  const [themeName, setThemeName] = useState(T.name);
  const [tick, setTick] = useState(0);

  const lastManualNav = useRef(0);

  // Track terminal resize
  useEffect(() => {
    const onResize = () => {
      setCols(stdout?.columns ?? 80);
      setRows(stdout?.rows ?? 24);
    };
    stdout?.on("resize", onResize);
    return () => { stdout?.off("resize", onResize); };
  }, [stdout]);

  // Build cards from sessions
  const buildFromSessions = useCallback((sessions: Session[]) => {
    try {
      const _projects = detector.detectProjects(sessions);
      const tracking = state.updateTracking(sessions);
      state.cleanupDoneTodos(10);
      let todos = state.listTodos();

      for (const pname of Object.keys(_projects)) {
        const fileTodos = state.readFileTodos(pname);
        const managedTexts = new Set(
          todos.filter((t) => t.project === pname).map((t) => t.text.toLowerCase())
        );
        for (const ft of fileTodos) {
          if (!managedTexts.has(ft.text.toLowerCase())) {
            todos.push(ft);
          }
        }
      }

      const newCards = buildCards(sessions, tracking, todos);
      setCards(newCards);
      setOrphanCount(sessions.filter((s) => !s.project).length);

      const focusedIdx = newCards.findIndex((c) => c.focused);
      if (focusedIdx >= 0 && Date.now() - lastManualNav.current > 2000) {
        setCursor(focusedIdx);
      }

      // Update tmux pane titles
      for (const c of newCards) {
        const session = c.sessions[0];
        if (session) {
          try {
            const label = STATUS_LABELS[c.status as Status] || c.status;
            tmux.run("select-pane", "-t", session.id, "-T", `${label} ${c.name}`);
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      // Silently ignore refresh errors (race conditions, file locks, etc)
    }
  }, []);

  // Fast initial render from tmux panes only, then full refresh loop
  const refreshFull = useCallback(() => {
    try {
      const sessions = detector.detectSessions();
      buildFromSessions(sessions);
    } catch (e) {
      // Silently ignore refresh errors (race conditions, file locks, etc)
    }
  }, [buildFromSessions]);

  // Mount: instant skeleton, then full refresh shortly after
  useEffect(() => {
    try {
      const sessions = detector.detectSessionsFast();
      buildFromSessions(sessions);
    } catch { /* ignore */ }
    const enrichTimer = setTimeout(refreshFull, 100);
    return () => clearTimeout(enrichTimer);
  }, [buildFromSessions, refreshFull]);

  // Steady refresh loop — full data every second
  useEffect(() => {
    const timer = setInterval(refreshFull, 1000);
    return () => clearInterval(timer);
  }, [refreshFull]);

  // Animation tick — drives all animated elements
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, TICK_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  // Clamp cursor
  useEffect(() => {
    setCursor((prev) => {
      if (cards.length === 0) return 0;
      return Math.min(prev, cards.length - 1);
    });
  }, [cards.length]);

  const focusCard = useCallback(
    (card: ProjectCard) => {
      try {
        tmux.focusProject(card.name);
        setStatusMsg(`> ${card.name}`);
      } catch {
        setStatusMsg(`no pane for ${card.name}`);
      }
    },
    []
  );

  // Keyboard handling
  useInput((input, key) => {
    if (inputMode) {
      if (key.escape) {
        setInputMode(false);
        setInputBuffer("");
        setStatusMsg("");
        return;
      }
      if (key.return) {
        const text = inputBuffer.trim();
        if (text) {
          const card = cards[cursor];
          const proj = card?.name ?? null;
          state.addTodo(text, proj);
          setStatusMsg(`+ ${text}`);
        }
        setInputMode(false);
        setInputBuffer("");
        return;
      }
      if (key.backspace || key.delete) {
        setInputBuffer((b) => b.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setInputBuffer((b) => b + input);
      }
      return;
    }

    const n = cards.length;

    if (input === "q") {
      exit();
      process.exit(0);
    }
    if (input === "j" || key.downArrow) {
      lastManualNav.current = Date.now();
      setCursor((c) => (n ? Math.min(c + 1, n - 1) : 0));
      return;
    }
    if (input === "k" || key.upArrow) {
      lastManualNav.current = Date.now();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (input === "r") {
      setStatusMsg("refreshing...");
      refreshFull();
      setStatusMsg("refreshed");
      return;
    }
    if (input === "a") {
      const card = cards[cursor];
      const proj = card?.name ?? "";
      setInputMode(true);
      setInputBuffer("");
      setStatusMsg(proj ? `todo (${proj}): ` : "todo: ");
      return;
    }
    if (input === "x") {
      const card = cards[cursor];
      if (card) {
        const undone = card.todos.filter((t) => !t.done);
        if (undone.length) {
          state.toggleTodo(undone[0].id);
          setStatusMsg(`done: ${undone[0].text.slice(0, 30)}`);
          refreshFull();
        }
      }
      return;
    }
    if (input === "o") {
      const card = cards[cursor];
      if (card?.port) {
        try {
          execSync(`open http://localhost:${card.port}`);
          setStatusMsg(`> localhost:${card.port}`);
        } catch {
          setStatusMsg("failed to open");
        }
      } else {
        setStatusMsg("no server");
      }
      return;
    }
    if (key.return) {
      const card = cards[cursor];
      if (card) focusCard(card);
      return;
    }
    if (input === "n") {
      try {
        tmux.run(
          "split-window", "-t", `${tmux.getSession()}:main`,
          "-v", "-l", "50%", "-c", CODE_DIR
        );
        setStatusMsg("+ new pane");
      } catch (e) {
        setStatusMsg(`error: ${e}`);
      }
      return;
    }
    if (input === "t") {
      const names = listThemes();
      const idx = names.indexOf(themeName);
      const next = names[(idx + 1) % names.length];
      T = getTheme(next);
      setThemeName(next);
      saveConfig({ ...loadConfig(), theme: next });
      setStatusMsg(`theme: ${next}`);
      return;
    }
    if (input && input >= "1" && input <= "9") {
      lastManualNav.current = Date.now();
      const idx = parseInt(input, 10) - 1;
      if (n && idx < n) {
        setCursor(idx);
        focusCard(cards[idx]);
      } else if (!n) {
        try {
          tmux.focusPane(idx + 1);
          setStatusMsg(`> pane ${idx + 1}`);
        } catch {
          setStatusMsg(`no pane ${idx + 1}`);
        }
      }
      return;
    }
  });

  const cardWidth = Math.max(40, cols - 2);

  const statusText = inputMode ? `${statusMsg}${inputBuffer}_` : statusMsg;
  const statusPadded = ` ${statusText}`.padEnd(cols - 1);

  return (
    <Box flexDirection="column" height={rows}>
      <Header cols={cols} />

      {cards.length === 0 ? (
        <EmptyState />
      ) : (
        <Box flexDirection="column">
          {cards.map((card, i) => (
            <Box key={card.name} flexDirection="column">
              <CardView card={card} selected={i === cursor} width={cardWidth} tick={tick} index={i + 1} />
              {i < cards.length - 1 && <Text> </Text>}
            </Box>
          ))}
        </Box>
      )}

      {orphanCount > 0 && (
        <Text color={T.muted}>
          {" "}
          {orphanCount} other session{orphanCount !== 1 ? "s" : ""}
        </Text>
      )}

      <Box flexGrow={1} />
      <Text> </Text>
      {cards.length > 0 && (
        <Text>
          {" "}
          {cards.map((c, i) => (
            <React.Fragment key={c.name}>
              {i > 0 && <Text color={T.divider}> </Text>}
              <Text color={c.focused ? c.color : T.text} bold={c.focused}>
                {i + 1}:{c.name}
              </Text>
            </React.Fragment>
          ))}
        </Text>
      )}
      <Text color={T.muted}>{KEY_HINTS}</Text>
      <Text inverse color={T.accent}>{statusPadded}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function start(): void {
  render(<App />);
}
