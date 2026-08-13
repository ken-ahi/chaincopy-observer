import { randomUUID } from "node:crypto";

import { errorDetails } from "@chaincopy/config";
import {
  hyperliquidJobNames,
  type HyperliquidJobData,
  type HyperliquidJobName,
} from "@chaincopy/domain";
import { type PrismaClient } from "@chaincopy/database";
import { type Queue } from "bullmq";
import { type Redis } from "ioredis";
import { type Logger } from "pino";

import { enqueueHyperliquidJob, hasPendingHyperliquidJob } from "./queue.js";

const releaseLeaseScript =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const renewLeaseScript =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export interface HyperliquidScheduleConfig {
  readonly accountMs: number;
  readonly auditMs: number;
  readonly backlogLimit: number;
  readonly fillMs: number;
  readonly orderHistoryMs: number;
  readonly portfolioMs: number;
}

interface SchedulerWebSocketSupervisor {
  reconcile(
    wallets: ReadonlyArray<{ readonly address: string; readonly id: string }>,
  ): Promise<void>;
  stop(): Promise<void>;
}

export class HyperliquidScheduler {
  private activeTick: Promise<void> | null = null;
  private readonly leaseDurationMs: number;
  private leaseRenewalTimer: NodeJS.Timeout | null = null;
  private readonly lockKey: string;
  private readonly lockToken = randomUUID();
  private leader = false;
  private relinquishing = false;
  private running = false;
  private scheduleTimer: NodeJS.Timeout | null = null;
  private started = false;

  public constructor(
    private readonly database: PrismaClient,
    private readonly redis: Redis,
    private readonly queue: Queue<HyperliquidJobData>,
    private readonly websocketSupervisor: SchedulerWebSocketSupervisor,
    private readonly sourceKey: string,
    private readonly intervalMs: number,
    private readonly schedule: HyperliquidScheduleConfig,
    private readonly logger: Logger,
  ) {
    this.leaseDurationMs = Math.max(30_000, intervalMs * 3);
    this.lockKey = `hyperliquid:scheduler:${sourceKey}`;
  }

  public async start(): Promise<void> {
    if (this.started) {
      this.logger.warn({ lockKey: this.lockKey }, "Ignored duplicate Hyperliquid scheduler start");
      return;
    }

    this.started = true;
    this.scheduleTimer = setInterval(() => {
      void this.runScheduleCycle();
    }, this.intervalMs);
    this.scheduleTimer.unref();
    this.leaseRenewalTimer = setInterval(
      () => {
        void this.renewLeadership();
      },
      Math.max(1_000, Math.floor(this.leaseDurationMs / 3)),
    );
    this.leaseRenewalTimer.unref();

    await this.runScheduleCycle();
  }

  public async stop(): Promise<void> {
    this.started = false;
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    if (this.leaseRenewalTimer) {
      clearInterval(this.leaseRenewalTimer);
      this.leaseRenewalTimer = null;
    }
    if (this.activeTick) {
      await this.activeTick;
    }
    await this.releaseLeadership();
    await this.websocketSupervisor.stop();
  }

  public hasLeadership(): boolean {
    return this.started && this.leader;
  }

