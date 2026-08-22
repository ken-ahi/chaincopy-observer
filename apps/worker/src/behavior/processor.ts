import { behaviorJobNames, type BehaviorJobData } from "@chaincopy/domain";
import { type Job } from "bullmq";
import { type Logger } from "pino";

import { type BehaviorNormalizationService } from "./service.js";

export class BehaviorJobProcessor {
  public constructor(
    private readonly service: BehaviorNormalizationService,
    private readonly logger: Logger,
  ) {}

  public async process(job: Job<BehaviorJobData>) {
    this.logger.info(
      { event: "behavior_normalization_started", jobId: job.id, jobName: job.name },
      "Behavior normalization started",
    );
    const result =
      job.name === behaviorJobNames.backfillSelected && job.data.kind === "control"
        ? await this.service.processControl(job.data.requestedAt)
        : job.data.kind === "wallet-coin"
          ? await this.service.processWalletCoin(job.data)
          : (() => {
              throw new Error(`Unsupported behavior job ${job.name}.`);
            })();
    this.logger.info(
      { event: "behavior_normalization_completed", jobId: job.id, result },
      "Behavior normalization completed",
    );
    return result;
  }
}
