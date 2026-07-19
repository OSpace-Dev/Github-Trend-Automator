const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DailyScheduler,
  getNextRunAt,
  getShanghaiDateKey,
  getShanghaiMinuteOfDay,
  parseScheduleTime
} = require("../support/api/github-trending/scheduler");

test("calculates Shanghai date and the next scheduled run", () => {
  const beforeRun = new Date("2026-07-18T00:30:00.000Z");
  assert.equal(getShanghaiDateKey(beforeRun), "2026-07-18");
  assert.equal(getShanghaiMinuteOfDay(beforeRun), 8 * 60 + 30);
  assert.deepEqual(parseScheduleTime("09:15"), { hour: 9, minute: 15, minuteOfDay: 555 });
  assert.equal(getNextRunAt(beforeRun, "09:15").toISOString(), "2026-07-18T01:15:00.000Z");

  const afterRun = new Date("2026-07-18T02:00:00.000Z");
  assert.equal(getNextRunAt(afterRun, "09:15").toISOString(), "2026-07-19T01:15:00.000Z");
});

test("creates a catch-up task when the service starts after the configured time", async () => {
  const dueCalls = [];
  let scheduledDelay = null;
  const scheduler = new DailyScheduler({
    scheduleTime: "09:15",
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
  assert.equal(scheduler.getState().nextRunAt, "2026-07-19T01:15:00.000Z");
  assert.ok(scheduledDelay > 0);
  scheduler.stop();
});

test("reschedules the timer immediately after a schedule update", () => {
  const timers = [];
  const scheduler = new DailyScheduler({
    scheduleTime: "09:00",
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    onDue: async () => {},
    setTimer(callback, delay) {
      timers.push({ callback, delay });
      return { unref() {} };
    },
    clearTimer() {}
  });
  const state = scheduler.reschedule("10:30");
  assert.equal(state.scheduleTime, "10:30");
  assert.equal(state.nextRunAt, "2026-07-18T02:30:00.000Z");
  assert.equal(timers.length, 1);
  scheduler.stop();
});
