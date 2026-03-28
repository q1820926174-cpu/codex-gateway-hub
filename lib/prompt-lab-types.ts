export type PromptLabRunMode = "cli" | "import";
export type PromptLabRunStatus = "queued" | "running" | "succeeded" | "failed";
export type PromptLabRunPhaseStatus = "pending" | "running" | "succeeded" | "failed";
export type PromptLabHintSource = "default" | "rule" | "exempt";

export type PromptLabScoreBreakdown = {
  providerRank: -1 | 0 | 1 | 2;
  upstreamRank: -1 | 0 | 1 | 2;
  hasProvider: boolean;
  hasUpstream: boolean;
  score: number;
};

export type RulePreviewResult = {
  matchedRuleId: string | null;
  matchedRuleIndex: number | null;
  matchedExemption: string | null;
  matchedExemptionIndex: number | null;
  scoreBreakdown: PromptLabScoreBreakdown | null;
  hintSource: PromptLabHintSource;
  hintPreview: string;
};

export type PromptOptimizerFocus = "balanced" | "tool-calling" | "strict";

export type PromptOptimizerResult = {
  profile: {
    provider: string;
    upstreamModel: string;
    clientModel: string;
    family: string;
    focus: PromptOptimizerFocus;
    preserveOriginal: boolean;
  };
  issueTags: string[];
  metrics: {
    estimatedTokens: number;
    sourceFailureCount: number;
  };
  optimizedPrompt: string;
  suggestedRule: {
    id: string;
    provider: string;
    upstreamModelPattern: string;
    hint: string;
  };
};

export type PromptLabRunRequest = {
  mode: PromptLabRunMode;
  baselineModel: string;
  candidateModels: string[];
  suiteId: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  reportJson?: unknown;
};

export type PromptLabMetricSummary = {
  toolSchemaAccuracy: number;
  validToolCallRate: number;
  taskCompletionRate: number;
  fakePatchLeakRate: number;
  retryRecoveryRate: number;
  sampleSize: number;
  pass: boolean;
};

export type PromptLabModelMetrics = {
  model: string;
  exitCode: number;
  toolSchemaAccuracy: number;
  validToolCallRate: number;
  taskCompletionRate: number;
  fakePatchLeakRate: number;
  retryRecoveryRate: number;
  schemaErrorCount: number;
  toolCallCount: number;
  retryCount: number;
  probeDeleted: boolean;
  leakedPatchText: boolean;
  finalMessage: string;
};

export type PromptLabFailureCase = {
  model: string;
  title: string;
  reason: string;
  impact: string;
  suggestion: string;
  suggestedHint: string;
};

export type PromptLabNormalizedReport = {
  runId: string;
  mode: PromptLabRunMode;
  createdAt: string;
  baselineModel: string;
  candidateModels: string[];
  suiteId: string;
  sandbox: string;
  source: "codex-benchmark" | "imported";
  metrics: PromptLabMetricSummary;
  perModel: PromptLabModelMetrics[];
  failures: PromptLabFailureCase[];
  raw: unknown;
};

export type PromptLabRunPhase = {
  prepare: PromptLabRunPhaseStatus;
  execute: PromptLabRunPhaseStatus;
  analyze: PromptLabRunPhaseStatus;
};

export type PromptLabRun = {
  id: string;
  status: PromptLabRunStatus;
  mode: PromptLabRunMode;
  createdAt: string;
  updatedAt: string;
  baselineModel: string;
  candidateModels: string[];
  suiteId: string;
  sandbox: string;
  phase: PromptLabRunPhase;
  error: string | null;
  metrics: PromptLabMetricSummary | null;
};

export type PromptLabRunWithReport = PromptLabRun & {
  report: PromptLabNormalizedReport | null;
};
