export type PromptMetric = {
  characters: number;
  utf8Bytes: number;
  estimatedTokens: number;
  sha256: string;
};

export type PromptBreakdownEntry = {
  category: string;
  itemCount: number;
  characters: number;
  utf8Bytes: number;
  estimatedTokens: number;
  percentage: number;
};

export type PromptDuplicateReport = {
  systemInstructions: Array<{
    sha256: string;
    count: number;
    sources: string[];
  }>;
  toolsByName: Array<{ value: string; count: number }>;
  toolsBySchema: Array<{ sha256: string; count: number; sources: string[] }>;
  history: Array<{ sha256: string; count: number; sources: string[] }>;
  toolResults: Array<{ sha256: string; count: number; sources: string[] }>;
  previousResponseWithExpandedHistory: boolean;
};

export type PromptAnalysis = {
  phase: string;
  estimate: string;
  total: PromptMetric;
  breakdown: PromptBreakdownEntry[];
  tools: PromptMetric & {
    count: number;
    definitions: Array<PromptMetric & { name: string; category: string }>;
  };
  duplicates: PromptDuplicateReport;
  items: Array<
    PromptMetric & {
      category: string;
      type: string;
      role?: string;
      name?: string;
    }
  >;
};

export type PromptToggleMeasurement = PromptMetric & {
  name: string;
  deltaFromFull: {
    characters: number;
    utf8Bytes: number;
    estimatedTokens: number;
    percentage: number;
  };
};

export const PROMPT_CATEGORIES: string[];
export function estimatePromptTokens(value: unknown): number;
export function measurePromptValue(value: unknown): PromptMetric;
export function analyzePromptPayload(
  payload: unknown,
  options?: { phase?: string },
): PromptAnalysis;
export function analyzePromptPair(
  responsesPayload: unknown,
  chatPayload: unknown,
): {
  responses: PromptAnalysis;
  chat: PromptAnalysis;
  conversionDelta: {
    characters: number;
    utf8Bytes: number;
    estimatedTokens: number;
    percentage: number;
  };
  toggles: PromptToggleMeasurement[];
};
export function buildPromptToggleMeasurements(
  payload: unknown,
): PromptToggleMeasurement[];
export function detectPromptDuplicates(payload: unknown): PromptDuplicateReport;
export function diagnosticReportContainsSensitiveValue(
  report: unknown,
  sensitiveValues: unknown[],
): boolean;
