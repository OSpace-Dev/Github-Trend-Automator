const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DailyScheduler,
  getNextRunAt,
  getShanghaiDateKey,
  getShanghaiHour
} = require("../support/api/github-trending/scheduler");

test("calculates Shanghai date and the next 09:00 run", () => {
  const beforeRun = new Date("2026-07-18T00:30:00.000Z");
  assert.equal(getShanghaiDateKey(beforeRun), "2026-07-18");
  assert.equal(getShanghaiHour(beforeRun), 8);
  assert.equal(getNextRunAt(beforeRun, 9).toISOString(), "2026-07-18T01:00:00.000Z");

  const afterRun = new Date("2026-07-18T02:00:00.000Z");
  assert.equal(getNextRunAt(afterRun, 9).toISOString(), "2026-07-19T01:00:00.000Z");
});

test("creates a catch-up task when the service starts after 09:00", async () => {
  const dueCalls = [];
  let scheduledDelay = null;
  const scheduler = new DailyScheduler({
    hour: 9,
    now: () => new Date("2026-07-18T02:30:00.000Z"),
    onDue: async (...args) => dueCalls.push(args),
    setTimer(callback, delay) {
      scheduledDelay = delay;
      return { unref() {} };
    },
    clearTimer() {}
  });

  await scheduler.start();
  assert.deepEqual(dueCalls, [["2026-07-18", "startup_catch_up"]]);
  assert.equal(scheduler.getState().nextRunAt, "2026-07-19T01:00:00.000Z");
  assert.ok(scheduledDelay > 0);
  scheduler.stop();
});
