import { redis } from "@langfuse/shared/src/server";
import { logger } from "@langfuse/shared/src/server";
import { recordGauge, recordIncrement } from "@langfuse/shared/src/server";

const BACKPRESSURE_PREFIX = "langfuse:queue-backpressure";

// Threshold of queued jobs above which a project is paused for one window.
const PAUSE_THRESHOLD = parseInt(process.env.LANGFUSE_QUEUE_PAUSE_THRESHOLD ?? "500");

// Window length in seconds a paused project stays paused.
const PAUSE_WINDOW_SECONDS = Number(process.env.LANGFUSE_QUEUE_PAUSE_WINDOW_SECONDS ?? "300");

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
    const current = await redis.get(depthKey(projectId));
    const depth = current ? Number(current) : 0;
    await redis.set(depthKey(projectId), String(depth + 1));

    recordGauge("langfuse.queue_backpressure.depth", depth + 1, {
      projectId,
    });

    if (depth + 1 > PAUSE_THRESHOLD) {
      await redis.set(pauseKey(projectId), "1", "EX", PAUSE_WINDOW_SECONDS);
      recordIncrement("langfuse.queue_backpressure.paused", 1);
      logger.warn("Paused project for queue backpressure", {
        projectId,
        depth: depth + 1,
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
    const keys: string[] = [];
    const stream = redis.scanStream({
      match: `${BACKPRESSURE_PREFIX}:paused:*`,
    });
    for await (const batch of stream) {
      keys.push(...(batch as string[]));
    }
    return keys.map((key) => key.split(":").pop() as string);
  } catch (error) {
    logger.error("Failed to list paused projects", { error });
    return [];
  }
}

// Decrement the depth key and floor it at 0 in one atomic step. A separate
// DECR then SET would let a concurrent recordQueuedJob increment land between
// the two commands, and the SET would then discard that enqueue.
const DECREMENT_AND_FLOOR = `
  local depth = redis.call('DECR', KEYS[1])
  if depth < 0 then
    redis.call('SET', KEYS[1], '0')
    return 0
  end
  return depth
`;

/**
 * Record one finished job for a project. This is the counterpart of
 * `recordQueuedJob`, so the depth key tracks the live queue depth instead of a
 * lifetime enqueue count. The counter floors at 0, because a decrement can
 * arrive after `clearQueueDepth` already removed the key.
 */
export async function recordProcessedJob(projectId: string): Promise<void> {
  if (!redis) return;

  try {
    await redis.eval(DECREMENT_AND_FLOOR, 1, depthKey(projectId));
  } catch (error) {
    logger.error("Failed to record processed job", { projectId, error });
  }
}

/**
 * Clear the depth counter after a queue drains.
 */
export async function clearQueueDepth(projectId: string): Promise<void> {
  if (!redis) return;

  try {
    await redis.del(depthKey(projectId));
  } catch (error) {
    logger.error("Failed to clear queue depth", { projectId, error });
  }
}
