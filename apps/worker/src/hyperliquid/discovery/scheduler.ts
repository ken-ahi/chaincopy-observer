import { errorDetails } from "@chaincopy/config";
import { type HyperliquidDiscoveryJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";
import { type Logger } from "pino";

import { enqueueCandidateQualityAudit, enqueueMarketDiscovery } from "./queue.js";
import { type HyperliquidDiscoveryRepository } from "./repository.js";
import { type HyperliquidDiscoveryWebSocketSupervisor } from "./websocket-supervisor.js";

export class HyperliquidDiscoveryScheduler {
  private activeTick: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly repository: HyperliquidDiscoveryRepository,
    private readonly queue: Queue<HyperliquidDiscoveryJobData>,
    private readonly candidateQueue: Queue<HyperliquidDiscoveryJobData>,
    private readonly supervisor: HyperliquidDiscoveryWebSocketSupervisor,
    private readonly sourceKey: string,
    private readonly intervalMs: number,
    private readonly isLeader: () => boolean,
    private readonly logger: Logger,
  ) {}

  public async start(): Promise<void> {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
    await this.tick();
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.activeTick) {
      await this.activeTick;
    }
    await this.supervisor.stop();
  }

  public async tick(): Promise<void> {
    if (this.activeTick) {
      return this.activeTick;
    }
    const tick = this.executeTick();
    this.activeTick = tick;
    try {
      await tick;
    } catch (error) {
      this.logger.error(
        { error: errorDetails(error) },
        "Hyperliquid discovery scheduler tick failed",
      );
    } finally {
      if (this.activeTick === tick) {
        this.activeTick = null;
      }
    }
  }

  private async executeTick(): Promise<void> {
    if (!this.isLeader()) {
      await this.supervisor.stop();
      return;
    }
    const settings = await this.repository.getSettings();
    if (!settings.enabled) {
      await this.supervisor.stop();
    } else {
      const requestedAt = new Date().toISOString();
      await Promise.all([
        enqueueMarketDiscovery(this.queue, requestedAt, this.sourceKey, this.intervalMs),
        enqueueCandidateQualityAudit(this.queue, requestedAt),
      ]);
    }
    const [discoveryCounts, candidateCounts] = await Promise.all([
      this.queue.getJobCounts("waiting", "active", "delayed", "prioritized"),
      this.candidateQueue.getJobCounts("waiting", "active", "delayed", "prioritized"),
    ]);
    const queueDepth = [
      ...Object.values(discoveryCounts),
      ...Object.values(candidateCounts),
    ].reduce((total, count) => total + count, 0);
    await this.repository.setQueueDepth(queueDepth);
  }
}
