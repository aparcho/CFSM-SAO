import { describe,expect,it } from "vitest";
import { aimPoints,estimateNetwork,type EstimateResult } from "../networkEstimate";
const now=2e12;
const probe=[{taskName:"移动V4",lastValue:74,loss:0}];
const rows:EstimateResult[]=[{run_id:"a",family:"ipv4",direction:"download",tested_at:now-1000,status:"ok",mbps:200},{run_id:"a",family:"ipv4",direction:"upload",tested_at:now-1000,status:"ok",mbps:200}];
describe("网络估算展示版",()=>{
 it("AIM 等值进入右区间，毫秒与比例分别换算",()=>{ expect(aimPoints(50,[10,20,50,100,500],[20,10,5,0,-10,-20])).toBe(0); expect(estimateNetwork("ipv4",probe,rows,now,false).score).toBe(67); expect(estimateNetwork("ipv4",[{...probe[0],loss:1}],rows,now,false).score).toBe(58); });
 it("不回退旧成功掩盖最新失败，也不混用不同批次",()=>{const failed={...rows[0],run_id:"b",tested_at:now,status:"failed" as const,mbps:null}; expect(estimateNetwork("ipv4",probe,[...rows,failed,{...rows[1],run_id:"b",tested_at:now}],now,false).reason).toBe("测速失败"); expect(estimateNetwork("ipv4",probe,[...rows,failed],now,false).reason).toBe("测速不完整");});
 it("缺项、离线、过期及地址族不匹配不造分",()=>{expect(estimateNetwork("ipv6",probe,rows,now,false).score).toBeNull();expect(estimateNetwork("ipv4",probe,rows,now,true).score).toBeNull();expect(estimateNetwork("ipv4",probe,rows,now+73*3600_000,false).score).toBeNull();expect(estimateNetwork("ipv4",[{...probe[0],loss:null}],rows,now,false).score).toBeNull();});
 it("完整无响应记录计入低速，不挑选表现最好的运营商",()=>{expect(estimateNetwork("ipv4",probe,rows.map(r=>({...r,status:"no_response",mbps:null})),now,false).score).toBe(17);expect(estimateNetwork("ipv4",[...probe,{taskName:"电信V4",lastValue:5,loss:0}],rows,now,false).score).toBe(67);});
});
