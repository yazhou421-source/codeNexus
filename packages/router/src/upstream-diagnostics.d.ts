export type UpstreamDiagnostic = {
  request?: Record<string, number | boolean>;
  timestamp: string;
  requestId: string | null;
  route: string | null;
  status: number;
  code: string | null;
  type: string | null;
  param: string | null;
  message: string;
  messageHash: string;
};
export function upstreamDiagnostic(
  requestId: string,
  route: { id: string },
  error: unknown,
  secrets?: string[],
): UpstreamDiagnostic | null;
