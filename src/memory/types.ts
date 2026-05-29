/**
 * Memory 模块类型定义。
 *
 * 参考 Claude Code 的记忆系统设计，支持三层记忆作用域和四种记忆类型。
 *
 * 作用域（scope）— 决定记忆存储位置和可见性：
 * - global: 全局用户记忆（~/.mimocoding/memory/），跨所有项目生效
 * - project: 项目记忆（<project>/.mimocoding/memory/），可提交 git 共享
 * - local: 本地记忆（<project>/.mimocoding/memory-local/），不提交版本控制
 *
 * 类型（type）— 决定记忆的内容分类：
 * - user: 用户信息（角色、专长、偏好）
 * - project: 项目知识（决策、约束、时间线）
 * - reference: 外部资源指针（文档链接、issue tracker 等）
 * - feedback: 用户对 agent 行为的反馈偏好
 */

/** 记忆作用域枚举 */
export type MemoryScope = "global" | "project" | "local";

/** 记忆类型枚举 */
export type MemoryType = "user" | "project" | "reference" | "feedback";

/** 单条记忆条目（从 .md 文件解析） */
export interface MemoryEntry {
  /** 记忆的唯一标识名（对应文件名，如 user_role） */
  name: string;
  /** 一行描述，用于索引展示 */
  description: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 记忆作用域 */
  scope: MemoryScope;
  /** 创建时间 ISO 字符串 */
  created: string;
  /** 记忆内容（Markdown 格式） */
  content: string;
  /** 文件路径（由 store 填充） */
  filePath?: string;
}

/** MEMORY.md 索引条目 */
export interface MemoryIndexEntry {
  /** 记忆标题 */
  title: string;
  /** 对应的文件名 */
  fileName: string;
  /** 一行描述 */
  description: string;
}

/** 记忆存储配置 */
export interface MemoryConfig {
  /** 全局记忆目录（默认 ~/.mimocoding/memory/） */
  globalDir: string;
  /** 项目记忆目录（默认 <cwd>/.mimocoding/memory/） */
  projectDir: string;
  /** 本地记忆目录（默认 <cwd>/.mimocoding/memory-local/） */
  localDir: string;
  /** 是否启用记忆功能 */
  enabled: boolean;
  /** MEMORY.md 最大行数（超过则截断警告） */
  maxIndexLines: number;
  /** 单条记忆最大字符数 */
  maxMemoryChars: number;
}

/** 默认记忆配置（目录路径需在运行时填充） */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  globalDir: "",
  projectDir: "",
  localDir: "",
  enabled: true,
  maxIndexLines: 200,
  maxMemoryChars: 10000,
};

/** scope 到中文描述的映射（用于 UI 展示） */
export const SCOPE_LABELS: Record<MemoryScope, string> = {
  global: "Global (user preferences)",
  project: "Project",
  local: "Local (not committed)",
};

/** scope 的合法值列表 */
export const VALID_SCOPES: MemoryScope[] = ["global", "project", "local"];
