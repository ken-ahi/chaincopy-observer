import { normalizeHyperliquidAddress } from "./address.js";
import {
  HyperliquidHttpClient,
  type HyperliquidHttpClientOptions,
  type HyperliquidHttpResponse,
} from "./http-client.js";
import {
  type HyperliquidFill,
  type HyperliquidFundingPayment,
  type HyperliquidLedgerUpdate,
} from "./schemas.js";

export interface HyperliquidPaginatedResponse<T> {
  readonly items: ReadonlyArray<T>;
  readonly pages: ReadonlyArray<string>;
  readonly reachedHistoryLimit: boolean;
}

export class HyperliquidClient extends HyperliquidHttpClient {
  public constructor(infoUrl: string, options: HyperliquidHttpClientOptions = {}) {
    super(infoUrl, options);
  }

  public async allUserFillsByTime(
    userInput: string,
    startTime: number,
    endTime = Date.now(),
  ): Promise<HyperliquidPaginatedResponse<HyperliquidFill>> {
    const user = normalizeHyperliquidAddress(userInput);
    const items = new Map<string, HyperliquidFill>();
    const pages: string[] = [];
    let cursor = startTime;
    let reachedHistoryLimit = false;

    while (cursor <= endTime && items.size < 10_000) {
      const response = await this.userFillsByTime(user, cursor, endTime);
      pages.push(response.rawText);
      if (response.data.length === 0) {
        break;
      }

      for (const fill of response.data) {
        items.set(fillKey(fill), fill);
      }
      const lastTimestamp = Math.max(...response.data.map((fill) => fill.time));
      if (lastTimestamp < cursor) {
        break;
      }
      if (response.data.length < 2_000) {
        break;
      }
      if (lastTimestamp === cursor) {
        reachedHistoryLimit = true;
        break;
      }
      cursor = lastTimestamp;
    }

    if (items.size >= 10_000) {
      reachedHistoryLimit = true;
    }

    return {
      items: [...items.values()].sort((left, right) => left.time - right.time),
      pages,
      reachedHistoryLimit,
    };
  }

  public async allUserFunding(
    userInput: string,
    startTime: number,
    endTime = Date.now(),
  ): Promise<HyperliquidPaginatedResponse<HyperliquidFundingPayment>> {
    const user = normalizeHyperliquidAddress(userInput);
    return paginateByTime(
      (cursor) => this.userFunding(user, cursor, endTime),
      (item) => `${item.hash}:${item.time}:${item.delta.coin}`,
      startTime,
      endTime,
    );
  }

  public async allUserLedgerUpdates(
    userInput: string,
    startTime: number,
    endTime = Date.now(),
  ): Promise<HyperliquidPaginatedResponse<HyperliquidLedgerUpdate>> {
    const user = normalizeHyperliquidAddress(userInput);
    return paginateByTime(
      (cursor) => this.userNonFundingLedgerUpdates(user, cursor, endTime),
      (item) => `${item.hash}:${item.time}:${item.delta.type}`,
      startTime,
      endTime,
    );
  }
}

async function paginateByTime<T extends { readonly time: number }>(
  request: (cursor: number) => Promise<HyperliquidHttpResponse<T[]>>,
  key: (item: T) => string,
  startTime: number,
  endTime: number,
): Promise<HyperliquidPaginatedResponse<T>> {
  const items = new Map<string, T>();
  const pages: string[] = [];
  let cursor = startTime;
  let reachedHistoryLimit = false;

  while (cursor <= endTime) {
    const response = await request(cursor);
    pages.push(response.rawText);
    if (response.data.length === 0) {
      break;
    }
    for (const item of response.data) {
      items.set(key(item), item);
    }
    const lastTimestamp = Math.max(...response.data.map((item) => item.time));
    if (lastTimestamp < cursor || response.data.length < 500) {
      break;
    }
    if (lastTimestamp === cursor) {
      reachedHistoryLimit = true;
      break;
    }
    cursor = lastTimestamp;
  }

  return {
    items: [...items.values()].sort((left, right) => left.time - right.time),
    pages,
    reachedHistoryLimit,
  };
}

function fillKey(fill: HyperliquidFill): string {
  return `${fill.time}:${fill.coin}:${fill.tid}`;
}
