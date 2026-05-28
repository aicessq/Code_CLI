import type { ToolCall } from "../llm/message.js";
import type { LLMClient } from "../llm/base.js";
import type { ModelProfile } from "../llm/model_profile.js";
import type { AgentMessage } from "../llm/message.js";

export class ToolCallRepairer {
  async repair(
    invalidCall: ToolCall,
    validationError: string,
    profile: ModelProfile,
    llm: LLMClient
  ): Promise<ToolCall | null> {
    const repairMessages: AgentMessage[] = [
      {
        role: "system",
        content: `You are a tool call repair assistant. Given an invalid tool call and its validation error, produce a corrected tool call. Reply ONLY with a JSON object in this format: {"name": "tool_name", "arguments": {...}}. Do not include any other text.`,
      },
      {
        role: "user",
        content: `Invalid tool call:\n${JSON.stringify(invalidCall, null, 2)}\n\nValidation error: ${validationError}\n\nProduce the corrected tool call JSON.`,
      },
    ];

    try {
      const result = await llm.chat(repairMessages, null, profile, false);

      if (!result.content) return null;

      // Try to parse the response as a tool call
      const parsed = JSON.parse(result.content.trim());
      if (parsed.name && typeof parsed.name === "string") {
        return {
          id: invalidCall.id,
          name: parsed.name,
          arguments: parsed.arguments ?? {},
        };
      }
    } catch {
      // Repair failed
    }

    return null;
  }
}
