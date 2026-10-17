import { describe,expect,it } from 'vitest';
import { bandwidthScore,estimateNetwork,isPeakTime,latencyScore,probeVariation,type EstimateResult } from '../networkEstimate';
const now=Date.parse('2026-10-15T12:00:00+08:00');
const probe=[{taskName:'移动V4',lastValue:74,loss:0,samples:Array.from({length:12},(_,i)=>({time:now-(12-i)*60_000,value:74,loss:0}))}];
function batch(id:string,time:number,down=200,up=200):EstimateResult[]{return ['download','upload'].map(direction=>({run_id:id,family:'ipv4',direction:direction as 'download'|'upload',tested_at:time,status:'ok',mbps:direction==='download'?down:up}));}
const night=Date.parse('2026-10-14T21:00:00+08:00');
const rows=[...batch('day',now-1000),...batch('night',night)];
describe('当前网络估算v0.3',()=>{
 it('50–100ms按10ms细分，100Mbps以上继续区分，常见好节点超过67分',()=>{
  expect(latencyScore(55)).toBeGreaterThan(latencyScore(75));
  expect(latencyScore(71)).toBe(latencyScore(79));
  expect(bandwidthScore(1000)).toBeGreaterThan(bandwidthScore(100));
  expect(estimateNetwork('ipv4',probe,rows,now,false).score).toBeGreaterThan(67);
 });
 it('当前带宽只跟随最近一次测速，旧晚高峰和手工测试次数不改变当前结果',()=>{
  expect(isPeakTime(Date.parse('2026-10-14T20:00:00+08:00'))).toBe(true);
  const history=[...batch('night',night,2,2),...batch('day',now-1000,1000,1000)];
  const s=estimateNetwork('ipv4',probe,history,now,false);
  expect(s.peakWeight).toBe(0);expect(s.speed).toBeCloseTo(bandwidthScore(1000));
  expect(s.peak?.download).toBe(2); // 历史保留参考
  expect(estimateNetwork('ipv4',probe,[...history,...batch('old-repeat',now-2000,2,2)],now,false).score).toBe(s.score);
  const dropped=estimateNetwork('ipv4',probe,[...history,...batch('latest',now,0.5,0.5)],now,false);
  expect(dropped.speed).toBeCloseTo(bandwidthScore(0.5));expect(dropped.score!).toBeLessThan(s.score!);
 });
 it('波动越大分数越低，缺项不当0，失败和空档不跨越计算',()=>{
  const rough={...probe[0],samples:probe[0].samples.map((r,i)=>({...r,value:i%2?120:40}))};
  expect(probeVariation(rough,now).variationMs).toBe(80);
  const stable={...rough,samples:rough.samples.map(r=>({...r,value:80}))};
  expect(estimateNetwork('ipv4',[rough],rows,now,false).score!).toBeLessThan(estimateNetwork('ipv4',[stable],rows,now,false).score!);
  const broken={...probe[0],samples:probe[0].samples.slice(-6),emptyTimes:[probe[0].samples[8].time]};
  expect(probeVariation(broken,now).variationMs).toBeNull();
  const short=estimateNetwork('ipv4',[{...probe[0],samples:[]}],rows,now,false);
  expect(short.variation).toBeNull();expect(short.reason).toContain('波动样本不足');
 });
 it('无需历史晚高峰，离线、过期、地址族和最新失败不造分',()=>{
  expect(estimateNetwork('ipv4',probe,batch('day',now-1000),now,false).reason).not.toContain('晚高峰');
  expect(estimateNetwork('ipv6',probe,rows,now,false).score).toBeNull();
  expect(estimateNetwork('ipv4',probe,rows,now,true).score).toBeNull();
  expect(estimateNetwork('ipv4',probe,rows,now+73*3600_000,false).score).toBeNull();
  expect(estimateNetwork('ipv4',[{...probe[0],samples:[],loss:null}],rows,now,false).score).toBeNull();
  const failed={...rows[0],run_id:'latest',tested_at:now,status:'failed' as const,mbps:null};
  expect(estimateNetwork('ipv4',probe,[...rows,failed,{...failed,direction:'upload'}],now,false).reason).toBe('测速失败');
  expect(estimateNetwork('ipv4',probe,[...rows,failed],now,false).reason).toBe('测速不完整');
 });
 it('完整无响应不能被旧高速掩盖，不挑分数更高的运营商，全失败为0',()=>{
  const unreachable=batch('latest',now).map(r=>({...r,status:'no_response' as const,mbps:null}));
  expect(estimateNetwork('ipv4',probe,[...rows,...unreachable],now,false).speed).toBe(0);
  expect(estimateNetwork('ipv4',[...probe,{taskName:'电信V4',lastValue:5,loss:0}],rows,now,false).score).toBe(estimateNetwork('ipv4',probe,rows,now,false).score);
  expect(estimateNetwork('ipv4',[{...probe[0],samples:[],lastValue:null,loss:100}],rows,now,false).score).toBe(0);
 });
});

