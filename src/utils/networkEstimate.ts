export type Family = "ipv4" | "ipv6";
export interface EstimateResult {
  run_id: string; family: Family; direction: "download" | "upload";
  tested_at: number; status: "ok" | "no_response" | "failed"; mbps: number | null;
}
export interface EstimateProbe { taskName: string; lastValue: number | null; loss: number | null; loadState?: string; }
export function aimPoints(value: number, thresholds: number[], points: number[]) {
  let i = 0;
  while (i < thresholds.length && value >= thresholds[i]) i++;
  return points[i];
}
export function estimateNetwork(family: Family, probes: EstimateProbe[], results: EstimateResult[], now: number, offline: boolean) {
  // 同地址族只使用当前配置中第一条展示线路，绝不挑选分数最高的运营商。
  const probe = probes.find(p => new RegExp(`(?:IP)?V${family === "ipv4" ? 4 : 6}(?:\\b|$)`, "i").test(p.taskName));
  const latest = results.filter(r => r.family === family && r.tested_at <= now + 60_000).sort((a,b) => b.tested_at-a.tested_at)[0];
  const batch = latest ? results.filter(r => r.run_id === latest.run_id && r.family === family) : [];
  const download = batch.find(r => r.direction === "download");
  const upload = batch.find(r => r.direction === "upload");
  const base = { family, probe, testedAt: latest?.tested_at, download, upload };
  if (offline) return { ...base, score: null, reason: "节点离线" };
  if (!probe || probe.loadState === "error" || probe.loadState === "pending" || probe.loss == null || !Number.isFinite(probe.loss) || probe.loss < 0 || probe.loss > 100 || (probe.lastValue == null && probe.loss < 100)) return { ...base, score: null, reason: "探针数据不足" };
  if (!latest) return { ...base, score: null, reason: "暂无测速" };
  const age = now - latest.tested_at;
  if (age > 72*3600_000) return { ...base, score: null, reason: "测速已过期" };
  if (!download || !upload) return { ...base, score: null, reason: "测速不完整" };
  if ([download,upload].some(r => r.status === "failed")) return { ...base, score: null, reason: "测速失败" };
  const validSpeed = (r: EstimateResult) => r.status === "no_response" || (r.mbps != null && Number.isFinite(r.mbps) && r.mbps >= 0);
  if (!validSpeed(download) || !validSpeed(upload) || (probe.lastValue != null && (!Number.isFinite(probe.lastValue) || probe.lastValue < 0))) return { ...base, score: null, reason: "指标无效" };
  const latency = aimPoints(probe.lastValue ?? 500,[10,20,50,100,500],[20,10,5,0,-10,-20]);
  const loss = aimPoints(probe.loss/100,[0.01,0.05,0.25,0.5],[10,5,0,-10,-20]);
  const speedPoints = (r: EstimateResult) => aimPoints(r.status === "no_response" ? 0 : r.mbps!,[1,10,50,100],[0,5,10,20,30]);
  const speed = 0.7*speedPoints(download) + 0.3*speedPoints(upload);
  // 展示版：AIM 单项分数，带宽按下载70%/上传30%适配；可用维度满分60，非官方完整AIM。
  const score = Math.round(Math.max(0,Math.min(60,latency+loss+speed))/60*100);
  return { ...base, score, reason: age > 24*3600_000 ? "测速较旧" : "估算", latency, loss, speed };
}
