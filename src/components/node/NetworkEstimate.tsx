import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { cfsmGet } from "@/services/cfsm/http";
import { getServerApiBase } from "@/services/api";
import { useMinuteClock } from "@/hooks/useClock";
import { estimateNetwork, type EstimateProbe, type Family } from "@/utils/networkEstimate";
import "@/styles/network-estimate.css";
const schema = z.array(z.object({ run_id:z.string(),family:z.enum(["ipv4","ipv6"]),direction:z.enum(["download","upload"]),tested_at:z.number(),status:z.enum(["ok","no_response","failed"]),mbps:z.number().nullable() }));
const nullableNumber=z.number().nullable();
const periodSchema=z.object({score:z.number(),days:z.number(),runs:z.number(),download:z.number(),upload:z.number()}).nullable();
const resultSchema=schema.element.optional();
const estimateSchema=z.object({family:z.enum(["ipv4","ipv6"]),score:nullableNumber,reason:z.string(),
  probe:z.object({taskName:z.string(),lastValue:nullableNumber,loss:nullableNumber}).optional(),testedAt:z.number().optional(),download:resultSchema,upload:resultSchema,
  latency:nullableNumber,loss:nullableNumber,speed:nullableNumber,variation:nullableNumber,latencyMs:nullableNumber,
  metrics:z.object({p50:nullableNumber,p95:nullableNumber,samples:z.number(),pairs:z.number(),variationMs:nullableNumber}).nullable(),
  peak:periodSchema,offpeak:periodSchema,peakWeight:z.number(),excludedBatches:z.number()});
const nikkiSchema=z.object({observed_at:nullableNumber,fresh:z.boolean(),routes:z.array(z.object({server_id:z.string(),family:z.enum(["ipv4","ipv6"]),
  score:nullableNumber,reason:z.string(),low_since:nullableNumber,alerted:z.boolean(),notification_error:z.string().nullable(),evaluated_at:z.number(),estimate:estimateSchema}))});
