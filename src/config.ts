import fs from "fs";
import os from "os";
import path from "path";

export const CODE_DIR =
  process.env.PITBOSS_CODE_DIR || path.join(os.homedir(), "Code");

export const PITBOSS_DIR = path.join(os.homedir(), ".pitboss");
const CONFIG_FILE = path.join(PITBOSS_DIR, "config.json");

interface PitbossConfig {
  theme?: string;
}

export function loadConfig(): PitbossConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

export function saveConfig(config: PitbossConfig): void {
  fs.mkdirSync(PITBOSS_DIR, { recursive: true });
  const tmp = CONFIG_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
}
