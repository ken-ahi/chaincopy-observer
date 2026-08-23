import type {
  EffectiveSelectedWalletDto,
  WalletSelectionService,
} from "../../../api/src/wallet-selection-service.js";

export interface EffectiveBehaviorWallet {
  readonly performanceRunId: string | null;
  readonly selectionRunId: string;
  readonly evaluatedAt: Date;
  readonly walletAddressId: string;
}

export interface BehaviorSelectionSource {
  listEffectiveSelectedWallets(): Promise<readonly EffectiveBehaviorWallet[]>;
}

type EffectiveSelectionContract = Pick<
  WalletSelectionService,
  "getCurrentSelection" | "listEffectiveSelectedWallets"
>;

/** Phase 5 adapter: delegates membership exclusively to the Phase 4.3 Selection SSoT. */
export class WalletSelectionBehaviorSource implements BehaviorSelectionSource {
  public constructor(private readonly selectionService: EffectiveSelectionContract) {}

  public async listEffectiveSelectedWallets(): Promise<readonly EffectiveBehaviorWallet[]> {
    const [wallets, current] = await Promise.all([
      this.selectionService.listEffectiveSelectedWallets(),
      this.selectionService.getCurrentSelection(),
    ]);
    if (wallets.length === 0) return [];
    if (!current.run) {
      throw new Error("Selection SSoT returned selected wallets without a current Selection Run.");
    }
    return wallets.map((wallet) =>
      this.toBehaviorWallet(wallet, current.run!.id, current.run!.evaluatedAt),
    );
  }

  private toBehaviorWallet(
    wallet: EffectiveSelectedWalletDto,
    currentSelectionRunId: string,
    evaluatedAt: string,
  ): EffectiveBehaviorWallet {
    if (wallet.selectionRunId !== currentSelectionRunId) {
      throw new Error("Selection SSoT returned a wallet outside the current Selection Run.");
    }
    const parsedEvaluatedAt = new Date(evaluatedAt);
    if (!Number.isFinite(parsedEvaluatedAt.getTime())) {
      throw new RangeError("Selection SSoT returned an invalid evaluatedAt timestamp.");
    }
    return {
      evaluatedAt: parsedEvaluatedAt,
      performanceRunId: wallet.performanceRunId,
      selectionRunId: wallet.selectionRunId,
      walletAddressId: wallet.walletAddressId,
    };
  }
}