export function NetworkEstimate({ uuid, probes, offline, ipv4, ipv6 }: {uuid:string;probes:EstimateProbe[];offline:boolean;ipv4?:string|null;ipv6?:string|null}) {
  const [selected, setSelected] = useState<Family|null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);
  const now = useMinuteClock();
  const base=getServerApiBase(uuid);
  const nikki=useQuery({queryKey:["nikki-status",base],queryFn:()=>cfsmGet('/api/nikki/status',nikkiSchema,{base}),staleTime:15_000,refetchInterval:30_000,retry:1});
  const liveRoutes=!nikki.isError && nikki.data?.fresh && nikki.data.observed_at!=null && Date.now()-nikki.data.observed_at<=150_000 ? nikki.data.routes:[];
  const query = useQuery({ queryKey:["network-estimate",uuid], queryFn:() => cfsmGet(`/api/iperf/results?${new URLSearchParams({id:uuid})}`,schema,{base:getServerApiBase(uuid)}), staleTime:60_000,refetchInterval:60_000,retry:1 });
  const estimates = (["ipv4","ipv6"] as Family[]).map(f => liveRoutes.find(r=>r.server_id===uuid && r.family===f)?.estimate ?? estimateNetwork(f,probes,query.data ?? [],now,offline));
  return <>
    {estimates.filter(s => s.family === "ipv4" ? ipv4 : ipv6).map(s => {
      const active=liveRoutes.find(r=>r.server_id===uuid && r.family===s.family);
      const low=!!active && s.score!=null && s.score<60;
      return <button type="button" key={s.family} className="ip-stack-badge network-estimate-badge" data-tag={low?'red':active?'green':'gray'} data-nikki-active={active?'true':undefined} data-nikki-low={low?'true':undefined}
      onClick={e => { e.stopPropagation(); setSelected(s.family); }}
      aria-label={`IPv${s.family === "ipv4" ? "4" : "6"} 网络估算${s.score != null && !query.isError ? ` ${s.score}分` : ""}，查看依据`}
      title={`${active?'Nikki 使用中 · ':''}${low?'低于 60 分 · ':''}网络估算分 / 100 · 点击查看依据`}>
      V{s.family === "ipv4" ? "4" : "6"}{s.score != null && !query.isError ? <span className="network-estimate-badge-score">· {s.score}</span> : null}
    </button>})}
    {selected && createPortal(<dialog ref={dialog} className="network-estimate-dialog" onClick={e => { e.stopPropagation(); if(e.target === e.currentTarget) setSelected(null); }} onCancel={e => { e.preventDefault(); setSelected(null); }} aria-label="网络估算依据">
      <header><strong>网络估算依据</strong><button type="button" onClick={() => setSelected(null)} aria-label="关闭评分依据">×</button></header>
    <div className="network-estimate-body">
      {estimates.filter(s => s.family === selected).map(s => <div className="network-estimate-family" key={s.family}><b>IPv{s.family === "ipv4" ? "4" : "6"} · {query.isError ? "测速读取失败" : query.isPending ? "加载中" : s.reason}{s.score != null && !query.isError ? ` · ${s.score}/100` : ""}</b>
        {liveRoutes.filter(r=>r.server_id===uuid && r.family===s.family).map(r=><span key="nikki">Nikki 使用中 · {r.score==null?'评分数据不足':r.score<60?(r.alerted?'已发送低分提醒':'低分观察中，连续 5 分钟后提醒'):'仅提醒，不自动切换'} · 后台每分钟检查。{r.notification_error||''}<br/>关联的是 VPS 公网入口段，不能代表中转后整条线路。最近同步 {new Date(r.evaluated_at).toLocaleTimeString('zh-CN')}</span>)}
        <span>{s.probe?.taskName ?? "未配置对应地址族探针"} · 当前延迟 {s.probe?.lastValue == null ? "—" : `${Math.round(s.probe.lastValue)} ms`} · 探测失败 {s.probe?.loss == null ? "—" : `${s.probe.loss.toFixed(1)}%`}</span>
        {s.metrics && <span>近 2 小时探针：{s.metrics.samples} 个有效采样 · P50 {s.metrics.p50?.toFixed(1) ?? "—"} ms · P95 {s.metrics.p95?.toFixed(1) ?? "—"} ms</span>}
        {s.metrics && <span>延迟波动 {s.metrics.variationMs?.toFixed(1) ?? "样本不足"}{s.metrics.variationMs != null ? " ms" : ""} · {s.metrics.pairs} 对连续采样（非包级抖动）</span>}
        {s.testedAt && <><span>deb 下载 {s.download?.status === "ok" ? `${s.download.mbps?.toFixed(1)} Mbps` : s.download?.status === "no_response" ? "无响应" : "—"} · 上传 {s.upload?.status === "ok" ? `${s.upload.mbps?.toFixed(1)} Mbps` : s.upload?.status === "no_response" ? "无响应" : "—"}</span><span>测速：{new Date(s.testedAt).toLocaleString("zh-CN")}</span></>}
        {s.peak && <span>晚高峰：{s.peak.days} 天 / {s.peak.runs} 批 · 日汇总下载 {s.peak.download.toFixed(1)} / 上传 {s.peak.upload.toFixed(1)} Mbps</span>}
        {s.offpeak && <span>其余时段：{s.offpeak.days} 天 / {s.offpeak.runs} 批 · 日汇总下载 {s.offpeak.download.toFixed(1)} / 上传 {s.offpeak.upload.toFixed(1)} Mbps</span>}
        {s.score != null && <>
          <span>单项分 / 100：延迟 {s.latency?.toFixed(1)} · 失败率 {s.loss?.toFixed(1)} · 带宽 {s.speed?.toFixed(1)} · 波动 {s.variation?.toFixed(1) ?? "未计"}</span>
          <span>权重：延迟 30% / 失败率 20% / 带宽 40% / 波动 10%{s.variation == null ? "；波动缺项，按其余 90% 归一" : ""}。带宽内晚高峰占 {(s.peakWeight*100).toFixed(0)}%。</span>
        </>}
      </div>)}
      <p>自定义线路估算 v0.2，参考 AIM 指标。延迟按 10 ms 分档，计分使用 70% P50＋30% P95；不足 5 个采样时用当前延迟。波动取相邻有效采样延迟绝对差的均值，失败或缺测处断开，至少需 5 对。</p>
      <p>带宽取接口返回的近 72 小时记录，先按日、时段汇总再跨日取中位数；北京时间 20:00–23:00 占 70%，其余时段占 30%，时段缺项时暂按已有样本。下载 / 上传各占 70% / 30%，速度曲线区分至 2000 Mbps。</p>
      <p>当前探针窗口与 deb 测速是不同路径；晚高峰权重只用于带宽历史。非官方完整 AIM，未计包级抖动及负载延迟。24 小时后标较旧，72 小时后不计分。</p>
    </div>
    </dialog>, document.body)}
  </>;
}
