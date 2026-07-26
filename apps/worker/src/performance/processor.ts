import { errorDetails } from "@chaincopy/config";
import {
  performanceJobNames,
  type PerformanceJobData,
  type PerformanceJobName,
} from "@chaincopy/domain";
import { type Job } from "bullmq";
import { type Logger } from "pino";

import type { PerformanceCalculationService } from "./service.js";
import type { PerformanceProcessResult } from "./types.js";

const supportedJobNames = new Set<string>(Object.values(performanceJobNames));

export class PerformanceJobProcessor {
  public constructor(
    private readonly service: PerformanceCalculationService,
    private readonly logger: Logger,
  ) {}

  public async process(job: Job<PerformanceJobData>): Promise<PerformanceProcessResult> {
    if (!supportedJobNames.has(job.name)) {
      throw new Error(`Unsupported performance job: ${job.name}`);
    }
    const jobName = job.name as PerformanceJobName;
    this.logger.info(
      {
        attempt: job.attemptsMade + 1,
        calculationFrom: job.data.calculationFrom,
        calculationTo: job.data.calculationTo,
        calculationVersion: job.data.calculationVersion,
        event: "address_performance_calculation_started",
        force: job.data.force,
        jobId: job.id,
        jobName,
        walletAddressId: job.data.walletAddressId,
      },
      "Address performance calculation started",
    );

    try {
      const result = await this.service.process(job.data);
      this.logger.info(
        {
          event: "address_performance_calculation_completed",
          jobId: job.id,
          jobName,
          result,
          walletAddressId: job.data.walletAddressId,
        },
        "Address performance calculation completed",
      );
      return result;
    } catch (error) {
      this.logger.error(
        {
          error: errorDetails(error),
          event: "address_performance_calculation_failed",
          jobId: job.id,
          jobName,
          walletAddressId: job.data.walletAddressId,
        },
        "Address performance calculation failed",
      );
      throw error;
    }
  }
}
