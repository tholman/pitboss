/**
 * Animation system for pitboss TUI.
 *
 * Provides a tick-based animation framework. Components read the current
 * tick and pick frames from animation sequences. The tick advances on
 * every render cycle (~500ms), giving smooth terminal animations.
 *
 * Designed to extend: future features like pulsing connection lines,
 * flowing data veins, and breathing borders all hook into the same tick.
 */

// Braille spinner frames (same style as Claude Code)
const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Dot pulse: animated ellipsis
const DOT_PULSE = ["   ", ".  ", ".. ", "..."];

// Waiting pulse
const WAITING_PULSE = ["◇", "◈", "◆", "◈"];

// Done - static
const DONE_STATIC = "✓";

// Error - static
const ERROR_STATIC = "✗";

// Idle - static
const IDLE_STATIC = "·";

export interface AnimatedIcon {
  frames: string[];
  /** How many ticks per frame (1 = every tick, 2 = every other tick) */
  speed: number;
}

export const STATUS_ANIMS: Record<string, AnimatedIcon> = {
  busy: { frames: BRAILLE_SPINNER, speed: 1 },
  thinking: { frames: DOT_PULSE, speed: 2 },
  waiting: { frames: WAITING_PULSE, speed: 2 },
  error: { frames: [ERROR_STATIC], speed: 1 },
  done: { frames: [DONE_STATIC], speed: 1 },
  active: { frames: ["●"], speed: 1 },
  idle: { frames: [IDLE_STATIC], speed: 1 },
};

/** Get the current frame for an animation given the global tick. */
export function getFrame(anim: AnimatedIcon, tick: number): string {
  const idx = Math.floor(tick / anim.speed) % anim.frames.length;
  return anim.frames[idx];
}

/** Get the status icon for a given status at the current tick. */
export function statusIcon(status: string, tick: number): string {
  const anim = STATUS_ANIMS[status];
  if (!anim) return IDLE_STATIC;
  return getFrame(anim, tick);
}

// ---------------------------------------------------------------------------
// Pulse helpers — for future use with connection lines, borders, etc.
// ---------------------------------------------------------------------------

/** Sine-wave pulse: returns 0..1 based on tick. Period = number of ticks for one full cycle. */
export function pulse(tick: number, period: number = 8): number {
  return (Math.sin((tick / period) * Math.PI * 2) + 1) / 2;
}

/** Pick between two strings based on pulse threshold. */
export function pulseChar(tick: number, a: string, b: string, period: number = 8): string {
  return pulse(tick, period) > 0.5 ? a : b;
}
