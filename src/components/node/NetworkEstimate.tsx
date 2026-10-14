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
export function NetworkEstimate({ uuid, probes, offline, ipv4, ipv6 }: {uuid:string;probes:EstimateProbe[];offline:boolean;ipv4?:string|null;ipv6?:string|null}) {
  const [selected, setSelected] = useState<Family|null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);
  const now = useMinuteClock();
  const query = useQuery({ queryKey:["network-estimate",uuid], queryFn:() => cfsmGet(`/api/iperf/results?${new URLSearchParams({id:uuid})}`,schema,{base:getServerApiBase(uuid)}), staleTime:60_000,refetchInterval:60_000,retry:1 });
  const estimates = (["ipv4","ipv6"] as Family[]).map(f => estimateNetwork(f,probes,query.data ?? [],now,offline));
  return <>
    {estimates.filter(s => s.family === "ipv4" ? ipv4 : ipv6).map(s => <button type="button" key={s.family} className="ip-stack-badge network-estimate-badge" data-tag="green"
      onClick={e => { e.stopPropagation(); setSelected(s.family); }}
      aria-label={`IPv${s.family === "ipv4" ? "4" : "6"} 网络估算${s.score != null && !query.isError ? ` ${s.score}分` : ""}，查看依据`}
      title="网络估算分 / 100 · 点击查看依据">
      V{s.family === "ipv4" ? "4" : "6"}{s.score != null && !query.isError ? <span className="network-estimate-badge-score">· {s.score}</span> : null}
    </button>)}
    {selected && createPortal(<dialog ref={dialog} className="network-estimate-dialog" onClick={e => { e.stopPropagation(); if(e.target === e.currentTarget) setSelected(null); }} onCancel={e => { e.preventDefault(); setSelected(null); }} aria-label="网络估算依据">
      <header><strong>网络估算依据</strong><button type="button" onClick={() => setSelected(null)} aria-label="关闭评分依据">×</button></header>
    <div className="network-estimate-body">
      {estimates.filter(s => s.family === selected).map(s => <div className="network-estimate-family" key={s.family}><b>IPv{s.family === "ipv4" ? "4" : "6"} · {query.isError ? "测速读取失败" : query.isPending ? "加载中" : s.reason}{s.score != null && !query.isError ? ` · ${s.score}/100` : ""}</b>
        <span>{s.probe?.taskName ?? "未配置对应地址族探针"} · 延迟 {s.probe?.lastValue == null ? "—" : `${Math.round(s.probe.lastValue)} ms`} · 探测失败 {s.probe?.loss == null ? "—" : `${s.probe.loss.toFixed(1)}%`}</span>
        {s.testedAt && <><span>deb 下载 {s.download?.status === "ok" ? `${s.download.mbps?.toFixed(1)} Mbps` : s.download?.status === "no_response" ? "无响应" : "—"} · 上传 {s.upload?.status === "ok" ? `${s.upload.mbps?.toFixed(1)} Mbps` : s.upload?.status === "no_response" ? "无响应" : "—"}</span><span>测速：{new Date(s.testedAt).toLocaleString("zh-CN")}</span></>}
        {s.score != null && <span>计分：延迟 {s.latency} ＋ 失败率 {s.loss} ＋ 带宽 {s.speed?.toFixed(1)}；÷60×100</span>}
      </div>)}
      <p>AIM 规则适配估算 v0.1；带宽按下载 70% / 上传 30%，100 Mbps 以上同档。结合当前探针线路与 deb 测速，非同路径实测评分；未计抖动和负载延迟。24 小时后标较旧，72 小时后不计分。</p>
    </div>
    </dialog>, document.body)}
  </>;
}
