/**
 * 记忆工具。
 *
 * 提供 save_memory 和 list_memories 两个工具，让 agent 能够跨 session 持久化知识。
 *
 * save_memory: 保存一条记忆到磁盘，包含类型、作用域、描述和内容。
 *   - scope 决定存储位置：global（用户级）、project（项目级）、local（本地）
 *   - 记忆以 .md 文件形式存储（带 YAML frontmatter）
 *   - 自动更新对应 scope 的 MEMORY.md 索引
 *   - 同名记忆会被覆盖
 *
 * list_memories: 列出所有已保存的记忆。
 *   - 按 scope 分组展示（global / project / local）
 *   - 返回记忆名称、类型和描述的列表
 */
import type { Tool, ToolContext } from "./base.js";
import type { ToolResult } from "../llm/message.js";
import type { MemoryLoader } from "../memory/loader.js";
import type { MemoryType, MemoryScope } from "../memory/types.js";
import { VALID_SCOPES } from "../memory/types.js";

/** 合法的记忆类型列表 */
const VALID_TYPES: MemoryType[] = ["user", "project", "reference", "feedback"];

/**
 * 创建记忆工具集。
 * 使用工厂模式，因为工具需要访问 MemoryLoader 实例。
 *
 * @param loader - 记忆加载器实例（由 agent loop 注入）
 */
export function createMemoryTools(loader: MemoryLoader): Tool[] {
  const saveMemoryTool: Tool = {
    schema: {
      name: "save_memory",
      description: "Save a memory to persist knowledge across sessions. Use this to remember user preferences, project decisions, external references, or behavioral feedback.",
      parameters: [
        {
          name: "name",
          type: "string",
          description: "Unique identifier for the memory (e.g., user_role, project_auth_decisions). Use lowercase with underscores.",
          required: true,
        },
        {
          name: "type",
          type: "string",
          description: "Memory type: user (who the user is), project (project knowledge), reference (pointers to external systems), feedback (user preferences for agent behavior)",
          required: true,
          enum: VALID_TYPES,
        },
        {
          name: "scope",
          type: "string",
          description: "Memory scope: global (user-wide, applies to all projects), project (project-specific, can be committed to git), local (machine-specific, not committed)",
          required: true,
          enum: VALID_SCOPES,
        },
        {
          name: "description",
          type: "string",
          description: "One-line description for the memory index (under 100 chars)",
          required: true,
        },
        {
          name: "content",
          type: "string",
          description: "The memory content in markdown format",
          required: true,
        },
      ],
    },

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const name = String(args.name || "").trim();
      const type = String(args.type || "").trim() as MemoryType;
      const scope = String(args.scope || "").trim() as MemoryScope;
      const description = String(args.description || "").trim();
      const content = String(args.content || "").trim();

      // 验证参数
      if (!name) {
        return { toolCallId: "", name: "save_memory", content: "Error: name is required", isError: true };
      }
      if (!VALID_TYPES.includes(type)) {
        return { toolCallId: "", name: "save_memory", content: `Error: type must be one of: ${VALID_TYPES.join(", ")}`, isError: true };
      }
      if (!VALID_SCOPES.includes(scope)) {
        return { toolCallId: "", name: "save_memory", content: `Error: scope must be one of: ${VALID_SCOPES.join(", ")}`, isError: true };
      }
      if (!description) {
        return { toolCallId: "", name: "save_memory", content: "Error: description is required", isError: true };
      }
      if (!content) {
        return { toolCallId: "", name: "save_memory", content: "Error: content is required", isError: true };
      }

      try {
        loader.saveMemory({
          name,
          type,
          scope,
          description,
          content,
          created: new Date().toISOString(),
        });

        return {
          toolCallId: "",
          name: "save_memory",
          content: `Memory "${name}" saved successfully (${scope}/${type}: ${description})`,
          isError: false,
        };
      } catch (err) {
        return {
          toolCallId: "",
          name: "save_memory",
          content: `Error saving memory: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };

  const listMemoriesTool: Tool = {
    schema: {
      name: "list_memories",
      description: "List all saved memories grouped by scope (global/project/local). Shows memory names, types, and descriptions.",
      parameters: [],
    },

    async execute(_args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      try {
        const memories = loader.listMemories();

        if (memories.length === 0) {
          return {
            toolCallId: "",
            name: "list_memories",
            content: "No memories saved yet.",
            isError: false,
          };
        }

        // 按 scope 分组，再按 type 分组
        const byScope: Record<string, typeof memories> = {};
        for (const m of memories) {
          if (!byScope[m.scope]) byScope[m.scope] = [];
          byScope[m.scope].push(m);
        }

        const lines: string[] = [`Total: ${memories.length} memories`];

        for (const scope of VALID_SCOPES) {
          const scopeMemories = byScope[scope];
          if (!scopeMemories || scopeMemories.length === 0) continue;

          lines.push(`\n[${scope}]`);
          for (const m of scopeMemories) {
            lines.push(`  - ${m.name} (${m.type}): ${m.description}`);
          }
        }

        return {
          toolCallId: "",
          name: "list_memories",
          content: lines.join("\n"),
          isError: false,
        };
      } catch (err) {
        return {
          toolCallId: "",
          name: "list_memories",
          content: `Error listing memories: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };

  return [saveMemoryTool, listMemoriesTool];
}
