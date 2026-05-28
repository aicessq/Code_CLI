import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { profileRegistry } from "./profiles/registry.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ".";
export const CONFIG_DIR = join(HOME, ".mimocoding");
const SETTINGS_FILE = "settings.json";

export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface Settings {
  activeProvider: string;
  providers: Record<string, ProviderConfig>;
  sandbox: "docker" | "local";
  maxSteps: number;
  logDir: string;
  dockerImage?: string;
}

export interface ResolvedConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  profile: import("./llm/model_profile.js").ModelProfile;
  sandbox: "docker" | "local";
  maxSteps: number;
  workingDirectory: string;
  logDir: string;
  dockerImage: string;
}

const DEFAULT_SETTINGS: Settings = {
  activeProvider: "mimo-token-plan",
  providers: {
    "mimo-token-plan": {
      apiKey: "",
      baseURL: "https://token-plan-cn.xiaomimimo.com/v1",
      model: "mimo-v2-pro",
    },
    "mimo": {
      apiKey: "",
      baseURL: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2-pro",
    },
  },
  sandbox: "local",
  maxSteps: 30,
  logDir: join(CONFIG_DIR, "runs"),
};

function loadSettingsFile(): Partial<Settings> | null {
  const candidates = [
    join(CONFIG_DIR, SETTINGS_FILE),
    resolve(process.cwd(), "mimocoding.json"),
    resolve(process.cwd(), "settings.json"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as Partial<Settings>;
    } catch {
      console.warn(`Warning: failed to parse ${path}, skipping`);
    }
  }

  return null;
}

export function loadSettings(): Settings {
  const fileSettings = loadSettingsFile();
  if (!fileSettings) return { ...DEFAULT_SETTINGS };

  return {
    ...DEFAULT_SETTINGS,
    ...fileSettings,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...(fileSettings.providers ?? {}),
    },
  };
}

export function resolveConfig(settings: Settings): ResolvedConfig {
  const provider = settings.providers[settings.activeProvider];
  if (!provider) {
    const available = Object.keys(settings.providers).join(", ");
    throw new Error(`Provider "${settings.activeProvider}" not found in settings. Available: ${available}`);
  }
  if (!provider.apiKey) {
    throw new Error(`No API key for provider "${settings.activeProvider}". Edit ${join(CONFIG_DIR, SETTINGS_FILE)}`);
  }

  const profile = profileRegistry.get(provider.model);
  // baseURL goes directly to OpenAI SDK which appends /chat/completions
  const baseURL = provider.baseURL.replace(/\/+$/, "");

  return {
    apiKey: provider.apiKey,
    baseURL,
    model: provider.model,
    profile,
    sandbox: settings.sandbox,
    maxSteps: settings.maxSteps,
    workingDirectory: process.cwd(),
    logDir: settings.logDir,
    dockerImage: settings.dockerImage ?? "code-agent-sandbox:latest",
  };
}

export function initConfig(): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const configPath = join(CONFIG_DIR, SETTINGS_FILE);

  if (existsSync(configPath)) {
    return configPath;
  }

  writeFileSync(configPath, JSON.stringify(DEFAULT_SETTINGS, null, 2) + "\n", "utf-8");
  return configPath;
}
