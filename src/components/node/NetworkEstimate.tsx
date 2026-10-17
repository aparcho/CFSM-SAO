import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { cfsmGet } from "@/services/cfsm/http";
import { getServerApiBase } from "@/services/api";
import { useMinuteClock } from "@/hooks/useClock";
import { estimateNetwork, type EstimateProbe, type Family } from "@/utils/networkEstimate";
import "@/styles/network-estimate.css";
import { cacheKey, readNikkiCache, saveNikkiCache, NIKKI_FRESH_MS } from "@/utils/nikkiCache";
const schema = z.array(z.object({ run_id:z.string(),family:z.enum(["ipv4","ipv6"]),direction:z.enum(["download","upload"]),tested_at:z.number(),status:z.enum(["ok","no_response","failed"]),mbps:z.number().nullable(),duration_seconds:z.number().optional(),retransmits:z.number().nullable().optional() }));
const nullableNumber=z.number().nullable();
function speedAge(time:number,now:number){const minutes=Math.max(0,Math.floor((now-time)/60_000));return minutes<60?`${minutes} 分钟`:`${Math.floor(minutes/60)} 小时 ${minutes%60} 分钟`;}
const periodSchema=z.object({score:z.number(),days:z.number(),runs:z.number(),download:z.number(),upload:z.number()}).nullable();
const resultSchema=schema.element.optional();
const retransmissionDirection=z.object({count:z.number(),estimatedMiB:z.number(),perMiB:z.number(),penalty:z.number()}).nullable();
const estimateSchema=z.object({retransmission:z.object({penalty:z.number(),download:retransmissionDirection,upload:retransmissionDirection}).nullable().optional(),modelVersion:z.number().optional(),speedAgeMs:nullableNumber.optional(),speedBasis:z.literal("latest").optional(),family:z.enum(["ipv4","ipv6"]),score:nullableNumber,reason:z.string(),
  probe:z.object({taskName:z.string(),lastValue:nullableNumber,loss:nullableNumber}).optional(),testedAt:z.number().optional(),download:resultSchema,upload:resultSchema,
  latency:nullableNumber,loss:nullableNumber,speed:nullableNumber,variation:nullableNumber,latencyMs:nullableNumber,
  metrics:z.object({p50:nullableNumber,p95:nullableNumber,samples:z.number(),pairs:z.number(),variationMs:nullableNumber}).nullable(),
  peak:periodSchema,offpeak:periodSchema,peakWeight:z.number(),excludedBatches:z.number()});
const nikkiSchema=z.object({observed_at:nullableNumber,fresh:z.boolean(),routes:z.array(z.object({server_id:z.string(),family:z.enum(["ipv4","ipv6"]),
  score:nullableNumber,reason:z.string(),low_since:nullableNumber,alerted:z.boolean(),active:z.boolean().default(true),selected:z.boolean().default(false),exit_active:z.boolean().default(false),notification_error:z.string().nullable(),evaluated_at:z.number(),estimate:estimateSchema}))});
