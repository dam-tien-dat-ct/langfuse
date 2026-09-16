import {
  logger,
  recordGauge,
  recordIncrement,
  redis,
} from "@langfuse/shared/src/server";
import { env } from "../../env";

const BACKPRESSURE_PREFIX = "langfuse:queue-backpressure";

function pauseKey(projectId: string): string {
  return `${BACKPRESSURE_PREFIX}:paused:${projectId}`;
}

function depthKey(projectId: string): string {
  return `${BACKPRESSURE_PREFIX}:depth:${projectId}`;
}

/**
 * Record one more queued job for a project and pause the project when its
 * depth crosses the threshold.
 */
export async function recordQueuedJob(projectId: string): Promise<void> {
  if (!redis) return;

  try {
    const depth = await redis.incr(depthKey(projectId));

    // Sliding window: the depth key expires so a project resumes once its
    // inflow stops instead of staying paused forever.
    await redis.expire(
      depthKey(projectId),
      env.LANGFUSE_QUEUE_PAUSE_WINDOW_SECONDS,
    );

    recordGauge("langfuse.queue_backpressure.depth", depth, {
      projectId,
    });

    if (depth > env.LANGFUSE_QUEUE_PAUSE_THRESHOLD) {
      await redis.set(
        pauseKey(projectId),
        "1",
        "EX",
        env.LANGFUSE_QUEUE_PAUSE_WINDOW_SECONDS,
      );
      recordIncrement("langfuse.queue_backpressure.paused", 1);
      logger.warn("Paused project for queue backpressure", {
        projectId,
        depth,
      });
    }
  } catch (error) {
    logger.error("Failed to record queued job", { projectId, error });
  }
}

/**
 * True when the project is paused. Fails open so a Redis outage does not stop
 * ingestion for every project at once.
 */
export async function isProjectPaused(projectId: string): Promise<boolean> {
  if (!redis) return false;

  try {
    const flag = await redis.get(pauseKey(projectId));
    return flag === "1";
  } catch (error) {
    logger.error("Failed to read backpressure flag", { projectId, error });
    return false;
  }
}

/**
 * Every project currently paused, for the operator dashboard.
 */
export async function listPausedProjects(): Promise<string[]> {
  if (!redis) return [];

  try {
    // Incremental SCAN instead of KEYS: KEYS blocks the Redis event loop over
    // the whole keyspace, which stalls ingestion and queue traffic.
    const stream = redis.scanStream({
      match: `${BACKPRESSURE_PREFIX}:paused:*`,
      count: 100,
    });

    const keys: string[] = [];
    for await (const batch of stream) {
      keys.push(...batch);
    }

    return keys.map((key) => key.split(":").pop() as string);
  } catch (error) {
    logger.error("Failed to list paused projects", { error });
    return [];
  }
}

/**
 * Clear the depth counter after a queue drains.
 */
export async function clearQueueDepth(projectId: string): Promise<void> {
  if (!redis) return;

  await redis.del(depthKey(projectId));
}
