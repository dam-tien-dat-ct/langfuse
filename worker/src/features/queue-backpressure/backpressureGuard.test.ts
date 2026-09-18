import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let redisClient: Record<string, unknown> | null;

vi.mock("@langfuse/shared/src/server", () => ({
  get redis() {
    return redisClient;
  },
  logger: { warn: vi.fn(), error: vi.fn() },
  recordGauge: vi.fn(),
  recordIncrement: vi.fn(),
}));

const makeRedis = () => ({
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
  scanStream: vi.fn(async function* () {
    yield [...store.keys()].filter((key) =>
      key.startsWith("langfuse:queue-backpressure:paused:"),
    );
  }),
});

async function loadGuard(threshold?: string) {
  vi.resetModules();
  if (threshold === undefined) {
    delete process.env.LANGFUSE_QUEUE_PAUSE_THRESHOLD;
  } else {
    process.env.LANGFUSE_QUEUE_PAUSE_THRESHOLD = threshold;
  }
  redisClient = makeRedis();
  return import("./backpressureGuard");
}

describe("backpressureGuard", () => {
  beforeEach(() => {
    store.clear();
    redisClient = makeRedis();
    delete process.env.LANGFUSE_QUEUE_PAUSE_THRESHOLD;
  });

  it("counts one queued job and expires the depth counter", async () => {
    const { recordQueuedJob } = await loadGuard("500");

    await recordQueuedJob("project-1");
    const redis = redisClient as { expire: ReturnType<typeof vi.fn> };

    expect(store.get("langfuse:queue-backpressure:depth:project-1")).toBe("1");
    expect(redis.expire).toHaveBeenCalledWith(
      "langfuse:queue-backpressure:depth:project-1",
      300,
    );
  });

  it.each([
    ["one below", "2", false],
    ["exactly", "3", false],
    ["one above", "4", true],
  ])("pauses at the configured boundary: %s", async (_name, count, paused) => {
    const { recordQueuedJob, isProjectPaused } = await loadGuard("3");

    for (let i = 0; i < Number(count); i++) await recordQueuedJob("project-1");

    await expect(isProjectPaused("project-1")).resolves.toBe(paused);
  });

  it.each([["missing", undefined], ["zero", "0"], ["malformed", "not-a-number"]])(
    "uses a safe threshold for %s configuration",
    async (_name, threshold) => {
      const { recordQueuedJob, isProjectPaused } = await loadGuard(threshold);

      await recordQueuedJob("project-1");
      await expect(isProjectPaused("project-1")).resolves.toBe(threshold === "0");
    },
  );

  it("fails open when Redis rejects the pause check", async () => {
    const { isProjectPaused } = await loadGuard("3");
    (redisClient as { get: ReturnType<typeof vi.fn> }).get.mockRejectedValue(
      new Error("Redis unavailable"),
    );

    await expect(isProjectPaused("project-1")).resolves.toBe(false);
  });

  it("lists paused projects incrementally", async () => {
    const { listPausedProjects } = await loadGuard("3");
    store.set("langfuse:queue-backpressure:paused:project-1", "1");
    store.set("langfuse:queue-backpressure:paused:project-2", "1");

    await expect(listPausedProjects()).resolves.toEqual([
      "project-1",
      "project-2",
    ]);
    expect(
      (redisClient as { scanStream: ReturnType<typeof vi.fn> }).scanStream,
    ).toHaveBeenCalledWith({
      match: "langfuse:queue-backpressure:paused:*",
      count: 100,
    });
  });

  it("returns an empty list when Redis is unavailable", async () => {
    const { listPausedProjects } = await loadGuard("3");
    redisClient = null;

    await expect(listPausedProjects()).resolves.toEqual([]);
  });

  it("clears the depth counter", async () => {
    const { recordQueuedJob, clearQueueDepth } = await loadGuard("3");
    await recordQueuedJob("project-1");
    await clearQueueDepth("project-1");

    expect(store.has("langfuse:queue-backpressure:depth:project-1")).toBe(false);
  });
});
