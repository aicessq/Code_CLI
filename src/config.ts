import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { profileRegistry } from "./profiles/registry.js";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ".";
export const CONFIG_DIR = join(HOME, ".mimocoding");
const SETTINGS_FILE = "settings.json";

/**
 * 单个 provider 的配置。
 * provider 是 LLM 服务的接入点，包含 API 密钥、基础 URL 和模型名称。
 * 一个 settings 文件可以配置多个 provider，通过 activeProvider 切换。
 */
export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * 用户设置文件的结构。
 * 存储在 ~/.mimocoding/settings.json，采用 Claude Code 风格的配置方式。
 */
export interface Settings {
  /** 当前激活的 provider 名称（对应 providers 中的 key） */
  activeProvider: string;
  /** 所有可用 provider 的配置映射 */
  providers: Record<string, ProviderConfig>;
  /** 沙箱模式：local（本地 bash）或 docker（Docker 容器） */
  sandbox: "docker" | "local";
  /** 单次任务的最大步数限制 */
  maxSteps: number;
  /** 运行日志输出目录 */
  logDir: string;
  /** Docker 沙箱使用的镜像名称（仅 sandbox=docker 时生效） */
  dockerImage?: string;
  /** 全局记忆目录（默认 ~/.mimocoding/memory/，用户级，跨所有项目） */
  globalMemoryDir?: string;
  /** 项目记忆目录（默认 <cwd>/.mimocoding/memory/，可提交 git） */
  projectMemoryDir?: string;
  /** 本地记忆目录（默认 <cwd>/.mimocoding/memory-local/，不提交版本控制） */
  localMemoryDir?: string;
  /** 是否启用记忆功能（默认 true） */
  memoryEnabled?: boolean;
}

/**
 * 解析后的运行时配置。
 * 由 resolveConfig(settings) 合并 provider 凭据和 ModelProfile 能力标志得到。
 * agent loop 和 REPL 使用此配置初始化所有组件。
 */
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
  /** 全局记忆目录（用户级） */
  globalMemoryDir: string;
  /** 项目记忆目录（可提交 git） */
  projectMemoryDir: string;
  /** 本地记忆目录（不提交版本控制） */
  localMemoryDir: string;
  /** 是否启用记忆功能 */
  memoryEnabled: boolean;
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

/**
 * 按优先级搜索设置文件。
 * 搜索顺序：~/.mimocoding/settings.json → ./mimocoding.json → ./settings.json
 * 找到第一个有效文件后返回其内容，解析失败则跳过并警告。
 */
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

/**
 * 加载并合并设置。
 * 文件中的设置会与 DEFAULT_SETTINGS 合并（providers 做浅合并）。
 * 未找到设置文件时返回默认设置。
 */
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

/**
 * 将 Settings 解析为 ResolvedConfig。
 * 验证 activeProvider 存在且有 API 密钥，查找对应的 ModelProfile，
 * 清理 baseURL 末尾斜杠（OpenAI SDK 会自动追加 /chat/completions）。
 *
 * 环境变量回退：
 * - API_KEY: MIMO_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY 等（provider 名大写 + _API_KEY）
 * - BASE_URL: MIMO_BASE_URL / OPENAI_BASE_URL 等
 * - MODEL: MIMO_MODEL / OPENAI_MODEL 等
 * 环境变量优先级低于 settings 文件，仅在文件中未配置时生效。
 */
export function resolveConfig(settings: Settings): ResolvedConfig {
  const provider = settings.providers[settings.activeProvider];
  if (!provider) {
    const available = Object.keys(settings.providers).join(", ");
    throw new Error(`Provider "${settings.activeProvider}" not found in settings. Available: ${available}`);
  }

  // 环境变量回退：provider 名转大写作为前缀（如 mimo-token-plan → MIMO_TOKEN_PLAN）
  const envPrefix = settings.activeProvider.toUpperCase().replace(/-/g, "_");

  const apiKey = provider.apiKey || process.env[`${envPrefix}_API_KEY`] || "";
  const baseURL = (provider.baseURL || process.env[`${envPrefix}_BASE_URL`] || "").replace(/\/+$/, "");
  const model = provider.model || process.env[`${envPrefix}_MODEL`] || "";

  if (!apiKey) {
    throw new Error(
      `No API key for provider "${settings.activeProvider}". ` +
      `Set it in ${join(CONFIG_DIR, SETTINGS_FILE)} or via ${envPrefix}_API_KEY environment variable.`
    );
  }

  const profile = profileRegistry.get(model);

  return {
    apiKey,
    baseURL,
    model,
    profile,
    sandbox: settings.sandbox,
    maxSteps: settings.maxSteps,
    workingDirectory: process.cwd(),
    logDir: settings.logDir,
    dockerImage: settings.dockerImage ?? "code-agent-sandbox:latest",
    globalMemoryDir: settings.globalMemoryDir ?? join(CONFIG_DIR, "memory"),
    projectMemoryDir: settings.projectMemoryDir ?? join(process.cwd(), ".mimocoding", "memory"),
    localMemoryDir: settings.localMemoryDir ?? join(process.cwd(), ".mimocoding", "memory-local"),
    memoryEnabled: settings.memoryEnabled ?? true,
  };
}

/**
 * 初始化配置文件。
 * 创建 ~/.mimocoding/ 目录和默认 settings.json。
 * 如果配置文件已存在，直接返回路径（不覆盖）。
 */
export function initConfig(): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const configPath = join(CONFIG_DIR, SETTINGS_FILE);

  if (existsSync(configPath)) {
    return configPath;
  }

  writeFileSync(configPath, JSON.stringify(DEFAULT_SETTINGS, null, 2) + "\n", "utf-8");
  return configPath;
}
