# pitboss

A tmux dashboard for managing multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions.

Running Claude in 4 terminals at once? Pitboss shows you which one's busy, which one's done, and which one needs your attention — all in a sidebar.

```
━━━━━━━━━━━ ┏━┓╻╺┳╸┏┓ ┏━┓┏━┓┏━┓ ━━━━━━━━━━━
            ┣━┛┃ ┃ ┣┻┓┃ ┃┗━┓┗━┓
━━━━━━━━━━━ ╹  ╹ ╹ ┗━┛┗━┛┗━┛┗━┛ ━━━━━━━━━━━

╭ › 1. weather-api ──────── 42s  ⎇ main ╮
│ ⠹ claude bash                          │
├────────────────────────────────────────┤
│ http://localhost:8080                  │
├────────────────────────────────────────┤
│ +127 -34                              │
├────────────────────────────────────────┤
│ ☐ add forecast caching layer          │
│ ☐ rate limiting for free tier         │
╰────────────────────────────────────────╯

╭   2. pixel-editor ─── took 3m  ⎇ main ╮
│ ✓ claude done                          │
├────────────────────────────────────────┤
│ ☐ undo/redo for brush strokes         │
│ ☐ export as SVG                       │
╰────────────────────────────────────────╯

╭   3. recipe-app ──────── 12s  ⎇ main  ╮
│ ...claude thinking                     │
├────────────────────────────────────────┤
│ a: add todo                           │
╰────────────────────────────────────────╯
```

## Layout

Pitboss creates a tmux session with a sidebar + grid:

```
┌──────────┬───────────┬───────────┐
│          │ project 1 │ project 2 │
│   TUI    │           │           │
│ sidebar  ├───────────┼───────────┤
│          │ project 3 │ project 4 │
│          │           │           │
└──────────┴───────────┴───────────┘
```

Switch between panes with `Ctrl-b 1` through `Ctrl-b 4` — works even when you're mid-conversation with Claude.

## Install

```bash
brew install tmux
npm install -g pitboss
pitboss setup
```

`pitboss setup` installs Claude Code hooks into `~/.claude/settings.json` so the dashboard can see what Claude is doing. It registers hooks for tool use, permission requests, session start/stop, and notifications.

Run `pitboss doctor` to verify everything is configured.

## Usage

```bash
pitboss               # launch (or reattach if already running)
pitboss launch 2      # launch with 2 panes instead of the default 4
```

Then `cd` into a project in any pane and run `claude`. The dashboard picks it up automatically.

### How projects are detected

Pitboss groups panes by project. A "project" is any directory directly under your code root (default: `~/Code`). If you `cd ~/Code/weather-api` in a pane, that pane belongs to the `weather-api` project.

Set `PITBOSS_CODE_DIR` to change the root:

```bash
export PITBOSS_CODE_DIR=~/projects
```

### Switching panes

From any pane (even mid-Claude conversation):

| Keys | Action |
|------|--------|
| `Ctrl-b 0` | Jump to dashboard |
| `Ctrl-b 1`-`4` | Jump to project pane |

Or click any pane with the mouse.

### Dashboard keys

| Key | Action |
|-----|--------|
| `1`-`9` | Jump to project pane |
| `j`/`k` | Navigate between cards |
| `Enter` | Focus selected project pane |
| `n` | Add a new pane |
| `o` | Open dev server in browser |
| `a` | Add a todo to selected project |
| `x` | Mark first todo as done |
| `t` | Cycle color theme |
| `r` | Force refresh |
| `q` | Quit |

## What it detects

- **Claude status** — busy (tool running), thinking (between tools), waiting (needs input), done, error
- **Dev servers** — finds listening ports via `lsof`, shows clickable `http://localhost:PORT` (CMD+click)
- **Git branch** — per-project, shown in card header
- **Git diff stats** — `+lines -lines` for uncommitted changes
- **Todos** — from `TODO.md` checkboxes and inline dashboard todos
- **Session timing** — how long Claude's been working, how long since it finished

## Todos

Each project card shows todos from two sources:

1. **`TODO.md`** — if your project has a `TODO.md` with `- [ ]` checkboxes, they appear on the card automatically
2. **Inline todos** — press `a` in the dashboard to add a quick todo, `x` to mark it done

```bash
# Or manage from the CLI
pitboss todo add "fix the auth bug" -p weather-api
pitboss todo list
pitboss todo done <id>
```

Done todos show briefly with a ☑ then disappear.

## Themes

Pitboss ships with 8 color themes. Press `t` in the dashboard to cycle through them, or set one from the CLI:

```bash
pitboss theme              # list available themes
pitboss theme catppuccin   # set a theme
```

Available: `pitboss` (default), `midnight`, `dracula`, `catppuccin`, `solarized`, `gruvbox`, `tokyo-night`, `nord`.

## How it works

```
Claude Code hooks ──→ signal files (~/.pitboss/signals/)
                              ↓
tmux list-panes ──→ pane list (tty, cwd, process)
                              ↓
              detector matches signals to panes
                              ↓
                    TUI renders project cards
```

Every second, pitboss queries tmux for all panes, detects working directories and processes, and matches them against signal files written by Claude Code hooks. Panes are grouped by project, and each project gets a card.

### Signal lifecycle

Claude Code hooks write JSON signal files to `~/.pitboss/signals/` on every event:

| Hook Event | Signal | Meaning |
|------------|--------|---------|
| `PreToolUse` | `busy` | Claude is running a tool |
| `PostToolUse` | `thinking` | Tool finished, Claude is processing |
| `PermissionRequest` | `waiting` | Claude needs approval (edit/bash confirmation) |
| `Stop` | `waiting` | Claude finished, waiting for next prompt |
| `Notification` | `waiting` | Claude sent a notification |
| `SessionEnd` | `done` | Session closed |
| `PostToolUseFailure` | `error` | A tool call failed |

Signals auto-expire after 120 seconds. The `waiting` signal persists until the user acts.

### Hot reload (development)

When developing pitboss, the TUI pane runs with `node --watch` so it auto-restarts when `dist/` changes:

```bash
npm run dev    # tsc --watch — rebuilds on save
pitboss        # TUI auto-restarts when dist/ changes
```

## CLI reference

```
pitboss                          Launch TUI (or attach if session exists)
pitboss launch [N]               Create tmux session with N panes (default: 4)
pitboss attach                   Attach to running session
pitboss add <name> [-d path]     Add a project window
pitboss focus <target>           Switch to project by name or number
pitboss list                     Print sessions/projects
pitboss signal <status> [-d msg] Signal status update
pitboss todo add <text> [-p proj]
pitboss todo list [-p proj]
pitboss todo done <id>
pitboss theme [name]             List or set color theme
pitboss fix                      Repair layout (re-add TUI sidebar, re-tile)
pitboss setup                    Install Claude Code hooks
pitboss doctor                   Check prerequisites
```

## Requirements

- macOS
- tmux (`brew install tmux`)
- Node 18+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## License

MIT
