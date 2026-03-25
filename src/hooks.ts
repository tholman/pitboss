/**
 * Hook installation logic for pitboss.
 *
 * Copies pitboss-signal.sh into ~/.claude/hooks/ and registers it
 * in ~/.claude/settings.json for all relevant Claude Code hook events.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "UserPromptSubmit",
  "Stop",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "SessionEnd",
] as const;

const HOOK_SCRIPT = "pitboss-signal.sh";
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const HOOKS_DEST = path.join(CLAUDE_DIR, "hooks");
const SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");

function packageHookPath(): string {
  return path.resolve(fileURLToPath(import.meta.url), "../../hooks", HOOK_SCRIPT);
}

function eventToStatus(event: string): string {
  switch (event) {
    case "Stop":
      return "waiting";
    case "SessionEnd":
      return "done";
    case "PostToolUseFailure":
      return "error";
    case "UserPromptSubmit":
    case "SubagentStart":
    case "PreToolUse":
      return "busy";
    case "PermissionRequest":
    case "Notification":
      return "waiting";
    default:
      return "thinking";
  }
}

export function installHooks(): void {
  // --- Copy script ---
  fs.mkdirSync(HOOKS_DEST, { recursive: true });
  const src = packageHookPath();
  const dst = path.join(HOOKS_DEST, HOOK_SCRIPT);
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
  console.log(`  Copied ${HOOK_SCRIPT} -> ${dst}`);

  // --- Merge settings ---
  let settings: Record<string, any> = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  }

  if (!settings.hooks) settings.hooks = {};
  const hooks = settings.hooks;
  const hookCommand = path.join(HOOKS_DEST, HOOK_SCRIPT);

  let changed = false;
  for (const event of HOOK_EVENTS) {
    if (!hooks[event]) hooks[event] = [];
    const eventHooks: any[] = hooks[event];

    // Remove any stale terminator/multiclaw/forger entries
    const before = eventHooks.length;
    hooks[event] = eventHooks.filter((h: any) => {
      if (typeof h !== "object") return true;
      const cmd = h.command || "";
      const innerHooks = h.hooks;
      // Remove bare pitboss entries (old format)
      if (cmd.includes("pitboss-signal") && !h.hooks) return false;
      // Remove old terminator/multiclaw/forger entries
      if (cmd.includes("terminator-signal") || cmd.includes("multiclaw-signal") || cmd.includes("forger-signal")) return false;
      if (Array.isArray(innerHooks)) {
        const filtered = innerHooks.filter((ih: any) => {
          const icmd = ih.command || "";
          return !icmd.includes("terminator-signal") && !icmd.includes("multiclaw-signal") && !icmd.includes("forger-signal");
        });
        if (filtered.length !== innerHooks.length) {
          h.hooks = filtered;
          if (filtered.length === 0) return false;
        }
      }
      return true;
    });
    if (hooks[event].length !== before) changed = true;

    // Find existing pitboss hook or create new one
    const status = eventToStatus(event);
    const expectedCmd = `${hookCommand} ${status}`;
    const existingIdx = hooks[event].findIndex(
      (h: any) =>
        Array.isArray(h.hooks) &&
        h.hooks.some((ih: any) => (ih.command || "").includes("pitboss-signal"))
    );
    const hookEntry = {
      matcher: "",
      hooks: [
        {
          type: "command",
          command: expectedCmd,
          async: true,
          timeout: 5,
        },
      ],
    };
    if (existingIdx >= 0) {
      // Update if the command changed (e.g. status mapping updated)
      const existing = hooks[event][existingIdx];
      const existingCmd = existing?.hooks?.[0]?.command || "";
      if (existingCmd !== expectedCmd) {
        hooks[event][existingIdx] = hookEntry;
        changed = true;
        console.log(`  Updated hook: ${event} -> ${status}`);
      }
    } else {
      hooks[event].push(hookEntry);
      changed = true;
      console.log(`  Registered hook: ${event} -> ${status}`);
    }
  }

  if (changed) {
    const tmp = SETTINGS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, SETTINGS_FILE);
    console.log(`  Updated ${SETTINGS_FILE}`);
  } else {
    console.log("  Hooks already registered in settings.json");
  }
}

export function checkHooks(): {
  scriptInstalled: boolean;
  settingsConfigured: boolean;
  missingEvents: string[];
} {
  const result = {
    scriptInstalled: false,
    settingsConfigured: false,
    missingEvents: [] as string[],
  };

  const dst = path.join(HOOKS_DEST, HOOK_SCRIPT);
  result.scriptInstalled = fs.existsSync(dst);

  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      const hooks = settings.hooks || {};
      const hookCommand = path.join(HOOKS_DEST, HOOK_SCRIPT);
      for (const event of HOOK_EVENTS) {
        const eventHooks: any[] = hooks[event] || [];
        const found = eventHooks.some(
          (h: any) =>
            Array.isArray(h.hooks) &&
            h.hooks.some((ih: any) => (ih.command || "").includes("pitboss-signal"))
        );
        if (!found) {
          result.missingEvents.push(event);
        }
      }
      result.settingsConfigured = result.missingEvents.length === 0;
    } catch {
      result.missingEvents = [...HOOK_EVENTS];
    }
  }

  return result;
}