function routeRole(r:{active?:boolean;exit_active?:boolean}) {
  return r.active?r.exit_active?'Nikki 实时入口 · 同时作为中转出口':'Nikki 实时入口':r.exit_active?'Nikki 活跃中转出口':'Nikki 分流待用入口';
}
export function NetworkEstimate({ uuid, probes, offline, ipv4, ipv6 }: {uuid:string;probes:EstimateProbe[];offline:boolean;ipv4?:string|null;ipv6?:string|null}) {
  const [selected, setSelected] = useState<Family|null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);
  const now = useMinuteClock();
  const base=getServerApiBase(uuid);
  const nikkiKey=cacheKey(base);
  const nikki=useQuery({queryKey:["nikki-status",nikkiKey],
    initialData:()=>readNikkiCache(nikkiKey,nikkiSchema),initialDataUpdatedAt:0,
    queryFn:async()=>{const snapshot=await cfsmGet('/api/nikki/status',nikkiSchema,{base});saveNikkiCache(nikkiKey,snapshot);return snapshot;},
    staleTime:15_000,refetchInterval:15_000,retry:1});
  const liveRoutes=nikki.data?.fresh && nikki.data.observed_at!=null && Date.now()-nikki.data.observed_at<=NIKKI_FRESH_MS ? nikki.data.routes:[];
  const query = useQuery({ queryKey:["network-estimate",uuid], queryFn:() => cfsmGet(`/api/iperf/results?${new URLSearchParams({id:uuid})}`,schema,{base:getServerApiBase(uuid)}), staleTime:60_000,refetchInterval:60_000,retry:1 });
  const estimates = (["ipv4","ipv6"] as Family[]).map(f => {
    const stored=liveRoutes.find(r=>r.server_id===uuid && r.family===f)?.estimate;
    return stored?.modelVersion===5?stored:estimateNetwork(f,probes,query.data ?? [],now,offline);
  });
  return <>
    {estimates.filter(s => s.family === "ipv4" ? ipv4 : ipv6).map(s => {
      const route=liveRoutes.find(r=>r.server_id===uuid && r.family===s.family);
      const active=route?.active===true,exit=route?.exit_active===true,standby=!active && !exit && route?.selected===true;
      const low=active && s.score!=null && s.score<60;
      return <button type="button" key={s.family} className="ip-stack-badge network-estimate-badge" data-tag={low?'red':active?'green':exit?'blue':standby?'yellow':'gray'} data-nikki-active={active?'true':undefined} data-nikki-exit={exit?'true':undefined} data-nikki-selected={route?.selected?'true':undefined} data-nikki-low={low?'true':undefined}
      onClick={e => { e.stopPropagation(); setSelected(s.family); }}
      aria-label={`IPv${s.family === "ipv4" ? "4" : "6"} 网络估算${s.score != null && !query.isError ? ` ${s.score}分` : ""}，查看依据`}
      title={`${nikki.isError && route?'同步暂时失败，显示最近有效状态 · ':''}${route?routeRole(route)+' · ':''}${low?'低于 60 分 · ':''}${s.testedAt && now-s.testedAt>3600_000?`带宽参考距今 ${speedAge(s.testedAt,now)} · `:''}网络估算分 / 100 · 点击查看依据`}>
      V{s.family === "ipv4" ? "4" : "6"}{s.score != null && !query.isError ? <span className="network-estimate-badge-score">· {s.score}</span> : null}
    </button>})}
    {selected && createPortal(<dialog ref={dialog} className="network-estimate-dialog" onClick={e => { e.stopPropagation(); if(e.target === e.currentTarget) setSelected(null); }} onCancel={e => { e.preventDefault(); setSelected(null); }} aria-label="网络估算依据">
      <header><strong>网络估算依据</strong><button type="button" onClick={() => setSelected(null)} aria-label="关闭评分依据">×</button></header>
    <div className="network-estimate-body">
      {estimates.filter(s => s.family === selected).map(s => <div className="network-estimate-family" key={s.family}><b>IPv{s.family === "ipv4" ? "4" : "6"} · {query.isError ? "测速读取失败" : query.isPending ? "加载中" : s.reason}{s.score != null && !query.isError ? ` · ${s.score}/100` : ""}</b>
        {liveRoutes.filter(r=>r.server_id===uuid && r.family===s.family).map(r=><span key="nikki">{routeRole(r)} · {r.score==null?'评分数据不足':!r.active?r.exit_active?'海外出口角色，不触发入口低分提醒':'分流已选中，暂未检测到实时流量':r.score<60?(r.alerted?'已发送低分提醒':'低分观察中，连续 5 分钟后提醒'):'仅提醒，不自动切换'} · 后台每分钟检查。{r.notification_error||''}<br/>绿色：最近 5 分钟有流量增长；黄色：分流已选中但暂时空闲；蓝色：活跃中转路线的海外出口；灰色：其他。入口与出口兼具时绿色优先，入口低分时红色优先。出口按已核实的中转映射或 dialer-proxy 识别；分数仍是该 VPS 自身测量，不代表整条中转路线。最近同步 {new Date(r.evaluated_at).toLocaleTimeString('zh-CN')}</span>)}
        <span>{s.probe?.taskName ?? "未配置对应地址族探针"} · 当前延迟 {s.probe?.lastValue == null ? "—" : `${Math.round(s.probe.lastValue)} ms`} · 近 10 分钟探测失败 {s.probe?.loss == null ? "—" : `${s.probe.loss.toFixed(1)}%`}</span>
        {s.metrics && <span>近 10 分钟探针：{s.metrics.samples} 个有效采样 · P50 {s.metrics.p50?.toFixed(1) ?? "—"} ms · P95 {s.metrics.p95?.toFixed(1) ?? "—"} ms</span>}
        {s.metrics && <span>延迟波动 {s.metrics.variationMs?.toFixed(1) ?? "样本不足"}{s.metrics.variationMs != null ? " ms" : ""} · {s.metrics.pairs} 对连续采样（非包级抖动）</span>}
        {s.testedAt && <><span>deb 下载 {s.download?.status === "ok" ? `${s.download.mbps?.toFixed(1)} Mbps` : s.download?.status === "no_response" ? "无响应" : "—"} · 上传 {s.upload?.status === "ok" ? `${s.upload.mbps?.toFixed(1)} Mbps` : s.upload?.status === "no_response" ? "无响应" : "—"}</span><span>带宽依据：最近一次测速 {new Date(s.testedAt).toLocaleString("zh-CN")} · 距今 {speedAge(s.testedAt,now)}{now-s.testedAt>3600_000?"，带宽非当前实测":"，非连续带宽监测"}</span></>}
        {s.peak && <span>历史晚高峰参考（不计当前分）：{s.peak.days} 天 / {s.peak.runs} 批 · 日汇总下载 {s.peak.download.toFixed(1)} / 上传 {s.peak.upload.toFixed(1)} Mbps</span>}
        {s.offpeak && <span>历史其余时段参考（不计当前分）：{s.offpeak.days} 天 / {s.offpeak.runs} 批 · 日汇总下载 {s.offpeak.download.toFixed(1)} / 上传 {s.offpeak.upload.toFixed(1)} Mbps</span>}
        {s.score != null && <>
          <span>单项分 / 100：延迟 {s.latency?.toFixed(1)} · 失败率 {s.loss?.toFixed(1)} · 带宽 {s.speed?.toFixed(1)} · 波动 {s.variation?.toFixed(1) ?? "未计"}</span>
          <span>重传辅助项：{s.retransmission?`本次扣 ${s.retransmission.penalty.toFixed(2)} 分（总扣分最多 3 分）`:'未计：缺少重传/时长数据或传输量不足 1 MiB'}</span>
          {s.retransmission && <span>每 MiB 重传：下载 {s.retransmission.download?.perMiB.toFixed(2)??'未计'} / 上传 {s.retransmission.upload?.perMiB.toFixed(2)??'未计'}。传输量由吞吐×时长估算，这是重传强度，非丢包率。</span>}
          <span>权重：延迟 30% / 失败率 20% / 带宽 40% / 波动 10%{s.variation == null ? "；波动缺项，按其余 90% 归一" : ""}。带宽只采用最近一次完整实测，不再混合历史时段。</span>
        </>}
      </div>)}
      <p>当前线路估算 v0.5，参考 AIM 指标。延迟、失败率与波动仅使用近 10 分钟；延迟按 10 ms 分档，70% 当前延迟＋30% 近期 P95，不足 3 个采样时用当前延迟。波动取相邻有效采样延迟绝对差的均值，失败或缺测处断开，至少需 5 对。</p>
      <p>带宽采用最近一批双向测速，下载 / 上传各占 70% / 30%，带宽单项锚点：100 Mbps 为 40 分、200 为 55 分、300 为 65 分、500 为 80 分、1000 为 95 分，区分至 2000 Mbps。这些是自定义体验标尺，不是官方 AIM 标准。最新失败或不完整时不沿用旧高速造分。历史晚高峰仍可参考，但不改变当前分数。重传作为辅助扣分项，下载 / 上传按 70% / 30% 合并，缺项不额外扣分。</p>
      <p>当前探针与 deb 测速是不同路径。带宽超过 1 小时提示非当前实测，超过 6 小时标记较早参考，超过 72 小时不计分；无新测速不能证明当前带宽未变。非官方完整 AIM，未计包级抖动及负载延迟。</p>
    </div>
    </dialog>, document.body)}
  </>;
}
