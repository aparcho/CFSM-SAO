import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { cfsmGet } from "@/services/cfsm/http";
import { getServerApiBase } from "@/services/api";
import { useMinuteClock } from "@/hooks/useClock";
import { estimateNetwork, type EstimateProbe, type Family } from "@/utils/networkEstimate";
import "@/styles/network-estimate.css";
const schema = z.array(z.object({ run_id:z.string(),family:z.enum(["ipv4","ipv6"]),direction:z.enum(["download","upload"]),tested_at:z.number(),status:z.enum(["ok","no_response","failed"]),mbps:z.number().nullable() }));
export function NetworkEstimate({ uuid, probes, offline }: {uuid:string;probes:EstimateProbe[];offline:boolean}) {
  const now = useMinuteClock();
  const query = useQuery({ queryKey:["network-estimate",uuid], queryFn:() => cfsmGet(`/api/iperf/results?${new URLSearchParams({id:uuid})}`,schema,{base:getServerApiBase(uuid)}), staleTime:60_000,refetchInterval:60_000,retry:1 });
  const estimates = (["ipv4","ipv6"] as Family[]).map(f => estimateNetwork(f,probes,query.data ?? [],now,offline));
  return <details className="network-estimate" onClick={e => e.stopPropagation()}>
    <summary><span className="network-estimate-label">网络估算</span><span className="network-estimate-scores">{estimates.map(s => <span key={s.family}>V{s.family === "ipv4" ? "4" : "6"} <strong data-tone={s.score == null ? "muted" : s.score >= 65 ? "good" : s.score >= 40 ? "fair" : "poor"}>{query.isError ? "—" : s.score == null ? "—" : `${s.score}分`}</strong></span>)}</span><span className="network-estimate-chevron">⌄</span></summary>
    <div className="network-estimate-body">
      {estimates.map(s => <div className="network-estimate-family" key={s.family}><b>IPv{s.family === "ipv4" ? "4" : "6"} · {query.isError ? "测速读取失败" : query.isPending ? "加载中" : s.reason}{s.score != null && !query.isError ? ` · ${s.score}/100` : ""}</b>
        <span>{s.probe?.taskName ?? "未配置对应地址族探针"} · 延迟 {s.probe?.lastValue == null ? "—" : `${Math.round(s.probe.lastValue)} ms`} · 探测失败 {s.probe?.loss == null ? "—" : `${s.probe.loss.toFixed(1)}%`}</span>
        {s.testedAt && <><span>deb 下载 {s.download?.status === "ok" ? `${s.download.mbps?.toFixed(1)} Mbps` : s.download?.status === "no_response" ? "无响应" : "—"} · 上传 {s.upload?.status === "ok" ? `${s.upload.mbps?.toFixed(1)} Mbps` : s.upload?.status === "no_response" ? "无响应" : "—"}</span><span>测速：{new Date(s.testedAt).toLocaleString("zh-CN")}</span></>}
        {s.score != null && <span>计分：延迟 {s.latency} ＋ 失败率 {s.loss} ＋ 带宽 {s.speed?.toFixed(1)}；÷60×100</span>}
      </div>)}
      <p>AIM 规则适配估算 v0.1；带宽按下载 70% / 上传 30%，100 Mbps 以上同档。结合当前探针线路与 deb 测速，非同路径实测评分；未计抖动和负载延迟。24 小时后标较旧，72 小时后不计分。</p>
    </div>
  </details>;
}