it('72小时边界不拆批、未来记录不参与，失败率连续扣分且分数不越界',()=>{
 const edge=batch('edge',now-72*3600_000-1000);edge[1].tested_at=now-72*3600_000+1000;
 expect(estimateNetwork('ipv4',probe,edge,now,false).score).not.toBeNull();
 const future=batch('future',now+120_000,2000,2000);
 expect(estimateNetwork('ipv4',probe,[...rows,...future],now,false).score).toBe(estimateNetwork('ipv4',probe,rows,now,false).score);
 const a=estimateNetwork('ipv4',[{...probe[0],samples:[],loss:0.8}],rows,now,false);
 const b=estimateNetwork('ipv4',[{...probe[0],samples:[],loss:2.2}],rows,now,false);
 expect(a.score!).toBeGreaterThan(b.score!);
 for(const ms of [0,50,60,80,100,150,300,500,1000]){
  const score=estimateNetwork('ipv4',[{...probe[0],lastValue:ms,samples:[]}],rows,now,false).score!;
  expect(score).toBeGreaterThanOrEqual(0);expect(score).toBeLessThanOrEqual(100);
 }
});

 it('延迟和失败率只看近十分钟，旧拥堵不污染当前，旧测速明确标注年龄',()=>{
  const old={time:now-30*60_000,value:500,loss:100};
  const current={...probe[0],lastValue:45,loss:90,samples:[old,...Array.from({length:8},(_,i)=>({time:now-i*60_000,value:45,loss:0}))]};
  const value=estimateNetwork('ipv4',[current],rows,now,false);
  expect(value.metrics?.p95).toBe(45);expect(value.latencyMs).toBe(45);expect(value.loss).toBe(100);
  const aged=estimateNetwork('ipv4',[current],batch('old-speed',now-14*3600_000),now,false);
  expect(aged.speedAgeMs).toBe(14*3600_000);expect(aged.reason).toContain('较早实测参考');
  expect(aged.score).not.toBeNull(); // 不偷偷加测低流量节点
 });

it('重传是小幅辅助项：同速高重传略低，按传输量归一化且最多扣3分',async()=>{
 const {retransmissionCost}=await import('../networkEstimate');
 const withRetrans=(count:number,duration=5)=>batch('latest',now,500,500).map(r=>({...r,duration_seconds:duration,retransmits:count}));
 const clean=estimateNetwork('ipv4',probe,withRetrans(0),now,false);
 const rough=estimateNetwork('ipv4',probe,withRetrans(30000),now,false);
 expect(rough.score!).toBeLessThan(clean.score!);
 expect(clean.score!-rough.score!).toBeLessThanOrEqual(3);
 expect(clean.retransmission?.penalty).toBe(0);
 expect(retransmissionCost(withRetrans(30000)[0])?.perMiB).toBeCloseTo(retransmissionCost(withRetrans(60000,10)[0])!.perMiB);
 const saturated=estimateNetwork('ipv4',probe,withRetrans(1000000000),now,false);
 expect(saturated.retransmission?.penalty).toBeCloseTo(3);
 expect(clean.score!-saturated.score!).toBe(3);
 // 旧数据/未知不能伪装成0重传；低吞吐小样本已经通过带宽扣分，不放大噪声。
 expect(estimateNetwork('ipv4',probe,batch('old',now,500,500),now,false).retransmission).toBeNull();
 expect(retransmissionCost({...withRetrans(57)[0],mbps:0.84})).toBeNull();
});

it('百兆与稳定500Mbps拉开通用评分差距：不按节点名称调分',()=>{
 expect(bandwidthScore(100)).toBe(20);expect(bandwidthScore(200)).toBe(40);expect(bandwidthScore(300)).toBe(60);expect(bandwidthScore(500)).toBe(80);
 const modest=estimateNetwork('ipv4',probe,batch('latest',now,126.7,130.2),now,false);
 const fast=estimateNetwork('ipv4',probe,batch('latest',now,500,200),now,false);
 expect(modest.score!).toBeLessThan(70);expect(fast.score!).toBeGreaterThanOrEqual(80);
 expect(fast.score!-modest.score!).toBeGreaterThanOrEqual(10);
 const perfect=[{...probe[0],lastValue:5,samples:probe[0].samples.map(r=>({...r,value:5}))}];
 expect(estimateNetwork('ipv4',perfect,batch('latest',now,100,100),now,false).score!).toBeLessThan(80);
});
