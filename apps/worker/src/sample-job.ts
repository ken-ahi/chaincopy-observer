import { systemJobNames } from "@chaincopy/domain";
import { type JobsOptions, type Queue } from "bullmq";

export const systemQueueName = "system-jobs";
export const sampleJobId = "phase1-sample-health-check-v1";

export interface SampleHealthJobData {
  readonly enqueuedAt: string;
  readonly schemaVersion: 1;
}

export const sampleJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    delay: 1_000,
    type: "exponential",
  },
  jobId: sampleJobId,
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 100,
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 500,
  },
};

export async function enqueueSampleHealthJob(
  queue: Queue<SampleHealthJobData>,
): Promise<string | undefined> {
  const job = await queue.add(
    systemJobNames.sampleHealthCheck,
    {
      enqueuedAt: new Date().toISOString(),
      schemaVersion: 1,
    },
    sampleJobOptions,
  );

  return job.id;
}
