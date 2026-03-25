import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "os";
import path from "path";
import type { Session, SignalData } from "../types.js";

// We test the pure logic functions by importing the module
// and mocking execFileSync for the subprocess-dependent ones
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock tmux and state to avoid real subprocess calls
vi.mock("../tmux.js", () => ({
  listPanes: vi.fn(() => []),
  run: vi.fn(),
  TMUX_SESSION: "pitboss",
}));

vi.mock("../state.js", () => ({
  readSignals: vi.fn(() => ({ ttySignals: {}, projectSignals: {} })),
}));

import { execFileSync } from "child_process";
import { cwdToProject, applySignal, detectProjects, detectProcess } from "../detector.js";

const CODE_DIR = path.join(os.homedir(), "Code");

describe("detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cwdToProject", () => {
    it("extracts project name from Code subdirectory", () => {
      expect(cwdToProject(`${CODE_DIR}/weather-api`)).toBe("weather-api");
    });

    it("extracts project name from nested path", () => {
      expect(cwdToProject(`${CODE_DIR}/weather-api/src/routes`)).toBe("weather-api");
    });

    it("returns null for paths outside Code dir", () => {
      expect(cwdToProject("/usr/local/bin")).toBeNull();
    });

    it("returns null for Code dir itself", () => {
      expect(cwdToProject(CODE_DIR)).toBeNull();
    });

    it("returns null for empty/unknown", () => {
      expect(cwdToProject("")).toBeNull();
      expect(cwdToProject("unknown")).toBeNull();
    });

    it("handles tilde paths", () => {
      expect(cwdToProject("~/Code/myproject")).toBe("myproject");
    });
  });

  describe("detectProcess", () => {
    const mockExec = execFileSync as unknown as ReturnType<typeof vi.fn>;

    it("returns unknown for empty tty", () => {
      expect(detectProcess("")).toEqual(["unknown", false]);
      expect(detectProcess("unknown")).toEqual(["unknown", false]);
    });

    it("detects active process", () => {
      mockExec.mockReturnValue("claude --model opus\n");
      const [proc, active] = detectProcess("/dev/ttys001");
      expect(proc).toBe("claude --model");
      expect(active).toBe(true);
    });

    it("skips idle shell commands", () => {
      mockExec.mockReturnValue("-zsh\nzsh\n");
      const [proc, active] = detectProcess("/dev/ttys001");
      expect(proc).toBe("zsh");
      expect(active).toBe(false);
    });

    it("skips background noise", () => {
      mockExec.mockReturnValue("gitstatusd\nzsh\n");
      const [proc, active] = detectProcess("/dev/ttys001");
      expect(proc).toBe("zsh");
      expect(active).toBe(false);
    });

    it("handles subprocess failure", () => {
      mockExec.mockImplementation(() => { throw new Error("no tty"); });
      const [proc, active] = detectProcess("/dev/ttys001");
      expect(proc).toBe("unknown");
      expect(active).toBe(false);
    });
  });

  describe("applySignal", () => {
    function makeSession(overrides: Partial<Session> = {}): Session {
      return {
        id: "%1",
        name: "main",
        tty: "/dev/ttys001",
        cwd: "/Users/test/Code/myapp",
        project: "myapp",
        branch: "main",
        process: "claude",
        active: false,
        focused: false,
        signal: null,
        signalDetail: "",
        signalDuration: null,
        devServer: null,
        diffStat: null,
        windowIndex: 0,
        windowName: "main",
        ...overrides,
      };
    }

    it("applies tty signal", () => {
      const session = makeSession();
      const now = Date.now() / 1000;
      const ttySignals: Record<string, SignalData> = {
        "/dev/ttys001": { status: "busy", detail: "Bash", ts: now, tty: "/dev/ttys001" },
      };

      applySignal(session, ttySignals, {});

      expect(session.signal).toBe("busy");
      expect(session.signalDetail).toBe("Bash");
      expect(session.active).toBe(true);
    });

    it("busy degrades to thinking after 10s", () => {
      const session = makeSession();
      const ttySignals: Record<string, SignalData> = {
        "/dev/ttys001": {
          status: "busy",
          detail: "Read",
          ts: Date.now() / 1000 - 15,
          tty: "/dev/ttys001",
        },
      };

      applySignal(session, ttySignals, {});

      expect(session.signal).toBe("thinking");
      expect(session.active).toBe(true);
    });

    it("thinking degrades to done after 30s", () => {
      const session = makeSession();
      const ttySignals: Record<string, SignalData> = {
        "/dev/ttys001": {
          status: "thinking",
          detail: "",
          ts: Date.now() / 1000 - 35,
          tty: "/dev/ttys001",
        },
      };

      applySignal(session, ttySignals, {});

      expect(session.signal).toBe("done");
      expect(session.active).toBe(false);
    });

    it("waiting persists after 120s", () => {
      const session = makeSession();
      const ttySignals: Record<string, SignalData> = {
        "/dev/ttys001": {
          status: "waiting",
          detail: "",
          ts: Date.now() / 1000 - 130,
          tty: "/dev/ttys001",
        },
      };

      applySignal(session, ttySignals, {});

      expect(session.signal).toBe("waiting");
    });

    it("done signal sets active to false", () => {
      const session = makeSession({ active: true });
      const ttySignals: Record<string, SignalData> = {
        "/dev/ttys001": {
          status: "done",
          detail: "",
          ts: Date.now() / 1000,
          tty: "/dev/ttys001",
        },
      };

      applySignal(session, ttySignals, {});

      expect(session.signal).toBe("done");
      expect(session.active).toBe(false);
    });

    it("falls back to project signal when no tty match", () => {
      const session = makeSession({ tty: "/dev/ttys999" });
      const projectSignals: Record<string, SignalData> = {
        "/Users/test/Code/myapp": {
          status: "busy",
          detail: "Write",
          ts: Date.now() / 1000,
        },
      };

      applySignal(session, {}, projectSignals);

      expect(session.signal).toBe("busy");
      expect(session.signalDetail).toBe("Write");
    });

    it("no signal leaves session unchanged", () => {
      const session = makeSession({ active: false });
      applySignal(session, {}, {});

      expect(session.signal).toBeNull();
      expect(session.active).toBe(false);
    });
  });

  describe("detectProjects", () => {
    it("groups sessions by project", () => {
      const sessions: Session[] = [
        {
          id: "%1", name: "main", tty: "/dev/ttys001", cwd: "/x",
          project: "app-a", branch: null, process: "claude", active: true,
          focused: false, signal: null, signalDetail: "", signalDuration: null,
          devServer: null, diffStat: null, windowIndex: 0, windowName: "main",
        },
        {
          id: "%2", name: "main", tty: "/dev/ttys002", cwd: "/y",
          project: "app-a", branch: null, process: "zsh", active: false,
          focused: false, signal: null, signalDetail: "", signalDuration: null,
          devServer: null, diffStat: null, windowIndex: 0, windowName: "main",
        },
        {
          id: "%3", name: "main", tty: "/dev/ttys003", cwd: "/z",
          project: "app-b", branch: null, process: "node", active: true,
          focused: false, signal: null, signalDetail: "", signalDuration: null,
          devServer: null, diffStat: null, windowIndex: 0, windowName: "main",
        },
      ];

      const projects = detectProjects(sessions);

      expect(Object.keys(projects)).toHaveLength(2);
      expect(projects["app-a"].sessions).toEqual(["%1", "%2"]);
      expect(projects["app-b"].sessions).toEqual(["%3"]);
    });

    it("skips sessions with no project", () => {
      const sessions: Session[] = [
        {
          id: "%1", name: "main", tty: "/dev/ttys001", cwd: "/tmp",
          project: null, branch: null, process: "zsh", active: false,
          focused: false, signal: null, signalDetail: "", signalDuration: null,
          devServer: null, diffStat: null, windowIndex: 0, windowName: "main",
        },
      ];

      const projects = detectProjects(sessions);
      expect(Object.keys(projects)).toHaveLength(0);
    });
  });
});
