export const ProductErrorCode: Readonly<Record<string, string>>;
export class ProductError extends Error {
  code: string;
  statusCode: number;
  providerId: string;
  cause?: unknown;
  constructor(
    code: string,
    options?: { statusCode?: number; providerId?: string; cause?: unknown },
  );
}
export function productErrorFromUpstream(
  error: unknown,
  route?: Record<string, unknown>,
): ProductError;
export function safeProductError(
  error: unknown,
  route?: Record<string, unknown>,
): {
  code: string;
  message: string;
  statusCode: number;
  providerId?: string;
};
