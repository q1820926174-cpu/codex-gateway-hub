import type { ResolvedGatewayKey } from "@/lib/upstream";

export function pickModelByContext(
  requestedModel: string,
  estimatedInputTokens: number,
  key: Pick<
    ResolvedGatewayKey,
    "dynamicModelSwitch" | "contextSwitchThreshold" | "contextOverflowModel"
  >
) {
  if (!key.dynamicModelSwitch) {
    return {
      model: requestedModel,
      switched: false,
      estimatedInputTokens
    };
  }

  if (
    key.contextOverflowModel &&
    estimatedInputTokens >= key.contextSwitchThreshold &&
    requestedModel !== key.contextOverflowModel
  ) {
    return {
      model: key.contextOverflowModel,
      switched: true,
      estimatedInputTokens
    };
  }

  return {
    model: requestedModel,
    switched: false,
    estimatedInputTokens
  };
}

