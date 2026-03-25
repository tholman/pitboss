#!/usr/bin/env node

/**
 * pitboss CLI — tmux dashboard for managing multiple Claude Code sessions.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import * as state from "./state.js";
import { CODE_DIR } from "./config.js";
import type { Session } from "./types.js";

const VERSION = "0.1.0";
const PITBOSS_DIR = path.join(os.homedir(), ".pitboss");
const HOOK_NAME = "pitboss-signal.sh";
const HOOKS_DIR = path.join(os.homedir(), ".claude", "hooks");
const HOOK_PATH = path.join(HOOKS_DIR, HOOK_NAME);
const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

// --- Helpers ---

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function hasTmux(): boolean {
  return run("which tmux") !== "";
}

function insideTmux(): boolean {
  return !!process.env.TMUX;
}

// --- Commands ---

async function cmdLaunch(paneCount: number): Promise<void> {
  const tmux = await import("./tmux.js");
  tmux.launch(paneCount);
}

async function cmdAttach(): Promise<void> {
  const tmux = await import("./tmux.js");
  tmux.attach();
}

async function cmdAdd(name: string, dir?: string): Promise<void> {
  const tmux = await import("./tmux.js");
  tmux.addProject(name, dir);
}

async function cmdFocus(target: string): Promise<void> {
  const tmux = await import("./tmux.js");
  const num = parseInt(target, 10);
  if (!isNaN(num)) {
    tmux.focusWindow(num);
  } else {
    tmux.focusProject(target);
  }
}

async function cmdList(): Promise<void> {
  const detector = await import("./detector.js");
  const sessions = detector.detectSessions();

  if (sessions.length === 0) {
    console.log("No active pitboss sessions.");
    return;
  }

  const maxName = Math.max(...sessions.map((s) => (s.project || s.cwd || "").length), 7);

  console.log(
    `${"#".padEnd(4)} ${"Project".padEnd(maxName)} ${"Status".padEnd(10)} ${"Branch".padEnd(15)} Process`
  );
  console.log("-".repeat(4 + maxName + 10 + 15 + 20));

  for (const s of sessions) {
    const name = (s.project || path.basename(s.cwd || "")).padEnd(maxName);
    const status = (s.signal || "idle").padEnd(10);
    const branch = (s.branch || "-").padEnd(15);
    const proc = s.process || "-";
    const marker = s.focused ? ">" : " ";
    console.log(`${marker}${String(s.windowIndex).padEnd(3)} ${name} ${status} ${branch} ${proc}`);
  }
}

function cmdSignal(status: string, detail: string, tty?: string): void {
  const effectiveTty = tty || run("tty") || "";
  if (!effectiveTty) {
    die("Could not determine TTY. Pass --tty explicitly.");
  }
  state.signal(effectiveTty, status, detail);
  console.log(`Signaled: ${status}${detail ? ` (${detail})` : ""} on ${effectiveTty}`);
}

function cmdTodoAdd(text: string, project: string | null): void {
  const todo = state.addTodo(text, project);
  console.log(`Added todo ${todo.id}: ${todo.text}${project ? ` [${project}]` : ""}`);
}

function cmdTodoList(project?: string | null): void {
  const todos = state.listTodos(project);
  if (todos.length === 0) {
    console.log("No todos.");
    return;
  }
  for (const t of todos) {
    const check = t.done ? "x" : " ";
    const proj = t.project ? ` [${t.project}]` : "";
    const src = t.source ? ` (${t.source})` : "";
    console.log(`[${check}] ${t.id} ${t.text}${proj}${src}`);
  }
}

function cmdTodoDone(id: string): void {
  const todo = state.toggleTodo(id);
  if (!todo) {
    die(`Todo not found: ${id}`);
  }
  console.log(`${todo.done ? "Done" : "Undone"}: ${todo.text}`);
}

async function cmdFix(): Promise<void> {
  const tmux = await import("./tmux.js");
  tmux.fix();
}

async function cmdSetup(): Promise<void> {
  const { installHooks } = await import("./hooks.js");
  await installHooks();
  console.log("Hooks installed. Run `pitboss doctor` to verify.");
}

function cmdDoctor(): void {
  let ok = true;
  const check = (label: string, pass: boolean, hint?: string) => {
    const icon = pass ? "\u2713" : "\u2717";
    console.log(`  ${icon} ${label}`);
    if (!pass) {
      ok = false;
      if (hint) console.log(`    ${hint}`);
    }
  };

  console.log("pitboss doctor\n");

  // tmux
  const tmuxPath = run("which tmux");
  check("tmux installed", !!tmuxPath);
  if (tmuxPath) {
    const tmuxVer = run("tmux -V");
    check(`tmux version: ${tmuxVer}`, true);
  }

  // Node
  check(`Node ${process.version}`, true);


  // Hook script
  const hookExists = fs.existsSync(HOOK_PATH);
  check(`Hook script at ${HOOK_PATH}`, hookExists, "Run: pitboss setup");
  if (hookExists) {
    try {
      fs.accessSync(HOOK_PATH, fs.constants.X_OK);
      check("Hook script is executable", true);
    } catch {
      check("Hook script is executable", false, `Run: chmod +x ${HOOK_PATH}`);
    }
  }

  // Settings
  let settingsHasPitboss = false;
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const settings = fs.readFileSync(SETTINGS_PATH, "utf-8");
      settingsHasPitboss = settings.includes("pitboss");
    } catch {
      // ignore
    }
  }
  check("Claude settings reference pitboss", settingsHasPitboss, "Run: pitboss setup");

  // Code dir
  const codeDirExists = fs.existsSync(CODE_DIR);
  check(`Code directory exists (${CODE_DIR})`, codeDirExists);

  // Pitboss dir
  const pitbossDirExists = fs.existsSync(PITBOSS_DIR);
  check(`~/.pitboss/ exists`, pitbossDirExists, "Will be created on first use");
  if (pitbossDirExists) {
    try {
      fs.accessSync(PITBOSS_DIR, fs.constants.W_OK);
      check("~/.pitboss/ is writable", true);
    } catch {
      check("~/.pitboss/ is writable", false);
    }
  }

  console.log(ok ? "\nAll checks passed." : "\nSome checks failed.");
  process.exit(ok ? 0 : 1);
}

function usage(): void {
  console.log(`pitboss v${VERSION} — tmux dashboard for Claude Code sessions

Usage:
  pitboss                          Launch TUI (or attach if session exists)
  pitboss launch [N]               Create tmux session with N panes (default: 4)
  pitboss attach                   Attach to running session
  pitboss add <name> [-d path]     Add a project window
  pitboss focus <target>           Switch to project by name or number
  pitboss list                     Print sessions/projects
  pitboss signal <status> [-d msg] [--tty tty]
                                   Signal status update
  pitboss todo add <text> [-p project]
  pitboss todo list [-p project]
  pitboss todo done <id>
  pitboss theme [name]             List or set color theme
  pitboss fix                      Repair layout (re-add TUI sidebar, re-tile)
  pitboss setup                    Install Claude Code hooks
  pitboss doctor                   Check prerequisites
  pitboss --version                Print version
  pitboss --help                   Show this help`);
}

// --- Arg parsing ---

function parseFlag(args: string[], flag: string, short?: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag || (short && args[i] === short)) {
      const val = args[i + 1];
      args.splice(i, 2);
      return val;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Flags
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }
  if (args.includes("--tui")) {
    // Direct TUI launch — used by the tmux wrapper, skips all detection.
    // Detect which pitboss session we're in so the detector queries the right one.
    const tmux = await import("./tmux.js");
    const current = tmux.detectCurrentSession();
    if (current) tmux.setSession(current);
    const { start } = await import("./tui/app.js");
    await start();
    return;
  }

  const cmd = args[0] || "";

  switch (cmd) {
    case "launch": {
      const n = parseInt(args[1], 10) || 4;
      await cmdLaunch(n);
      break;
    }

    case "attach":
      await cmdAttach();
      break;

    case "add": {
      const name = args[1];
      if (!name) die("Usage: pitboss add <name> [-d path]");
      const dir = parseFlag(args.slice(2), "--dir", "-d");
      await cmdAdd(name, dir);
      break;
    }

    case "focus": {
      const target = args[1];
      if (!target) die("Usage: pitboss focus <target>");
      await cmdFocus(target);
      break;
    }

    case "list":
      await cmdList();
      break;

    case "signal": {
      const status = args[1];
      if (!status) die("Usage: pitboss signal <status> [-d detail] [--tty tty]");
      const rest = args.slice(2);
      const detail = parseFlag(rest, "--detail", "-d") || "";
      const tty = parseFlag(rest, "--tty");
      cmdSignal(status, detail, tty);
      break;
    }

    case "todo": {
      const sub = args[1];
      const rest = args.slice(2);
      switch (sub) {
        case "add": {
          const project = parseFlag(rest, "--project", "-p") || null;
          const text = rest.join(" ");
          if (!text) die("Usage: pitboss todo add <text> [-p project]");
          cmdTodoAdd(text, project);
          break;
        }
        case "list": {
          const project = parseFlag(rest, "--project", "-p");
          cmdTodoList(project);
          break;
        }
        case "done": {
          const id = rest[0];
          if (!id) die("Usage: pitboss todo done <id>");
          cmdTodoDone(id);
          break;
        }
        default:
          die(`Unknown todo subcommand: ${sub}\nUsage: pitboss todo [add|list|done]`);
      }
      break;
    }

    case "fix":
      await cmdFix();
      break;

    case "setup":
      await cmdSetup();
      break;

    case "doctor":
      cmdDoctor();
      break;

    case "theme": {
      const { listThemes, getTheme } = await import("./themes.js");
      const { loadConfig, saveConfig } = await import("./config.js");
      const target = args[1];
      if (target) {
        const available = listThemes();
        if (!available.includes(target)) {
          die(`Unknown theme: ${target}\nAvailable: ${available.join(", ")}`);
        }
        saveConfig({ ...loadConfig(), theme: target });
        console.log(`Theme set to: ${target}`);
      } else {
        const config = loadConfig();
        const current = config.theme || "midnight";
        const available = listThemes();
        for (const name of available) {
          const t = getTheme(name);
          const marker = name === current ? " *" : "";
          console.log(`  ${name}${marker}`);
        }
      }
      break;
    }

    case "": {
      // Bare `pitboss` — always launch a new session
      // Supports multiple: pitboss, pitboss-2, pitboss-3, etc.
      if (insideTmux()) {
        const tmux = await import("./tmux.js");
        const current = tmux.detectCurrentSession();
        if (current) {
          const currentPane = tmux.run("display-message", "-p", "#{pane_index}");
          if (currentPane === "0") {
            // We ARE pane 0 — just run the TUI directly
            tmux.setSession(current);
            const { start } = await import("./tui/app.js");
            await start();
          } else {
            // In a pitboss session but not pane 0 — restart TUI in pane 0
            const pane = `${current}:main.0`;
            const wrappedCmd = `${tmux.pitbossTuiCmd()}; exec $SHELL`;
            tmux.run("respawn-pane", "-t", pane, "-k", "sh", "-c", wrappedCmd);
            console.log("Restarted TUI in pane 0.");
          }
        } else {
          // Inside a different tmux session — run TUI here
          const { start } = await import("./tui/app.js");
          await start();
        }
      } else {
        // Outside tmux — always launch a new session (auto-increments name)
        await cmdLaunch(4);
        await cmdAttach();
      }
      break;
    }

    default:
      die(`Unknown command: ${cmd}\nRun 'pitboss --help' for usage.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
