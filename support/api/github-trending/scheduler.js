const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function getShanghaiDateKey(date = new Date()) {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function getShanghaiHour(date = new Date()) {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).getUTCHours();
}

function getNextRunAt(date = new Date(), hour = 9) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const target = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    hour - 8,
    0,
    0,
    0
  );
  const targetTime = target <= date.getTime() ? target + DAY_MS : target;
  return new Date(targetTime);
}

class DailyScheduler {
  constructor(options) {
    this.hour = options.hour;
    this.onDue = options.onDue;
    this.now = options.now || (() => new Date());
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.timer = null;
    this.nextRunAt = null;
  }

  async start() {
    const current = this.now();
    if (getShanghaiHour(current) >= this.hour) {
      await this.onDue(getShanghaiDateKey(current), "startup_catch_up");
    }
    this.scheduleNext();
  }

  scheduleNext() {
    if (this.timer) {
      this.clearTimer(this.timer);
    }
    const current = this.now();
    this.nextRunAt = getNextRunAt(current, this.hour);
    const delay = Math.max(0, this.nextRunAt.getTime() - current.getTime());
    this.timer = this.setTimer(async () => {
      const dueAt = this.now();
      try {
        await this.onDue(getShanghaiDateKey(dueAt), "scheduled");
      } finally {
        this.scheduleNext();
      }
    }, delay);
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  getState() {
    return {
      hour: this.hour,
      timeZone: "Asia/Shanghai",
      nextRunAt: this.nextRunAt ? this.nextRunAt.toISOString() : null
    };
  }
}

module.exports = {
  DailyScheduler,
  getNextRunAt,
  getShanghaiDateKey,
  getShanghaiHour
};
