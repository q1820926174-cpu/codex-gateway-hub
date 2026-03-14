import type { ResolvedGatewayKey } from "@/lib/upstream";
import { parseOverflowModelSelection } from "@/lib/overflow-model";

// Pick appropriate model based on context window size and dynamic switch settings
// 根据上下文窗口大小和动态切换设置选择合适的模型
export function pickModelByContext(
  requestedModel: string,
  estimatedInputTokens: number,
  key: Pick<
    ResolvedGatewayKey,
    "dynamicModelSwitch" | "contextSwitchThreshold" | "contextOverflowModel"
  >
) {
  // If dynamic model switch is not enabled, use the requested model
  // 如果未启用动态模型切换，使用请求的模型
  if (!key.dynamicModelSwitch) {
    return {
      model: requestedModel,
      upstreamChannelId: null,
      switched: false,
      estimatedInputTokens
    };
  }

  // Parse overflow model configuration
  // 解析溢出模型配置
  const overflowSelection = parseOverflowModelSelection(key.contextOverflowModel);

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
    estimatedInputTokens >= key.contextSwitchThreshold &&
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
