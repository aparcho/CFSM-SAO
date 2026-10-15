import { describe,expect,it } from 'vitest';
import { bandwidthScore,estimateNetwork,isPeakTime,latencyScore,probeVariation,type EstimateResult } from '../networkEstimate';
const now=Date.parse('2026-10-15T12:00:00+08:00');
const probe=[{taskName:'移动V4',lastValue:74,loss:0,samples:Array.from({length:12},(_,i)=>({time:now-(12-i)*60_000,value:74}))}];
function batch(id:string,time:number,down=200,up=200):EstimateResult[]{return ['download','upload'].map(direction=>({run_id:id,family:'ipv4',direction:direction as 'download'|'upload',tested_at:time,status:'ok',mbps:direction==='download'?down:up}));}
const night=Date.parse('2026-10-14T21:00:00+08:00');
const rows=[...batch('day',now-1000),...batch('night',night)];
describe('网络估算v0.2',()=>{
 it('50–100ms按10ms细分，100Mbps以上继续区分，常见好节点超过67分',()=>{
  expect(latencyScore(55)).toBeGreaterThan(latencyScore(75));
  expect(latencyScore(71)).toBe(latencyScore(79));
  expect(bandwidthScore(1000)).toBeGreaterThan(bandwidthScore(100));
  expect(estimateNetwork('ipv4',probe,rows,now,false).score).toBeGreaterThan(67);
 });
 it('晚高峰使用北京时间，70%对30%，不同测试次数不会改变时段权重',()=>{
  expect(isPeakTime(Date.parse('2026-10-14T20:00:00+08:00'))).toBe(true);
  expect(isPeakTime(Date.parse('2026-10-14T23:00:00+08:00'))).toBe(false);
  const poor=[...batch('night',night,2,2),...batch('day',now-1000,1000,1000)];
  const s=estimateNetwork('ipv4',probe,poor,now,false);
  expect(s.peakWeight).toBe(0.7);
  expect(s.speed).toBeCloseTo(bandwidthScore(2)*0.7+bandwidthScore(1000)*0.3);
  const reversed=estimateNetwork('ipv4',probe,[...batch('night',night,1000,1000),...batch('day',now-1000,2,2)],now,false);
  expect(reversed.score!).toBeGreaterThan(s.score!);
  expect(estimateNetwork('ipv4',probe,[...poor,...batch('day-repeat',now-2000,1000,1000)],now,false).score).toBe(s.score);
 });
 it('波动越大分数越低，缺项不当0，失败和空档不跨越计算',()=>{
  const rough={...probe[0],samples:probe[0].samples.map((r,i)=>({...r,value:i%2?120:40}))};
  expect(probeVariation(rough,now).variationMs).toBe(80);
  const stable={...rough,samples:rough.samples.map(r=>({...r,value:80}))};
  expect(estimateNetwork('ipv4',[rough],rows,now,false).score!).toBeLessThan(estimateNetwork('ipv4',[stable],rows,now,false).score!);
  const broken={...probe[0],samples:probe[0].samples.slice(0,6),emptyTimes:[probe[0].samples[2].time]};
  expect(probeVariation(broken,now).variationMs).toBeNull();
  const short=estimateNetwork('ipv4',[{...probe[0],samples:[]}],rows,now,false);
  expect(short.variation).toBeNull();expect(short.reason).toContain('波动样本不足');
 });
 it('缺少晚高峰明确暂估，离线、过期、地址族和最新失败不造分',()=>{
  expect(estimateNetwork('ipv4',probe,batch('day',now-1000),now,false).reason).toContain('暂无晚高峰样本');
  expect(estimateNetwork('ipv6',probe,rows,now,false).score).toBeNull();
  expect(estimateNetwork('ipv4',probe,rows,now,true).score).toBeNull();
  expect(estimateNetwork('ipv4',probe,rows,now+73*3600_000,false).score).toBeNull();
  expect(estimateNetwork('ipv4',[{...probe[0],loss:null}],rows,now,false).score).toBeNull();
  const failed={...rows[0],run_id:'latest',tested_at:now,status:'failed' as const,mbps:null};
  expect(estimateNetwork('ipv4',probe,[...rows,failed,{...failed,direction:'upload'}],now,false).reason).toBe('测速失败');
  expect(estimateNetwork('ipv4',probe,[...rows,failed],now,false).reason).toBe('测速不完整');
 });
 it('完整无响应不能被旧高速掩盖，不挑分数更高的运营商，全失败为0',()=>{
  const unreachable=batch('latest',now).map(r=>({...r,status:'no_response' as const,mbps:null}));
  expect(estimateNetwork('ipv4',probe,[...rows,...unreachable],now,false).speed).toBe(0);
  expect(estimateNetwork('ipv4',[...probe,{taskName:'电信V4',lastValue:5,loss:0}],rows,now,false).score).toBe(estimateNetwork('ipv4',probe,rows,now,false).score);
  expect(estimateNetwork('ipv4',[{...probe[0],lastValue:null,loss:100}],rows,now,false).score).toBe(0);
 });
});

it('72小时边界不拆批、未来记录不参与，失败率连续扣分且分数不越界',()=>{
 const edge=batch('edge',now-72*3600_000-1000);edge[1].tested_at=now-72*3600_000+1000;
 expect(estimateNetwork('ipv4',probe,edge,now,false).score).not.toBeNull();
 const future=batch('future',now+120_000,2000,2000);
 expect(estimateNetwork('ipv4',probe,[...rows,...future],now,false).score).toBe(estimateNetwork('ipv4',probe,rows,now,false).score);
 const a=estimateNetwork('ipv4',[{...probe[0],loss:0.8}],rows,now,false);
 const b=estimateNetwork('ipv4',[{...probe[0],loss:2.2}],rows,now,false);
 expect(a.score!).toBeGreaterThan(b.score!);
 for(const ms of [0,50,60,80,100,150,300,500,1000]){
  const score=estimateNetwork('ipv4',[{...probe[0],lastValue:ms,samples:[]}],rows,now,false).score!;
  expect(score).toBeGreaterThanOrEqual(0);expect(score).toBeLessThanOrEqual(100);
 }
});
