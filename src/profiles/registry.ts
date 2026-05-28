import { ModelProfileRegistry } from "../llm/model_profile.js";
import { MIMO_V2_PRO } from "./mimo_v2_pro.js";
import { MIMO_V2_FLASH } from "./mimo_v2_flash.js";
import { MIMO_V25_PRO } from "./mimo_v25_pro.js";
import { OPENAI_DEFAULT } from "./openai.js";
import { DEEPSEEK_V3 } from "./deepseek.js";
import { QWEN_MAX } from "./qwen.js";
import { CLAUDE_PROXY } from "./claude_proxy.js";

/**
 * 全局模型 profile 注册表。
 * 预注册所有支持的模型，config.resolveConfig() 通过 profileRegistry.get(modelName) 查找。
 * 添加新模型：在 src/profiles/ 下创建 .ts 文件定义 ModelProfile，然后在此注册。
 */
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
