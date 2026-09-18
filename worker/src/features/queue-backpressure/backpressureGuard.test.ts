import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  clearQueueDepth,
  isProjectPaused,
  listPausedProjects,
  recordQueuedJob,
} from "./backpressureGuard";
import { redis } from "@langfuse/shared/src/server";

const store = new Map<string, string>();

vi.mock("@langfuse/shared/src/server", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    scanStream: vi.fn(() =>
      (async function* () {
        yield [...store.keys()].filter((key) =>
          key.startsWith("langfuse:queue-backpressure:paused:"),
        );
      })(),
    ),
  },
  logger: { warn: vi.fn(), error: vi.fn() },
  recordGauge: vi.fn(),
  recordIncrement: vi.fn(),
}));

describe("backpressureGuard", () => {
  const originalThreshold = process.env.LANGFUSE_QUEUE_PAUSE_THRESHOLD;

  beforeEach(() => {
    store.clear();
    vi.mocked(redis!.get).mockImplementation(async (key: string) => store.get(key) ?? null);
  });

  afterEach(() => {
    if (originalThreshold === undefined) {
      delete process.env.LANGFUSE_QUEUE_PAUSE_THRESHOLD;
    } else {
      process.env.LANGFUSE_QUEUE_PAUSE_THRESHOLD = originalThreshold;
    }
  });

  it("counts one queued job and refreshes its expiry", async () => {
    await recordQueuedJob("project-1");

    expect(store.get("langfuse:queue-backpressure:depth:project-1")).toBe("1");
    expect(redis!.expire).toHaveBeenCalledWith(
      "langfuse:queue-backpressure:depth:project-1",
      300,
    );
  });

  it("pauses a project after crossing the threshold", async () => {
    for (let index = 0; index < 501; index++) {
      await recordQueuedJob("project-1");
    }

    await expect(isProjectPaused("project-1")).resolves.toBe(true);
    expect(redis!.set).toHaveBeenLastCalledWith(
      "langfuse:queue-backpressure:paused:project-1",
      "1",
      "EX",
      300,
    );
  });

  it("fails open when checking a project and Redis errors", async () => {
    vi.mocked(redis!.get).mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(isProjectPaused("project-1")).resolves.toBe(false);
  });

  it("lists paused projects without using a blocking key scan", async () => {
    await recordQueuedJob("project-1");
    store.set("langfuse:queue-backpressure:paused:project-2", "1");

    // The first project is below threshold, so only the explicit flag appears.
    await expect(listPausedProjects()).resolves.toEqual(["project-2"]);
    expect(redis!.scanStream).toHaveBeenCalledWith({
      match: "langfuse:queue-backpressure:paused:*",
      count: 100,
    });
  });

  it("uses the default threshold for blank and invalid environment values", async () => {
    for (const threshold of ["", "not-a-number"]) {
      process.env.LANGFUSE_QUEUE_PAUSE_THRESHOLD = threshold;
      vi.resetModules();
      const module = await import("./backpressureGuard");

      const projectId = `project-${threshold || "blank"}`;
      for (let index = 0; index < 500; index++) {
        await module.recordQueuedJob(projectId);
      }
      await expect(module.isProjectPaused(projectId)).resolves.toBe(false);

      await module.recordQueuedJob(projectId);
      await expect(module.isProjectPaused(projectId)).resolves.toBe(true);
    }
  });

  it("reports a project that is not paused", async () => {
    await expect(isProjectPaused("project-1")).resolves.toBe(false);
  });

  it("clears the depth counter", async () => {
    await recordQueuedJob("project-1");
    await clearQueueDepth("project-1");

    expect(store.has("langfuse:queue-backpressure:depth:project-1")).toBe(false);
  });
});
