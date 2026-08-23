import { describe, expect, it, vi } from "vitest";

import type { WalletSelectionService } from "../../../api/src/wallet-selection-service.js";
import { WalletSelectionBehaviorSource } from "./selection-source.js";

describe("WalletSelectionBehaviorSource", () => {
  it("delegates effective membership to the Phase 4.3 Selection SSoT", async () => {
    const listEffectiveSelectedWallets = vi.fn().mockResolvedValue([
      {
        address: "0xabc",
        automaticStatus: "EXCLUDED",
        manualOverride: "INCLUDE",
        performanceRunId: "performance-1",
        selectionRunId: "selection-1",
        walletAddressId: "wallet-1",
      },
    ]);
    const getCurrentSelection = vi.fn().mockResolvedValue({
      items: [],
      run: {
        evaluatedAt: "2026-08-23T00:00:00.000Z",
        excludedCount: 0,
        id: "selection-1",
        inputFingerprint: "input",
        policyVersion: "wallet-selection-v1",
        qualifiedCount: 1,
        reviewCount: 0,
        selectedCount: 1,
        universeCount: 1,
      },
    });
    const selectionService = {
      getCurrentSelection,
      listEffectiveSelectedWallets,
    } as unknown as WalletSelectionService;

    await expect(
      new WalletSelectionBehaviorSource(selectionService).listEffectiveSelectedWallets(),
    ).resolves.toEqual([
      {
        evaluatedAt: new Date("2026-08-23T00:00:00.000Z"),
        performanceRunId: "performance-1",
        selectionRunId: "selection-1",
        walletAddressId: "wallet-1",
      },
    ]);
    expect(listEffectiveSelectedWallets).toHaveBeenCalledOnce();
    expect(getCurrentSelection).toHaveBeenCalledOnce();
  });

  it("preserves current Selection Run missing as a normal no-op", async () => {
    const selectionService = {
      getCurrentSelection: vi.fn().mockResolvedValue({ items: [], run: null }),
      listEffectiveSelectedWallets: vi.fn().mockResolvedValue([]),
    } as unknown as WalletSelectionService;
    await expect(
      new WalletSelectionBehaviorSource(selectionService).listEffectiveSelectedWallets(),
    ).resolves.toEqual([]);
  });
});
