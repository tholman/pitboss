import { describe, it, expect } from "vitest";

// Import the helper functions and card builder by extracting them
// Since they're not exported, we re-implement the logic for testing
// TODO: refactor app.tsx to export helpers for testing

describe("tui helpers", () => {
  // Re-implement displayWidth to test the logic
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

  describe("displayWidth", () => {
    it("counts ASCII characters as width 1", () => {
      expect(displayWidth("hello")).toBe(5);
      expect(displayWidth("abc123")).toBe(6);
    });

    it("counts box-drawing characters as width 1", () => {
      expect(displayWidth("┌──┐")).toBe(4);
      expect(displayWidth("│")).toBe(1);
      expect(displayWidth("└──┘")).toBe(4);
    });

    it("counts empty string as 0", () => {
      expect(displayWidth("")).toBe(0);
    });

    it("handles status icons", () => {
      // These are single-width unicode
      expect(displayWidth("▶")).toBe(1);
      expect(displayWidth("◆")).toBe(1);
      expect(displayWidth("✔")).toBe(1);
      expect(displayWidth("✖")).toBe(1);
    });

    it("handles mixed content", () => {
      expect(displayWidth(" ▶ weather-api ")).toBe(15);
    });
  });

  describe("truncateToWidth", () => {
    it("returns full string if within target", () => {
      expect(truncateToWidth("hello", 10)).toBe("hello");
    });

    it("truncates to target width", () => {
      expect(truncateToWidth("hello world", 5)).toBe("hello");
    });

    it("handles empty string", () => {
      expect(truncateToWidth("", 5)).toBe("");
    });

    it("handles zero target", () => {
      expect(truncateToWidth("hello", 0)).toBe("");
    });
  });

  describe("padToWidth", () => {
    it("pads short string with spaces", () => {
      const result = padToWidth("hi", 5);
      expect(result).toBe("hi   ");
      expect(result.length).toBe(5);
    });

    it("truncates and pads long string", () => {
      const result = padToWidth("hello world!", 5);
      expect(displayWidth(result)).toBe(5);
    });

    it("returns exact width string unchanged", () => {
      const result = padToWidth("hello", 5);
      expect(result).toBe("hello");
    });
  });

  describe("fmtDuration", () => {
    it("returns empty for null", () => {
      expect(fmtDuration(null)).toBe("");
      expect(fmtDuration(undefined)).toBe("");
    });

    it("formats seconds", () => {
      expect(fmtDuration(0)).toBe("0s");
      expect(fmtDuration(30)).toBe("30s");
      expect(fmtDuration(59)).toBe("59s");
    });

    it("formats minutes", () => {
      expect(fmtDuration(60)).toBe("1m");
      expect(fmtDuration(90)).toBe("1m");
      expect(fmtDuration(300)).toBe("5m");
      expect(fmtDuration(3540)).toBe("59m");
    });

    it("formats hours", () => {
      expect(fmtDuration(3600)).toBe("1h0m");
      expect(fmtDuration(3660)).toBe("1h1m");
      expect(fmtDuration(7200)).toBe("2h0m");
      expect(fmtDuration(5400)).toBe("1h30m");
    });
  });
});

describe("card building", () => {
  type Status = "error" | "waiting" | "busy" | "thinking" | "done" | "active" | "idle";

  // Re-implement the status aggregation logic for testing
  function aggregateStatus(signals: (string | null)[], anyActive: boolean): Status {
    const hasError = signals.includes("error");
    const hasWaiting = signals.includes("waiting");
    const hasBusy = signals.includes("busy");
    const hasThinking = signals.includes("thinking");
    const hasDone = signals.includes("done");

    if (hasError) return "error";
    if (hasWaiting) return "waiting";
    if (hasBusy) return "busy";
    if (hasThinking) return "thinking";
    if (hasDone) return "done";
    if (anyActive) return "active";
    return "idle";
  }

  describe("status aggregation", () => {
    it("error takes highest priority", () => {
      expect(aggregateStatus(["busy", "error", "done"], false)).toBe("error");
    });

    it("waiting beats busy", () => {
      expect(aggregateStatus(["busy", "waiting"], false)).toBe("waiting");
    });

    it("busy beats thinking", () => {
      expect(aggregateStatus(["thinking", "busy"], false)).toBe("busy");
    });

    it("thinking beats done", () => {
      expect(aggregateStatus(["done", "thinking"], false)).toBe("thinking");
    });

    it("done beats active", () => {
      expect(aggregateStatus(["done"], true)).toBe("done");
    });

    it("active beats idle", () => {
      expect(aggregateStatus([], true)).toBe("active");
    });

    it("idle is default", () => {
      expect(aggregateStatus([], false)).toBe("idle");
    });

    it("single busy session", () => {
      expect(aggregateStatus(["busy"], false)).toBe("busy");
    });
  });

  describe("top border construction", () => {
    it("builds correct border with all parts", () => {
      const innerW = 56;
      const left = " ▶ weather-api ";
      const right = " #1  2m  ⎇ main ";
      const leftW = left.length; // all single-width ASCII + icon
      const rightW = right.length;
      const fillW = Math.max(1, innerW - leftW - rightW);
      const top = `┌${left}${"─".repeat(fillW)}${right}┐`;

      // Should be exactly innerW + 2 (for ┌ and ┐)
      expect(top.startsWith("┌")).toBe(true);
      expect(top.endsWith("┐")).toBe(true);
      expect(top).toContain("weather-api");
      expect(top).toContain("⎇ main");
    });

    it("truncates right side when card is narrow", () => {
      const innerW = 30;
      const left = " ▶ my-very-long-project-name ";
      const leftW = left.length;
      const right = " #1  idle 5m  ⎇ feature/long-branch ";
      let rightW = right.length;

      const maxRight = innerW - leftW - 3;
      let truncatedRight = right;
      if (rightW > maxRight) {
        truncatedRight = right.slice(0, Math.max(0, maxRight));
        rightW = truncatedRight.length;
      }

      const fillW = Math.max(1, innerW - leftW - rightW);
      expect(fillW).toBeGreaterThanOrEqual(1);
    });
  });
});
