export interface Settings {
  scheduleTime: string;
  timeZone: string;
  readmeDelayMinSeconds: number;
  readmeDelayMaxSeconds: number;
}

export interface Stats {
  totalSnapshots: number;
  uniqueRepositories: number;
  trendDays: number;
  todaySnapshots: number;
  totalJobs: number;
  failedJobs: number;
  latestTrendDate: string | null;
}

export interface Job {
  jobId: string;
  trendDate: string;
  triggerType: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  itemCount: number;
}

export interface Snapshot {
  trendDate: string;
  rank: number;
  fullName: string;
  description: string | null;
  url: string;
  language: string | null;
  totalStars: number | null;
  starsToday: number | null;
  hasReadme?: number;
  readmeError: string | null;
}

export interface SnapshotDetail extends Snapshot {
  readmeContent: string | null;
  readmeUrl: string | null;
  capturedAt: string;
}

export function createApiClient() {
  const origin = localStorage.getItem("github-trending-admin-origin") || "http://127.0.0.1:8011";
  const token = localStorage.getItem("github-trending-admin-token") || "dev-github-trending-api-token";
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(new URL(path, origin), {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `http_${response.status}`);
    return payload as T;
  }
  return {
    getStats: () => request<{ stats: Stats; extensionClients: number }>("/api/github-trending/stats"),
    getSettings: () => request<{ settings: Settings; schedule: { nextRunAt: string | null } }>("/api/github-trending/settings"),
    updateSettings: (settings: Pick<Settings, "scheduleTime" | "readmeDelayMinSeconds" | "readmeDelayMaxSeconds">) => request<{ settings: Settings; schedule: { nextRunAt: string | null } }>("/api/github-trending/settings", { method: "PUT", body: JSON.stringify(settings) }),
    createJob: () => request<{ job: Job }>("/api/github-trending/jobs", { method: "POST", body: "{}" }),
    getJobs: () => request<{ jobs: Job[] }>("/api/github-trending/jobs?limit=20"),
    getSnapshots: (date: string) => request<{ items: Snapshot[] }>(`/api/github-trending/snapshots?date=${encodeURIComponent(date)}&limit=100&includeReadme=0`),
    getSnapshot: (item: Snapshot) => {
      const [owner, repository] = item.fullName.split("/");
      return request<{ item: SnapshotDetail }>(`/api/github-trending/snapshots/${encodeURIComponent(item.trendDate)}/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`);
    }
  };
}
