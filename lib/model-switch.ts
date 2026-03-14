import type { ResolvedGatewayKey } from "@/lib/upstream";
import type { KeyModelMapping } from "@/lib/key-config";
import { parseOverflowModelSelection } from "@/lib/overflow-model";

// Pick appropriate model based on context window size and dynamic switch settings
// 根据上下文窗口大小和动态切换设置选择合适的模型
export function pickModelByContext(
  requestedModel: string,
  estimatedInputTokens: number,
  key: Pick<
    ResolvedGatewayKey,
    "dynamicModelSwitch" | "contextSwitchThreshold" | "contextOverflowModel"
  >,
  mapping?: KeyModelMapping | null
) {
  // Mapping-level context switch takes priority over key-level settings.
  // 映射级别的上下文切换优先于 Key 级别的设置。
  const useMappingSwitch = mapping?.dynamicModelSwitch ?? false;
  const useMappingThreshold = mapping?.contextSwitchThreshold ?? 12000;
  const useMappingOverflow = mapping?.contextOverflowModel ?? null;

  const switchEnabled = useMappingSwitch || key.dynamicModelSwitch;
  const switchThreshold = useMappingSwitch ? useMappingThreshold : key.contextSwitchThreshold;
  const overflowModelRaw = useMappingSwitch ? useMappingOverflow : key.contextOverflowModel;

  if (!switchEnabled) {
    return {
      model: requestedModel,
      upstreamChannelId: null,
      switched: false,
      estimatedInputTokens
    };
  }

  // Parse overflow model configuration
  // 解析溢出模型配置
  const overflowSelection = parseOverflowModelSelection(overflowModelRaw);

  // Switch to overflow model if:
  // 1. Overflow model is configured
  // 2. Estimated tokens exceed threshold
  // 3. Requested model is different from overflow model
  // 在以下情况下切换到溢出模型：
  // 1. 配置了溢出模型
  // 2. 估计 token 数超过阈值
  // 3. 请求的模型与溢出模型不同
  if (
    overflowSelection &&
    estimatedInputTokens >= switchThreshold &&
    requestedModel !== overflowSelection.model
  ) {
    return {
      model: overflowSelection.model,
      upstreamChannelId: overflowSelection.upstreamChannelId,
      switched: true,
      estimatedInputTokens
    };
  }

  // No switch needed, use requested model
  // 无需切换，使用请求的模型
  return {
    model: requestedModel,
    upstreamChannelId: null,
    switched: false,
    estimatedInputTokens
  };
}
