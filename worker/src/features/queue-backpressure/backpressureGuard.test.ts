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
    keys: vi.fn(async () => []),
  },
  logger: { warn: vi.fn(), error: vi.fn() },
  recordGauge: vi.fn(),
  recordIncrement: vi.fn(),
}));

describe("backpressureGuard", () => {
  beforeEach(() => {
    store.clear();
  });

  it("counts one queued job", async () => {
    await recordQueuedJob("project-1");

    expect(store.get("langfuse:queue-backpressure:depth:project-1")).toBe("1");
  });

  it("reports a project that is not paused", async () => {
    await expect(isProjectPaused("project-1")).resolves.toBe(false);
  });

  it("pauses a project once its depth crosses the threshold", async () => {
    // Seed the depth to the threshold so the next increment crosses it.
    store.set("langfuse:queue-backpressure:depth:project-1", "500");

    await recordQueuedJob("project-1");

    expect(store.get("langfuse:queue-backpressure:paused:project-1")).toBe("1");
    await expect(isProjectPaused("project-1")).resolves.toBe(true);
  });

  it("does not pause a project below the threshold", async () => {
    // Seed the depth just below the threshold.
    store.set("langfuse:queue-backpressure:depth:project-1", "499");

    await recordQueuedJob("project-1");

    expect(store.has("langfuse:queue-backpressure:paused:project-1")).toBe(false);
    await expect(isProjectPaused("project-1")).resolves.toBe(false);
  });

  it("reports a project that is paused", async () => {
    store.set("langfuse:queue-backpressure:paused:project-1", "1");

    await expect(isProjectPaused("project-1")).resolves.toBe(true);
  });

  it("clears the depth counter", async () => {
    await recordQueuedJob("project-1");
    await clearQueueDepth("project-1");

    expect(store.has("langfuse:queue-backpressure:depth:project-1")).toBe(false);
  });
});
