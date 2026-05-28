import { ModelProfileRegistry } from "../llm/model_profile.js";
import { MIMO_V2_PRO } from "./mimo_v2_pro.js";
import { MIMO_V2_FLASH } from "./mimo_v2_flash.js";
import { MIMO_V25_PRO } from "./mimo_v25_pro.js";
import { OPENAI_DEFAULT } from "./openai.js";
import { DEEPSEEK_V3 } from "./deepseek.js";
import { QWEN_MAX } from "./qwen.js";
import { CLAUDE_PROXY } from "./claude_proxy.js";

const registry = new ModelProfileRegistry();

registry.register(MIMO_V2_PRO);
registry.register(MIMO_V2_FLASH);
registry.register(MIMO_V25_PRO);
registry.register(OPENAI_DEFAULT);
registry.register(DEEPSEEK_V3);
registry.register(QWEN_MAX);
registry.register(CLAUDE_PROXY);

export { registry as profileRegistry };
export { ModelProfileRegistry } from "../llm/model_profile.js";
