import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  clearQueueDepth,
  isProjectPaused,
  recordQueuedJob,
} from "./backpressureGuard";

const store = new Map<string, string>();

vi.mock("@langfuse/shared/src/server", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(next));
      return next;
    }),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    expire: vi.fn(async () => 1),
    keys: vi.fn(async () => []),
    scanStream: vi.fn(() => {
      async function* generator() {
        yield [];
      }
      return generator();
    }),
  },
  logger: { warn: vi.fn(), error: vi.fn() },
  recordGauge: vi.fn(),
  recordIncrement: vi.fn(),
}));

vi.mock("../../env", () => ({
  env: {
    LANGFUSE_QUEUE_PAUSE_THRESHOLD: 2,
    LANGFUSE_QUEUE_PAUSE_WINDOW_SECONDS: 300,
  },
}));

const { redis, logger } = await import("@langfuse/shared/src/server");

describe("backpressureGuard", () => {
  beforeEach(() => {
    store.clear();
    vi.mocked(redis.get).mockClear();
    vi.mocked(redis.set).mockClear();
    vi.mocked(redis.incr).mockClear();
    vi.mocked(redis.expire).mockClear();
  });

  it("counts one queued job", async () => {
    await recordQueuedJob("project-1");

    expect(store.get("langfuse:queue-backpressure:depth:project-1")).toBe("1");
  });

  it("reports a project that is not paused", async () => {
    await expect(isProjectPaused("project-1")).resolves.toBe(false);
  });

  it("pauses a project once its depth crosses the threshold", async () => {
    await recordQueuedJob("project-1");
    await recordQueuedJob("project-1");
    await recordQueuedJob("project-1");

    expect(store.get("langfuse:queue-backpressure:paused:project-1")).toBe("1");
    await expect(isProjectPaused("project-1")).resolves.toBe(true);
  });

  it("does not throw when redis fails while recording a queued job", async () => {
    vi.mocked(redis.incr).mockRejectedValueOnce(new Error("redis down"));

    await expect(recordQueuedJob("project-1")).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("fails open when redis fails while reading the pause flag", async () => {
    vi.mocked(redis.get).mockRejectedValueOnce(new Error("redis down"));

    await expect(isProjectPaused("project-1")).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it("clears the depth counter", async () => {
    await recordQueuedJob("project-1");
    await clearQueueDepth("project-1");

    expect(store.has("langfuse:queue-backpressure:depth:project-1")).toBe(false);
  });
});
