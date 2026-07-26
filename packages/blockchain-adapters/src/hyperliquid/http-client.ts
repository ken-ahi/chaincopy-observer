import { parse as parseLossless } from "lossless-json";
import { type ZodType } from "zod";

import {
  HyperliquidHttpError,
  HyperliquidTimeoutError,
  HyperliquidValidationError,
  isRetryableHyperliquidError,
} from "./errors.js";
import { WeightedRateLimiter } from "./rate-limiter.js";
import {
  clearinghouseStateSchema,
  frontendOpenOrdersSchema,
  historicalOrdersSchema,
  openOrdersSchema,
  portfolioSchema,
  spotClearinghouseStateSchema,
  userFillsSchema,
  userFundingSchema,
  userNonFundingLedgerUpdatesSchema,
  userRateLimitSchema,
  type HyperliquidClearinghouseState,
  type HyperliquidFill,
  type HyperliquidFundingPayment,
  type HyperliquidHistoricalOrder,
  type HyperliquidLedgerUpdate,
  type HyperliquidOrder,
  type HyperliquidPortfolio,
  type HyperliquidSpotState,
  type HyperliquidUserRateLimit,
} from "./schemas.js";

export interface HyperliquidHttpResponse<T> {
  readonly data: T;
  readonly rawText: string;
}

export interface HyperliquidHttpClientOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly maximumAttempts?: number;
  readonly rateLimiter?: WeightedRateLimiter;
  readonly timeoutMs?: number;
}

interface RequestOptions<T> {
  readonly body: Readonly<Record<string, unknown>>;
  readonly endpointType: string;
  readonly responseSchema: ZodType<T>;
  readonly weight: number;
  readonly responseItemWeight?: boolean;
}

export class HyperliquidHttpClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly maximumAttempts: number;
  private readonly rateLimiter: WeightedRateLimiter;
  private readonly timeoutMs: number;

  public constructor(
    private readonly infoUrl: string,
    options: HyperliquidHttpClientOptions = {},
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.maximumAttempts = options.maximumAttempts ?? 3;
    this.rateLimiter = options.rateLimiter ?? new WeightedRateLimiter();
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  public userFills(user: string): Promise<HyperliquidHttpResponse<HyperliquidFill[]>> {
    return this.request({
      body: { aggregateByTime: false, type: "userFills", user },
      endpointType: "userFills",
      responseItemWeight: true,
      responseSchema: userFillsSchema,
      weight: 20,
    });
  }

  public userFillsByTime(
    user: string,
    startTime: number,
    endTime?: number,
  ): Promise<HyperliquidHttpResponse<HyperliquidFill[]>> {
    return this.request({
      body: compact({
        aggregateByTime: false,
        endTime,
        startTime,
        type: "userFillsByTime",
        user,
      }),
      endpointType: "userFillsByTime",
      responseItemWeight: true,
      responseSchema: userFillsSchema,
      weight: 20,
    });
  }

  public clearinghouseState(
    user: string,
  ): Promise<HyperliquidHttpResponse<HyperliquidClearinghouseState>> {
    return this.request({
      body: { type: "clearinghouseState", user },
      endpointType: "clearinghouseState",
      responseSchema: clearinghouseStateSchema,
      weight: 2,
    });
  }

  public spotClearinghouseState(
    user: string,
  ): Promise<HyperliquidHttpResponse<HyperliquidSpotState>> {
    return this.request({
      body: { type: "spotClearinghouseState", user },
      endpointType: "spotClearinghouseState",
      responseSchema: spotClearinghouseStateSchema,
      weight: 2,
    });
  }

  public portfolio(user: string): Promise<HyperliquidHttpResponse<HyperliquidPortfolio>> {
    return this.request({
      body: { type: "portfolio", user },
      endpointType: "portfolio",
      responseSchema: portfolioSchema,
      weight: 20,
    });
  }

  public userFunding(
    user: string,
    startTime: number,
    endTime?: number,
  ): Promise<HyperliquidHttpResponse<HyperliquidFundingPayment[]>> {
    return this.request({
      body: compact({ endTime, startTime, type: "userFunding", user }),
      endpointType: "userFunding",
      responseItemWeight: true,
      responseSchema: userFundingSchema,
      weight: 20,
    });
  }

  public userNonFundingLedgerUpdates(
    user: string,
    startTime: number,
    endTime?: number,
  ): Promise<HyperliquidHttpResponse<HyperliquidLedgerUpdate[]>> {
    return this.request({
      body: compact({ endTime, startTime, type: "userNonFundingLedgerUpdates", user }),
      endpointType: "userNonFundingLedgerUpdates",
      responseItemWeight: true,
      responseSchema: userNonFundingLedgerUpdatesSchema,
      weight: 20,
    });
  }

  public openOrders(user: string): Promise<HyperliquidHttpResponse<HyperliquidOrder[]>> {
    return this.request({
      body: { type: "openOrders", user },
      endpointType: "openOrders",
      responseSchema: openOrdersSchema,
      weight: 20,
    });
  }

  public frontendOpenOrders(user: string): Promise<HyperliquidHttpResponse<HyperliquidOrder[]>> {
    return this.request({
      body: { type: "frontendOpenOrders", user },
      endpointType: "frontendOpenOrders",
      responseSchema: frontendOpenOrdersSchema,
      weight: 20,
    });
  }

  public historicalOrders(
    user: string,
  ): Promise<HyperliquidHttpResponse<HyperliquidHistoricalOrder[]>> {
    return this.request({
      body: { type: "historicalOrders", user },
      endpointType: "historicalOrders",
      responseItemWeight: true,
      responseSchema: historicalOrdersSchema,
      weight: 20,
    });
  }

  public userRateLimit(user: string): Promise<HyperliquidHttpResponse<HyperliquidUserRateLimit>> {
    return this.request({
      body: { type: "userRateLimit", user },
      endpointType: "userRateLimit",
      responseSchema: userRateLimitSchema,
      weight: 20,
    });
  }

  private async request<T>(options: RequestOptions<T>): Promise<HyperliquidHttpResponse<T>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      await this.rateLimiter.acquire(options.weight);
      try {
        const response = await this.requestOnce(options);
        if (
          options.responseItemWeight &&
          Array.isArray(response.data) &&
          response.data.length > 0
        ) {
          await this.rateLimiter.acquire(Math.ceil(response.data.length / 20));
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt === this.maximumAttempts || !isRetryableHyperliquidError(error)) {
          throw error;
        }
        await delay(250 * 2 ** (attempt - 1));
      }
    }

    throw lastError;
  }

  private async requestOnce<T>(options: RequestOptions<T>): Promise<HyperliquidHttpResponse<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(this.infoUrl, {
        body: JSON.stringify(options.body),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });
      const rawText = await response.text();
      if (!response.ok) {
        throw new HyperliquidHttpError(
          `Hyperliquid ${options.endpointType} request failed with HTTP ${response.status}.`,
          response.status,
          rawText.slice(0, 2_000),
        );
      }

      const parsed = options.responseSchema.safeParse(parseLossless(rawText));
      if (!parsed.success) {
        throw new HyperliquidValidationError(options.endpointType, parsed.error);
      }
      return {
        data: parsed.data,
        rawText,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HyperliquidTimeoutError(this.timeoutMs, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function compact(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
