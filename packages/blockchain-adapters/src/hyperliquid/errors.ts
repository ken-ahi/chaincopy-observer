import { type ZodError } from "zod";

export class HyperliquidError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HyperliquidError";
  }
}

export class HyperliquidHttpError extends HyperliquidError {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message, "HYPERLIQUID_HTTP_ERROR");
    this.name = "HyperliquidHttpError";
  }
}

export class HyperliquidTimeoutError extends HyperliquidError {
  public constructor(timeoutMs: number, options?: ErrorOptions) {
    super(`Hyperliquid request timed out after ${timeoutMs}ms.`, "HYPERLIQUID_TIMEOUT", options);
    this.name = "HyperliquidTimeoutError";
  }
}

export class HyperliquidValidationError extends HyperliquidError {
  public constructor(
    public readonly endpointType: string,
    public readonly validationError: ZodError,
  ) {
    super(
      `Hyperliquid returned an invalid ${endpointType} response.`,
      "HYPERLIQUID_INVALID_RESPONSE",
      { cause: validationError },
    );
    this.name = "HyperliquidValidationError";
  }
}

export function isRetryableHyperliquidError(error: unknown): boolean {
  if (error instanceof HyperliquidTimeoutError) {
    return true;
  }
  if (error instanceof HyperliquidHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError;
}
