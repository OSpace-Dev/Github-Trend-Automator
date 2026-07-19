<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { Activity, CalendarClock, CheckCircle2, CircleAlert, Database, ExternalLink, Eye, FileText, Github, LoaderCircle, Play, RefreshCw, Save, Settings2, Timer, X, XCircle } from "lucide-vue-next";
import { createApiClient, type Job, type Settings, type Snapshot, type SnapshotDetail, type Stats } from "./api";

const api = createApiClient();
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const notice = ref("");
const extensionClients = ref(0);
const stats = ref<Stats>({ totalSnapshots: 0, uniqueRepositories: 0, trendDays: 0, todaySnapshots: 0, totalJobs: 0, failedJobs: 0, latestTrendDate: null });
const settings = ref<Settings>({ scheduleTime: "09:00", timeZone: "Asia/Shanghai", readmeDelayMinSeconds: 2, readmeDelayMaxSeconds: 5 });
const nextRunAt = ref<string | null>(null);
const jobs = ref<Job[]>([]);
const snapshots = ref<Snapshot[]>([]);
const readmeTarget = ref<Snapshot | null>(null);
const readmeDetail = ref<SnapshotDetail | null>(null);
const readmeLoading = ref(false);
const readmeError = ref("");
function getShanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}
const snapshotDate = ref(getShanghaiDate());

const metrics = computed(() => [
  { label: "快照总数", value: stats.value.totalSnapshots, icon: Database, tone: "blue" },
  { label: "独立仓库", value: stats.value.uniqueRepositories, icon: Github, tone: "cyan" },
  { label: "Trending 天数", value: stats.value.trendDays, icon: CalendarClock, tone: "violet" },
  { label: "今日快照", value: stats.value.todaySnapshots, icon: Activity, tone: "green" },
  { label: "任务总数", value: stats.value.totalJobs, icon: CheckCircle2, tone: "indigo" },
  { label: "失败任务", value: stats.value.failedJobs, icon: XCircle, tone: "red" }
]);
const readmeHtml = computed(() => {
  const source = readmeDetail.value?.readmeContent;
  return source ? DOMPurify.sanitize(marked.parse(source, { async: false }) as string) : "";
});

