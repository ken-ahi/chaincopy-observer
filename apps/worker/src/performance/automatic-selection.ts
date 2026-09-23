import type {
  WalletSelectionEvaluationDto,
  WalletSelectionService,
} from "../../../api/src/wallet-selection-service.js";
import type { BehaviorJobData } from "@chaincopy/domain";
import type { Queue } from "bullmq";

import { enqueueBehaviorJob } from "../behavior/queue.js";
import type { PerformanceProcessResult } from "./types.js";

export interface AutomaticSelectionResult {
  readonly behaviorJobId: string | null;
  readonly selection: WalletSelectionEvaluationDto | null;
}

export class AutomaticSelectionCoordinator {
  public constructor(
    private readonly selectionService: Pick<WalletSelectionService, "evaluate">,
    private readonly behaviorQueue: Queue<BehaviorJobData>,
  ) {}

  public async afterPerformance(
    performance: PerformanceProcessResult,
  ): Promise<AutomaticSelectionResult> {
    if (performance.status !== "SUCCEEDED") {
      return { behaviorJobId: null, selection: null };
    }
    const selection = await this.selectionService.evaluate();
    if (!selection.run) {
      throw new Error("Automatic Selection did not produce a current Selection Run.");
    }
    const behaviorJobId = await enqueueBehaviorJob(this.behaviorQueue, {
      kind: "control",
      requestedAt: selection.run.evaluatedAt,
    });
    if (!behaviorJobId) {
      throw new Error("Behavior enqueue was suppressed by the queue backlog limit.");
    }
    return { behaviorJobId, selection };
  }
}