  public async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    const tick = this.executeTick();
    this.activeTick = tick;
    try {
      await tick;
    } catch (error) {
      this.logger.error(
        { error: errorDetails(error), lockKey: this.lockKey },
        "Hyperliquid scheduler tick failed",
      );
    } finally {
      if (this.activeTick === tick) {
        this.activeTick = null;
      }
      this.running = false;
    }
  }

  private async executeTick(): Promise<void> {
    const wallets = await this.database.walletAddress.findMany({
      orderBy: { createdAt: "asc" },
      select: { address: true, id: true },
      where: {
        isWatched: true,
        source: { key: this.sourceKey },
      },
    });
    await this.websocketSupervisor.reconcile(wallets);
    const counts = await this.queue.getJobCounts("active", "waiting", "delayed", "prioritized");
    const backlog = Object.values(counts).reduce((total, count) => total + count, 0);
    if (backlog >= this.schedule.backlogLimit) {
      this.logger.warn(
        { backlog, backlogLimit: this.schedule.backlogLimit, sourceKey: this.sourceKey },
        "Hyperliquid scheduler suppressed enqueue because of queue backlog",
      );
      return;
    }
    const now = new Date().toISOString();
    const periodicJobs: ReadonlyArray<readonly [HyperliquidJobName, number]> = [
      [hyperliquidJobNames.fillSync, this.schedule.fillMs],
      [hyperliquidJobNames.fundingSync, this.schedule.accountMs],
      [hyperliquidJobNames.ledgerSync, this.schedule.accountMs],
      [hyperliquidJobNames.currentStateSnapshot, this.schedule.accountMs],
      [hyperliquidJobNames.portfolioSnapshot, this.schedule.portfolioMs],
      [hyperliquidJobNames.historicalOrdersSync, this.schedule.orderHistoryMs],
      [hyperliquidJobNames.dataQualityAudit, this.schedule.auditMs],
    ];
    const jobIds: string[] = [];
    for (const wallet of wallets) {
      for (const [jobName, bucketMs] of periodicJobs) {
        if (await hasPendingHyperliquidJob(this.queue, jobName, wallet.id)) {
          continue;
        }
        jobIds.push(
          await enqueueHyperliquidJob(
            this.queue,
            jobName,
            {
              requestedAt: now,
              walletAddress: wallet.address,
              walletAddressId: wallet.id,
            },
            bucketMs,
          ),
        );
      }
    }
    this.logger.info(
      {
        jobCount: jobIds.length,
        sourceKey: this.sourceKey,
        walletCount: wallets.length,
      },
      "Hyperliquid scheduler tick completed",
    );
  }

  private async runScheduleCycle(): Promise<void> {
    if (!this.started) {
      return;
    }
    try {
      if (!(await this.ensureLeadership())) {
        return;
      }
      await this.tick();
    } catch (error) {
      this.logger.error(
        { error: errorDetails(error), lockKey: this.lockKey },
        "Hyperliquid scheduler cycle failed",
      );
    }
  }

  private async ensureLeadership(): Promise<boolean> {
    if (this.leader) {
      return true;
    }
    if (this.relinquishing) {
      return false;
    }
    const acquired = await this.redis.set(
      this.lockKey,
      this.lockToken,
      "PX",
      this.leaseDurationMs,
      "NX",
    );
    if (acquired !== "OK") {
      return false;
    }
    this.leader = true;
    this.logger.info(
      { leaseDurationMs: this.leaseDurationMs, lockKey: this.lockKey },
      "Hyperliquid scheduler leadership acquired",
    );
    return true;
  }

  private async renewLeadership(): Promise<void> {
    if (!this.started || !this.leader) {
      return;
    }
    try {
      const renewed = await this.redis.eval(
        renewLeaseScript,
        1,
        this.lockKey,
        this.lockToken,
        String(this.leaseDurationMs),
      );
      if (renewed !== 1) {
        await this.handleLeadershipLoss("lease ownership changed");
      }
    } catch (error) {
      this.logger.error(
        { error: errorDetails(error), lockKey: this.lockKey },
        "Hyperliquid scheduler lease renewal failed",
      );
      await this.handleLeadershipLoss("lease renewal failed");
    }
  }

  private async handleLeadershipLoss(reason: string): Promise<void> {
    if (!this.leader) {
      return;
    }
    this.relinquishing = true;
    this.leader = false;
    try {
      if (this.activeTick) {
        await this.activeTick;
      }
      await this.websocketSupervisor.stop();
      this.logger.warn({ lockKey: this.lockKey, reason }, "Hyperliquid scheduler leadership lost");
    } finally {
      this.relinquishing = false;
    }
  }

  private async releaseLeadership(): Promise<void> {
    if (!this.leader) {
      return;
    }
    this.leader = false;
    try {
      await this.redis.eval(releaseLeaseScript, 1, this.lockKey, this.lockToken);
      this.logger.info({ lockKey: this.lockKey }, "Hyperliquid scheduler leadership released");
    } catch (error) {
      this.logger.warn(
        { error: errorDetails(error), lockKey: this.lockKey },
        "Hyperliquid scheduler lease release failed; waiting for expiry",
      );
    }
  }
}
