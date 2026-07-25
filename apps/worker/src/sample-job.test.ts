import { describe, expect, it } from "vitest";

import { sampleJobId, sampleJobOptions, systemQueueName } from "./sample-job.js";

describe("sample worker job", () => {
  it("uses a stable business job id for duplicate suppression", () => {
    expect(systemQueueName).toBe("system-jobs");
    expect(sampleJobOptions.jobId).toBe(sampleJobId);
    expect(sampleJobId).toBe("phase1-sample-health-check-v1");
  });

  it("has bounded retries", () => {
    expect(sampleJobOptions.attempts).toBe(3);
    expect(sampleJobOptions.backoff).toEqual({
      delay: 1_000,
      type: "exponential",
    });
  });
});
