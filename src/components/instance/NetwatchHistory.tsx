import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { cfsmGet } from '@/services/cfsm/http';
import { getServerApiBase } from '@/services/api';
import { IperfTrendChart } from './IperfTrendChart';
import type { IperfResult } from './IperfHistory';
import { CHART_PALETTE } from './chartShared';
const dataSchema=z.object({mbps:z.number().nullable().optional(),target_bps:z.number().optional(),retransmits:z.number().nullable().optional(),payload_bytes:z.number().nullable().optional(),seconds:z.number().nullable().optional(),tcp_ms:z.number().nullable().optional(),ping_sent:z.number().optional(),ping_received:z.number().optional(),ping_ms:z.array(z.number()).optional()}).passthrough();
const sampleSchema=z.object({id:z.string(),server_id:z.string(),tested_at:z.number(),kind:z.string(),family:z.string(),direction:z.string(),status:z.string(),data:dataSchema});
const regularSchema=z.object({mbps:z.number().nullable(),tested_at:z.number(),status:z.string(),retransmits:z.number().nullable()}).passthrough();
const schema=z.object({node:z.object({enabled:z.number(),iperf_capable:z.number(),reason:z.string().nullable(),last_seen:z.number(),interval_seconds:z.number(),daily_budget_mib:z.number(),payload_bytes:z.number().nullable(),reserved_bytes:z.number().nullable(),budget_day:z.string().nullable()}).nullable(),samples:z.array(sampleSchema),comparisons:z.array(z.object({family:z.string(),direction:z.string(),state:z.string(),label:z.string(),regular:regularSchema.nullable(),sample_count:z.number(),target_mbps:z.number().nullable().optional(),probe_median_mbps:z.number().nullable().optional(),low_count:z.number().optional(),failed_count:z.number().optional(),stale:z.boolean().optional(),confirmation:sampleSchema.nullable().optional()})),server_time:z.number(),hours:z.number()});
const lanes=[{family:'ipv4',direction:'download',label:'IPv4 下载',color:CHART_PALETTE.cpu},{family:'ipv4',direction:'upload',label:'IPv4 上传',color:CHART_PALETTE.success},{family:'ipv6',direction:'download',label:'IPv6 下载',color:CHART_PALETTE.memory},{family:'ipv6',direction:'upload',label:'IPv6 上传',color:CHART_PALETTE.warning}] as const;
const time=(ms:number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(ms);
const number=(value:number|null|undefined)=>value==null?'—':value.toFixed(2);
export function NetwatchHistory({uuid,mode,hours,refreshKey}:{uuid:string;mode:'continuous'|'compare';hours:number;refreshKey:number}){
  const [page,setPage]=useState(1);
  const query=useQuery({queryKey:['netwatch',uuid,hours,refreshKey],queryFn:()=>cfsmGet(`/api/netwatch/results?${new URLSearchParams({id:uuid,hours:String(hours)})}`,schema,{base:getServerApiBase(uuid)}),refetchInterval:15000,retry:1});
  const view=query.data;
  if(query.isPending)return <div className="instance-empty">读取持续探测…</div>;
  if(query.isError)return <div className="instance-empty">持续探测暂时读取失败，15 秒后自动重试。<button className="instance-toggle-button" onClick={()=>query.refetch()}>重试</button></div>;
  if(!view?.node)return <div className="instance-empty">此节点未加入持续探测。可在管理后台“测速 → 持续探测设置”查看已接入节点。</div>;
  const node=view.node;
  const rows=view.samples.filter(s=>s.kind!=='quality'&&s.status!=='tool_error').sort((a,b)=>b.tested_at-a.tested_at);
  const totalPages=Math.max(1,Math.ceil(rows.length/5)),actualPage=Math.min(page,totalPages);
  return <>
    <div className="netwatch-status"><span>{!node.enabled?'持续监测已关闭':view.server_time-node.last_seen>180000?'采集上报中断（不代表线路故障）':`deb 持续监测中 · 每方向约 ${node.interval_seconds/60} 分钟`}</span><span>今日载荷 {number((node.payload_bytes??0)/1048576)} MiB · 预算预留 {number((node.reserved_bytes??0)/1048576)} / {node.daily_budget_mib} MiB</span><span>最近同步 {time(node.last_seen)}</span></div>
    {!node.iperf_capable&&<p className="iperf-history-note">此节点目前仅监测 Ping/TCP：{node.reason}</p>}
    {mode==='compare'?<>
      <p className="iperf-history-note">按同节点、同 IPv4/IPv6、同方向匹配常规测速前后 30 分钟的探测。限速探测与峰值测速不直接计算降速百分比；窗口外结果不强行对比。</p>
      <div className="iperf-history-table-wrap"><table className="iperf-history-table"><thead><tr><th>协议 / 方向</th><th>常规 iperf</th><th>同期持续探测</th><th>限量确认</th><th>验证结果</th></tr></thead><tbody>{view.comparisons.map(c=><tr key={c.family+c.direction}>
        <td>{c.family==='ipv4'?'IPv4':'IPv6'} {c.direction==='download'?'下载':'上传'}</td>
        <td><strong>{c.regular?.status==='ok'?`${number(c.regular.mbps)} Mbps`:c.regular?'失败':'—'}</strong>{c.regular&&<small>{time(c.regular.tested_at)}{c.stale?' · 已超过24小时':''}</small>}</td>
        <td><strong>{number(c.probe_median_mbps)} Mbps</strong><small>目标 {number(c.target_mbps)} Mbps · {c.sample_count} 个同期样本</small>{!!c.sample_count&&<small>低速 {c.low_count??0} · 失败 {c.failed_count??0}</small>}</td>
        <td><strong>{c.confirmation?.status==='ok'?`${number(c.confirmation.data.mbps)} Mbps`:'—'}</strong>{c.confirmation&&<small>{time(c.confirmation.tested_at)} · 上限 {number((c.confirmation.data.target_bps??0)/1e6)} Mbps</small>}</td>
        <td>{c.label}</td>
      </tr>)}</tbody></table></div>
    </>:<>
      <div className="netwatch-quality">{(['ipv4','ipv6'] as const).map(f=>{const q=view.samples.filter(s=>s.kind==='quality'&&s.family===f).sort((a,b)=>b.tested_at-a.tested_at)[0];if(!q)return null;const d=q.data;const loss=d.ping_sent?100*(d.ping_sent-(d.ping_received??0))/d.ping_sent:null;const rtt=d.ping_ms??[];const variation=rtt.length>1?rtt.slice(1).reduce((sum,value,i)=>sum+Math.abs(value-rtt[i]),0)/(rtt.length-1):null;return <span key={f}>{f==='ipv4'?'IPv4':'IPv6'} · TCP {number(d.tcp_ms)} ms · 最近批次 ICMP 未响应 {number(loss)}% · Ping 波动 {number(variation)} ms <small>{time(q.tested_at)} · {d.ping_sent??0} 次 Ping</small></span>})}</div>
      <p className="iperf-history-note">下面折线是限速小样本：接近 2 Mbps 仅说明探测档位可用，不代表最大带宽。较大限量确认单独标注；失败为断点。图内悬浮查看实际探测时间与 TCP 重传。</p>
      <div className="iperf-history-grid">{lanes.map(lane=>{
        const points=rows.filter(s=>s.kind==='sentinel'&&s.family===lane.family&&s.direction===lane.direction).sort((a,b)=>a.tested_at-b.tested_at).map(s=>({time:s.tested_at,result:{run_id:s.id,server_id:s.server_id,source:'deb',family:lane.family,direction:lane.direction,tested_at:s.tested_at,duration_seconds:s.data.seconds??1,port:5202,status:s.status==='ok'?'ok':'failed',mbps:s.data.mbps??null,retransmits:s.data.retransmits??null,error:null} as IperfResult}));
        return points.length?<IperfTrendChart key={lane.family+lane.direction} label={lane.label+' · 限速探测'} color={lane.color} points={points}/>:<div className="instance-empty" key={lane.family+lane.direction}>{lane.label} · 暂无持续探测样本</div>
      })}</div>
      <div className="iperf-history-detail-head"><strong>最近探测明细</strong><span>窗口内 {rows.length} 项 · 每页 5 项</span></div>
      <div className="iperf-history-table-wrap"><table className="iperf-history-table"><thead><tr><th>探测时间</th><th>协议 / 方向</th><th>模式</th><th>速率 / 上限</th><th>TCP 重传</th><th>应用数据</th></tr></thead><tbody>{rows.slice((actualPage-1)*5,actualPage*5).map(s=><tr key={s.id}><td>{time(s.tested_at)}</td><td>{s.family==='ipv4'?'IPv4':'IPv6'} {s.direction==='download'?'下载':'上传'}</td><td>{s.kind==='confirm'?'限量确认':'常规小探测'}</td><td>{s.status==='ok'?number(s.data.mbps):'失败'} / {number((s.data.target_bps??0)/1e6)} Mbps</td><td>{s.data.retransmits??'未知'}</td><td>{s.data.payload_bytes==null?'未知':`${number(s.data.payload_bytes/1024)} KiB`}</td></tr>)}</tbody></table></div>
      <div className="iperf-history-pagination"><button className="instance-toggle-button" disabled={actualPage<=1} onClick={()=>setPage(actualPage-1)}>上一页</button><span>第 {actualPage} / {totalPages} 页</span><button className="instance-toggle-button" disabled={actualPage>=totalPages} onClick={()=>setPage(actualPage+1)}>下一页</button></div>
    </>}
    <p className="iperf-history-note">页面每 15 秒更新。ICMP 未响应与 TCP 重传不是物理丢包率；预算不含完整 TCP/IP、重传与管理开销。持续限速数据不计入原网络评分。</p>
  </>;
}