function formatTime(value: string | null) {
  if (!value) return "未安排";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value));
}
function statusLabel(status: string) { return ({ queued: "排队中", dispatched: "已下发", collecting: "采集中", completed: "已完成", failed: "失败" } as Record<string, string>)[status] || status; }
function statusClass(status: string) { return `status-${status}`; }
function jobType(value: string) { return value === "scheduled" ? "定时" : "手动"; }
async function loadData() {
  loading.value = true; error.value = "";
  try {
    const [stat, config, recentJobs, daily] = await Promise.all([api.getStats(), api.getSettings(), api.getJobs(), api.getSnapshots(snapshotDate.value)]);
    stats.value = stat.stats; extensionClients.value = stat.extensionClients; settings.value = { ...settings.value, ...config.settings }; nextRunAt.value = config.schedule.nextRunAt; jobs.value = recentJobs.jobs; snapshots.value = daily.items;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "服务请求失败"; }
  finally { loading.value = false; }
}
async function refreshSnapshots() { try { snapshots.value = (await api.getSnapshots(snapshotDate.value)).items; } catch (cause) { error.value = cause instanceof Error ? cause.message : "快照请求失败"; } }
async function createJob() { try { notice.value = ""; await api.createJob(); notice.value = "测试任务已加入队列"; await loadData(); } catch (cause) { error.value = cause instanceof Error ? cause.message : "任务创建失败"; } }
async function saveSettings() { saving.value = true; error.value = ""; try { const result = await api.updateSettings(settings.value); settings.value = result.settings; nextRunAt.value = result.schedule.nextRunAt; notice.value = "调度与节流设置已保存"; } catch (cause) { error.value = cause instanceof Error ? cause.message : "设置保存失败"; } finally { saving.value = false; } }
async function openReadme(item: Snapshot) {
  readmeTarget.value = item;
  readmeDetail.value = null;
  readmeError.value = "";
  readmeLoading.value = true;
  try { readmeDetail.value = (await api.getSnapshot(item)).item; }
  catch (cause) { readmeError.value = cause instanceof Error ? cause.message : "README 加载失败"; }
  finally { readmeLoading.value = false; }
}
function closeReadme() { readmeTarget.value = null; readmeDetail.value = null; readmeError.value = ""; }
function handleEscape(event: KeyboardEvent) { if (event.key === "Escape" && readmeTarget.value) closeReadme(); }
onMounted(() => { loadData(); window.addEventListener("keydown", handleEscape); });
onBeforeUnmount(() => window.removeEventListener("keydown", handleEscape));
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark"><Github :size="20" /></span><div><strong>GitHub Trending</strong><small>Automator / 管理台</small></div></div>
      <div class="top-actions"><span class="connection"><span class="pulse" :class="{ offline: !extensionClients }"></span>{{ extensionClients ? `${extensionClients} 个扩展已连接` : "等待扩展连接" }}</span><button class="icon-button" title="刷新数据" :disabled="loading" @click="loadData"><RefreshCw :size="17" :class="{ spinning: loading }" /></button></div>
    </header>
    <section class="page-heading"><div><p class="eyebrow">运营概览</p><h1>采集控制台</h1><p class="subtle">查看每日快照，管理任务调度与 README 请求间隔。</p></div><button class="primary-button" :disabled="loading" @click="createJob"><Play :size="16" /> 创建测试任务</button></section>
    <p v-if="error" class="banner error-banner"><CircleAlert :size="17" /> {{ error }}</p><p v-if="notice" class="banner success-banner"><CheckCircle2 :size="17" /> {{ notice }}</p>
    <section class="metrics-grid"><article v-for="metric in metrics" :key="metric.label" class="metric-card"><div class="metric-icon" :class="`tone-${metric.tone}`"><component :is="metric.icon" :size="18" /></div><div><span>{{ metric.label }}</span><strong>{{ metric.value.toLocaleString() }}</strong></div></article></section>
    <section class="workspace-grid">
      <article class="panel settings-panel"><div class="panel-heading"><div><p class="eyebrow">运行策略</p><h2>调度与节流设置</h2></div><Settings2 :size="19" /></div><div class="field-grid"><label>每日触发时间<input v-model="settings.scheduleTime" type="time" step="60" /><small>时区固定为 {{ settings.timeZone }}</small></label><label>README 最小间隔（秒）<input v-model.number="settings.readmeDelayMinSeconds" type="number" min="0" max="60" step="0.5" /></label><label>README 最大间隔（秒）<input v-model.number="settings.readmeDelayMaxSeconds" type="number" min="0" max="60" step="0.5" /></label></div><div class="setting-footer"><span><Timer :size="15" /> 下次执行：{{ formatTime(nextRunAt) }}</span><button class="secondary-button" :disabled="saving" @click="saveSettings"><Save :size="15" /> {{ saving ? "保存中" : "保存设置" }}</button></div></article>
      <article class="panel status-panel"><div class="panel-heading"><div><p class="eyebrow">服务状态</p><h2>采集链路</h2></div><span class="live-label"><span class="pulse"></span>在线</span></div><div class="status-list"><div><span>本地 API</span><strong>127.0.0.1:8011</strong></div><div><span>最新快照</span><strong>{{ stats.latestTrendDate || "暂无数据" }}</strong></div><div><span>当前节流</span><strong>{{ settings.readmeDelayMinSeconds }}–{{ settings.readmeDelayMaxSeconds }} 秒</strong></div></div></article>
    </section>
    <section class="panel table-panel"><div class="panel-heading"><div><p class="eyebrow">执行记录</p><h2>最近任务</h2></div><span class="table-count">{{ jobs.length }} 条</span></div><div class="table-wrap"><table><thead><tr><th>任务</th><th>类型</th><th>状态</th><th>项目数</th><th>创建时间</th><th>完成时间</th></tr></thead><tbody><tr v-for="job in jobs" :key="job.jobId"><td><code>{{ job.jobId.slice(0, 8) }}</code><small>{{ job.trendDate }}</small></td><td>{{ jobType(job.triggerType) }}</td><td><span class="status-chip" :class="statusClass(job.status)">{{ statusLabel(job.status) }}</span></td><td>{{ job.itemCount }}</td><td>{{ formatTime(job.createdAt) }}</td><td>{{ formatTime(job.completedAt) }}</td></tr><tr v-if="!jobs.length"><td colspan="6" class="empty">暂无任务记录</td></tr></tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading snapshot-heading"><div><p class="eyebrow">数据浏览</p><h2>Trending 快照</h2></div><label class="date-filter">按日期<input v-model="snapshotDate" type="date" @change="refreshSnapshots" /></label></div><div class="table-wrap"><table><thead><tr><th>#</th><th>仓库</th><th>语言</th><th>总 Stars</th><th>今日新增</th><th>README</th></tr></thead><tbody><tr v-for="item in snapshots" :key="item.fullName"><td class="rank">{{ item.rank }}</td><td><a class="repository-link" :href="item.url" target="_blank" rel="noopener noreferrer" :title="`在 GitHub 打开 ${item.fullName}`"><span>{{ item.fullName }}</span><ExternalLink :size="13" /></a><small>{{ item.description || "无描述" }}</small></td><td>{{ item.language || "-" }}</td><td>{{ item.totalStars?.toLocaleString() || "-" }}</td><td>{{ item.starsToday?.toLocaleString() || "-" }}</td><td><button class="readme-button" title="在管理页查看 README" @click="openReadme(item)"><Eye :size="14" /> 查看 <span :class="item.readmeError ? 'readme-failed' : 'readme-ok'">{{ item.readmeError ? "失败" : item.hasReadme ? "已获取" : "无内容" }}</span></button></td></tr><tr v-if="!snapshots.length"><td colspan="6" class="empty">该日期暂无快照</td></tr></tbody></table></div></section>
    <footer>GitHub Trend Automator <span>·</span> 数据服务运行于本机</footer>
  </main>
  <Teleport to="body">
    <div v-if="readmeTarget" class="drawer-layer" role="presentation" @click.self="closeReadme">
      <aside class="readme-drawer" role="dialog" aria-modal="true" :aria-label="`${readmeTarget.fullName} README`">
        <header class="drawer-header"><div><p class="eyebrow">仓库 README</p><h2>{{ readmeTarget.fullName }}</h2><small>{{ readmeTarget.trendDate }} · 第 {{ readmeTarget.rank }} 名</small></div><button class="icon-button" title="关闭 README" @click="closeReadme"><X :size="18" /></button></header>
        <div v-if="readmeLoading" class="drawer-state"><LoaderCircle :size="24" class="spinning" /><span>正在读取数据库内容</span></div>
        <div v-else-if="readmeError" class="drawer-state drawer-error"><CircleAlert :size="24" /><strong>README 加载失败</strong><span>{{ readmeError }}</span></div>
        <div v-else-if="readmeDetail?.readmeError" class="drawer-state drawer-error"><CircleAlert :size="24" /><strong>采集时未能获取 README</strong><span>{{ readmeDetail.readmeError }}</span></div>
        <div v-else-if="!readmeHtml" class="drawer-state"><FileText :size="24" /><strong>该快照没有 README 内容</strong></div>
        <article v-else class="readme-content" v-html="readmeHtml"></article>
      </aside>
    </div>
  </Teleport>
</template>
