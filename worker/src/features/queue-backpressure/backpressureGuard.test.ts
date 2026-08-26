import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  clearQueueDepth,
  isProjectPaused,
  recordQueuedJob,
  releaseQueuedJob,
} from "./backpressureGuard";

const store = new Map<string, string>();

vi.mock("@langfuse/shared/src/server", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(next));
      return next;
    }),
    decr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? "0") - 1;
      store.set(key, String(next));
      return next;
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    scan: vi.fn(async () => ["0", [] as string[]]),
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

  it("releases a finished job from the depth counter", async () => {
    await recordQueuedJob("project-1");
    await releaseQueuedJob("project-1");

    expect(store.get("langfuse:queue-backpressure:depth:project-1")).toBe("0");
  });

  it("clears the depth counter", async () => {
    await recordQueuedJob("project-1");
    await clearQueueDepth("project-1");

    expect(store.has("langfuse:queue-backpressure:depth:project-1")).toBe(false);
  });
});
