/**
 * Color themes for the pitboss TUI.
 *
 * Each theme defines the full palette: status colors, text, and chrome.
 */

export interface Theme {
  name: string;

  // Status — the core vocabulary
  busy: string;
  thinking: string;
  waiting: string;
  error: string;
  done: string;
  active: string;
  idle: string;

  // Text
  text: string;
  textDim: string;
  muted: string;

  // Chrome
  accent: string;
  border: string;
  divider: string;
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

/** Default dark theme — high contrast, warm ambers and cool blues. */
const midnight: Theme = {
  name: "midnight",
  busy: "#ffaf00",
  thinking: "#ffdf5f",
  waiting: "#af5fff",
  error: "#ff5f5f",
  done: "#5fff87",
  active: "#5fafff",
  idle: "#6c6c6c",
  text: "#e4e4e4",
  textDim: "#a0a0a0",
  muted: "#6c6c6c",
  accent: "#5fafff",
  border: "#585858",
  divider: "#4a4a4a",
};

/** Dracula-inspired — purples and pinks. */
const dracula: Theme = {
  name: "dracula",
  busy: "#ffb86c",
  thinking: "#f1fa8c",
  waiting: "#bd93f9",
  error: "#ff5555",
  done: "#50fa7b",
  active: "#8be9fd",
  idle: "#6272a4",
  text: "#f8f8f2",
  textDim: "#bfbfbf",
  muted: "#6272a4",
  accent: "#bd93f9",
  border: "#44475a",
  divider: "#44475a",
};

/** Catppuccin Mocha — soft pastels. */
const catppuccin: Theme = {
  name: "catppuccin",
  busy: "#fab387",
  thinking: "#f9e2af",
  waiting: "#cba6f7",
  error: "#f38ba8",
  done: "#a6e3a1",
  active: "#89b4fa",
  idle: "#585b70",
  text: "#cdd6f4",
  textDim: "#a6adc8",
  muted: "#585b70",
  accent: "#89b4fa",
  border: "#45475a",
  divider: "#45475a",
};

/** Solarized Dark — Ethan Schoonover's classic. */
const solarized: Theme = {
  name: "solarized",
  busy: "#b58900",
  thinking: "#cb4b16",
  waiting: "#6c71c4",
  error: "#dc322f",
  done: "#859900",
  active: "#268bd2",
  idle: "#586e75",
  text: "#839496",
  textDim: "#657b83",
  muted: "#586e75",
  accent: "#268bd2",
  border: "#073642",
  divider: "#073642",
};

/** Gruvbox Dark — earthy, warm tones. */
const gruvbox: Theme = {
  name: "gruvbox",
  busy: "#fabd2f",
  thinking: "#fe8019",
  waiting: "#d3869b",
  error: "#fb4934",
  done: "#b8bb26",
  active: "#83a598",
  idle: "#665c54",
  text: "#ebdbb2",
  textDim: "#a89984",
  muted: "#665c54",
  accent: "#83a598",
  border: "#504945",
  divider: "#504945",
};

/** Tokyo Night — cool blues and purples. */
const tokyoNight: Theme = {
  name: "tokyo-night",
  busy: "#e0af68",
  thinking: "#ff9e64",
  waiting: "#bb9af7",
  error: "#f7768e",
  done: "#9ece6a",
  active: "#7aa2f7",
  idle: "#565f89",
  text: "#c0caf5",
  textDim: "#a9b1d6",
  muted: "#565f89",
  accent: "#7aa2f7",
  border: "#3b4261",
  divider: "#3b4261",
};

/** Nord — arctic blues and frost. */
const nord: Theme = {
  name: "nord",
  busy: "#ebcb8b",
  thinking: "#d08770",
  waiting: "#b48ead",
  error: "#bf616a",
  done: "#a3be8c",
  active: "#88c0d0",
  idle: "#4c566a",
  text: "#eceff4",
  textDim: "#d8dee9",
  muted: "#4c566a",
  accent: "#88c0d0",
  border: "#3b4252",
  divider: "#3b4252",
};

/** Pitboss — matches terminator: pure terminal colors, no faded hex. */
const pitboss: Theme = {
  name: "pitboss",
  busy: "yellow",
  thinking: "yellow",
  waiting: "magenta",
  error: "red",
  done: "green",
  active: "cyan",
  idle: "gray",
  text: "white",
  textDim: "white",
  muted: "gray",
  accent: "cyan",
  border: "white",
  divider: "gray",
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const THEMES: Record<string, Theme> = {
  pitboss,
  midnight,
  dracula,
  catppuccin,
  solarized,
  gruvbox,
  "tokyo-night": tokyoNight,
  nord,
};

export const DEFAULT_THEME = "pitboss";

export function getTheme(name?: string | null): Theme {
  if (name && name in THEMES) return THEMES[name];
  return THEMES[DEFAULT_THEME];
}

export function listThemes(): string[] {
  return Object.keys(THEMES);
}
