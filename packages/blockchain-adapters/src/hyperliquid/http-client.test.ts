import { describe, expect, it, vi } from "vitest";

import { HyperliquidClient } from "./client.js";
import { HyperliquidHttpClient } from "./http-client.js";
import { HyperliquidHttpError, HyperliquidValidationError } from "./errors.js";

const address = "0x1111111111111111111111111111111111111111";

describe("HyperliquidHttpClient", () => {
  it("retries a retryable response with bounded attempts", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const client = new HyperliquidHttpClient("https://example.test/info", {
      fetchImplementation,
      maximumAttempts: 2,
      timeoutMs: 1_000,
    });

    await expect(client.userFills(address)).resolves.toMatchObject({ data: [] });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("does not retry schema validation failures", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"unexpected":true}', { status: 200 }));
    const client = new HyperliquidHttpClient("https://example.test/info", {
      fetchImplementation,
      maximumAttempts: 3,
    });

    await expect(client.userFills(address)).rejects.toBeInstanceOf(HyperliquidValidationError);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("does not retry non-retryable 4xx responses", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    const client = new HyperliquidHttpClient("https://example.test/info", {
      fetchImplementation,
      maximumAttempts: 3,
    });

    await expect(client.userFills(address)).rejects.toBeInstanceOf(HyperliquidHttpError);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});

describe("Hyperliquid history pagination", () => {
  it("paginates funding by the last timestamp and removes duplicates", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      delta: {
        coin: "BTC",
        fundingRate: "0.0001",
        szi: "1",
        type: "funding",
        usdc: "0.1",
      },
      hash: `hash-${index}`,
      time: index + 1,
    }));
    const secondPage = [
      firstPage.at(-1),
      {
        delta: {
          coin: "ETH",
          fundingRate: "0.0002",
          szi: "2",
          type: "funding",
          usdc: "0.2",
        },
        hash: "hash-final",
        time: 501,
      },
    ];
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstPage), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(secondPage), { status: 200 }));
    const client = new HyperliquidClient("https://example.test/info", {
      fetchImplementation,
    });

    const result = await client.allUserFunding(address, 0, 1_000);

    expect(result.items).toHaveLength(501);
    expect(result.items.at(-1)?.time).toBe(501);
    expect(result.pages).toHaveLength(2);
    const secondBody = JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body)) as {
      startTime: number;
    };
    expect(secondBody.startTime).toBe(500);
  });
});
