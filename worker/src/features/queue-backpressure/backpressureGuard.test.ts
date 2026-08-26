import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  clearQueueDepth,
  isProjectPaused,
  listPausedProjects,
  recordProcessedJob,
  recordQueuedJob,
} from "./backpressureGuard";

const store = new Map<string, string>();

vi.mock("@langfuse/shared/src/server", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    decr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? "0") - 1;
      store.set(key, String(next));
      return next;
    }),
    scanStream: vi.fn(({ match }: { match: string }) => {
      const prefix = match.replace(/\*$/, "");
      const hits = [...store.keys()].filter((key) => key.startsWith(prefix));
      return (async function* () {
        yield hits;
      })();
    }),
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

  it("clears the depth counter", async () => {
    await recordQueuedJob("project-1");
    await clearQueueDepth("project-1");

    expect(store.has("langfuse:queue-backpressure:depth:project-1")).toBe(false);
  });

  it("drops the depth back to zero when the queue drains", async () => {
    await recordQueuedJob("project-1");
    await recordQueuedJob("project-1");
    await recordProcessedJob("project-1");
    await recordProcessedJob("project-1");

    expect(store.get("langfuse:queue-backpressure:depth:project-1")).toBe("0");
  });

  it("floors the depth at zero on an extra processed job", async () => {
    await recordProcessedJob("project-1");

    expect(store.get("langfuse:queue-backpressure:depth:project-1")).toBe("0");
  });

  it("lists a paused project through scanStream", async () => {
    store.set("langfuse:queue-backpressure:paused:project-1", "1");
    store.set("langfuse:queue-backpressure:depth:project-2", "7");

    await expect(listPausedProjects()).resolves.toEqual(["project-1"]);
  });
});
