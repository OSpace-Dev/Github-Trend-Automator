const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

class TrendingStore {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.prepare();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        trend_date TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        dispatched_at TEXT,
        completed_at TEXT,
        error TEXT,
        item_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_scheduled_date
      ON jobs(trend_date) WHERE trigger_type = 'scheduled';

      CREATE INDEX IF NOT EXISTS idx_jobs_status_created
      ON jobs(status, created_at);

      CREATE TABLE IF NOT EXISTS snapshots (
        trend_date TEXT NOT NULL,
        rank INTEGER NOT NULL,
        owner TEXT NOT NULL,
        repository TEXT NOT NULL,
        full_name TEXT NOT NULL,
        description TEXT,
        url TEXT NOT NULL,
        language TEXT,
        total_stars INTEGER,
        total_forks INTEGER,
        stars_today INTEGER,
        readme_content TEXT,
        readme_url TEXT,
        readme_error TEXT,
        captured_at TEXT NOT NULL,
        job_id TEXT NOT NULL,
        PRIMARY KEY (trend_date, full_name),
        FOREIGN KEY (job_id) REFERENCES jobs(job_id)
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_date_rank
      ON snapshots(trend_date DESC, rank ASC);
    `);
  }

  prepare() {
    this.insertJobStatement = this.db.prepare(`
      INSERT INTO jobs (job_id, trend_date, trigger_type, status, created_at)
      VALUES (?, ?, ?, 'queued', ?)
    `);
    this.upsertSnapshotStatement = this.db.prepare(`
      INSERT INTO snapshots (
        trend_date, rank, owner, repository, full_name, description, url,
        language, total_stars, total_forks, stars_today, readme_content,
        readme_url, readme_error, captured_at, job_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trend_date, full_name) DO UPDATE SET
        rank = excluded.rank,
        description = excluded.description,
        url = excluded.url,
        language = excluded.language,
        total_stars = excluded.total_stars,
        total_forks = excluded.total_forks,
        stars_today = excluded.stars_today,
        readme_content = excluded.readme_content,
        readme_url = excluded.readme_url,
        readme_error = excluded.readme_error,
        captured_at = excluded.captured_at,
        job_id = excluded.job_id
    `);
  }

  createJob({ trendDate, triggerType }) {
    const job = {
      jobId: randomUUID(),
      trendDate,
      triggerType,
      status: "queued",
      createdAt: new Date().toISOString(),
      dispatchedAt: null,
      completedAt: null,
      error: null,
      itemCount: 0
    };
    this.insertJobStatement.run(job.jobId, job.trendDate, job.triggerType, job.createdAt);
    return job;
  }

  ensureScheduledJob(trendDate) {
    const existing = this.db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE trend_date = ? AND trigger_type = 'scheduled'
      LIMIT 1
    `).get(trendDate);
    return existing || this.createJob({ trendDate, triggerType: "scheduled" });
  }

  getJob(jobId) {
    return this.db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE job_id = ?`).get(jobId) || null;
  }

  listJobs(limit = 50) {
    return this.db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }

  getNextQueuedJob() {
    return this.db.prepare(`
      SELECT ${JOB_COLUMNS} FROM jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC LIMIT 1
    `).get() || null;
  }

  markDispatched(jobId) {
    const dispatchedAt = new Date().toISOString();
    this.db.prepare(`
      UPDATE jobs SET status = 'dispatched', dispatched_at = ?, error = NULL
      WHERE job_id = ? AND status = 'queued'
    `).run(dispatchedAt, jobId);
    return this.getJob(jobId);
  }

  markCollecting(jobId) {
    this.db.prepare(`
      UPDATE jobs SET status = 'collecting'
      WHERE job_id = ? AND status IN ('queued', 'dispatched', 'collecting')
    `).run(jobId);
    return this.getJob(jobId);
  }

  requeueJob(jobId, error) {
    this.db.prepare(`
      UPDATE jobs
      SET status = 'queued', dispatched_at = NULL, error = ?
      WHERE job_id = ? AND status IN ('dispatched', 'collecting')
    `).run(error || null, jobId);
    return this.getJob(jobId);
  }

  markFailed(jobId, error) {
    const completedAt = new Date().toISOString();
    this.db.prepare(`
      UPDATE jobs SET status = 'failed', completed_at = ?, error = ?
      WHERE job_id = ?
    `).run(completedAt, error || "collection_failed", jobId);
    return this.getJob(jobId);
  }

  completeJob(jobId, items, capturedAt) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error("job_not_found");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of items) {
        this.upsertSnapshotStatement.run(
          job.trendDate,
          item.rank,
          item.owner,
          item.repository,
          item.fullName,
          item.description,
          item.url,
          item.language,
          item.totalStars,
          item.totalForks,
          item.starsToday,
          item.readmeContent,
          item.readmeUrl,
          item.readmeError,
          capturedAt,
          jobId
        );
      }
      this.db.prepare(`
        UPDATE jobs
        SET status = 'completed', completed_at = ?, error = NULL, item_count = ?
        WHERE job_id = ?
      `).run(capturedAt, items.length, jobId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getJob(jobId);
  }

  listSnapshots({ trendDate = null, limit = 100, offset = 0 } = {}) {
    if (trendDate) {
      return this.db.prepare(`
        SELECT ${SNAPSHOT_COLUMNS} FROM snapshots
        WHERE trend_date = ? ORDER BY rank ASC LIMIT ? OFFSET ?
      `).all(trendDate, limit, offset);
    }
    return this.db.prepare(`
      SELECT ${SNAPSHOT_COLUMNS} FROM snapshots
      WHERE trend_date = (SELECT MAX(trend_date) FROM snapshots)
      ORDER BY rank ASC LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  close() {
    this.db.close();
  }
}

const JOB_COLUMNS = `
  job_id AS jobId,
  trend_date AS trendDate,
  trigger_type AS triggerType,
  status,
  created_at AS createdAt,
  dispatched_at AS dispatchedAt,
  completed_at AS completedAt,
  error,
  item_count AS itemCount
`;

const SNAPSHOT_COLUMNS = `
  trend_date AS trendDate,
  rank,
  owner,
  repository,
  full_name AS fullName,
  description,
  url,
  language,
  total_stars AS totalStars,
  total_forks AS totalForks,
  stars_today AS starsToday,
  readme_content AS readmeContent,
  readme_url AS readmeUrl,
  readme_error AS readmeError,
  captured_at AS capturedAt,
  job_id AS jobId
`;

module.exports = { TrendingStore };
