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

const maximumHistoryItems = 10_000;

export interface HyperliquidPaginatedResponse<T> {
  readonly coverage: HyperliquidCoverageEvidence;
  readonly items: ReadonlyArray<T>;
  readonly pages: ReadonlyArray<string>;
  readonly reachedHistoryLimit: boolean;
}

export interface HyperliquidCoverageEvidence {
  readonly evidence: "BOUNDED_NON_EMPTY_EXHAUSTIVE_RESPONSE" | "UNPROVEN";
  readonly proven: boolean;
  readonly requestedFrom: number;
  readonly requestedTo: number;
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
    let retrievedItemCount = 0;
    let exhaustedRequestedRange = false;

    while (cursor <= endTime && items.size < 10_000) {
      const response = await this.userFillsByTime(user, cursor, endTime);
      pages.push(response.rawText);
      retrievedItemCount += response.data.length;
      if (response.data.length === 0) {
        exhaustedRequestedRange = true;
        break;
      }

      for (const fill of response.data) {
        items.set(fillKey(fill), fill);
      }
      if (retrievedItemCount >= 10_000) {
        reachedHistoryLimit = true;
        break;
      }
      const lastTimestamp = Math.max(...response.data.map((fill) => fill.time));
      if (lastTimestamp < cursor) {
        reachedHistoryLimit = true;
        break;
      }
      if (response.data.length < 2_000) {
        exhaustedRequestedRange = true;
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
      coverage: coverageEvidence(
        startTime,
        endTime,
        items.size,
        exhaustedRequestedRange,
        reachedHistoryLimit,
      ),
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
  let retrievedItemCount = 0;
  let exhaustedRequestedRange = false;

  while (cursor <= endTime && retrievedItemCount < maximumHistoryItems) {
    const response = await request(cursor);
    pages.push(response.rawText);
    retrievedItemCount += response.data.length;
    if (response.data.length === 0) {
      exhaustedRequestedRange = true;
      break;
    }
    for (const item of response.data) {
      items.set(key(item), item);
    }
    if (retrievedItemCount >= maximumHistoryItems) {
      reachedHistoryLimit = true;
      break;
    }
    const lastTimestamp = Math.max(...response.data.map((item) => item.time));
    if (lastTimestamp < cursor) {
      reachedHistoryLimit = true;
      break;
    }
    if (response.data.length < 500) {
      exhaustedRequestedRange = true;
      break;
    }
    if (lastTimestamp === cursor) {
      reachedHistoryLimit = true;
      break;
    }
    cursor = lastTimestamp;
  }

  return {
    coverage: coverageEvidence(
      startTime,
      endTime,
      items.size,
      exhaustedRequestedRange,
      reachedHistoryLimit,
    ),
    items: [...items.values()].sort((left, right) => left.time - right.time),
    pages,
    reachedHistoryLimit,
  };
}

function coverageEvidence(
  requestedFrom: number,
  requestedTo: number,
  itemCount: number,
  exhaustedRequestedRange: boolean,
  reachedHistoryLimit: boolean,
): HyperliquidCoverageEvidence {
  const proven = itemCount > 0 && exhaustedRequestedRange && !reachedHistoryLimit;
  return {
    evidence: proven ? "BOUNDED_NON_EMPTY_EXHAUSTIVE_RESPONSE" : "UNPROVEN",
    proven,
    requestedFrom,
    requestedTo,
  };
}

function fillKey(fill: HyperliquidFill): string {
  return `${fill.time}:${fill.coin}:${fill.tid}`;
}
