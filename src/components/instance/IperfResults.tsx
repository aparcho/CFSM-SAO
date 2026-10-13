import { useEffect, useState } from "react";
import { z } from "zod";
import { cfsmGet } from "@/services/cfsm/http";
import { getServerApiBase } from "@/services/api";
import { InstancePanel } from "./InstancePanel";

const ResultSchema = z.object({
  run_id: z.string(), server_id: z.string(), source: z.string(),
  family: z.enum(["ipv4", "ipv6"]), direction: z.enum(["upload", "download"]),
  tested_at: z.number(), duration_seconds: z.number(), port: z.number(),
  status: z.enum(["ok", "no_response", "failed"]),
  mbps: z.number().nullable(), retransmits: z.number().nullable(),
  error: z.string().nullable(),
});
type Result = z.infer<typeof ResultSchema>;

export function IperfResults({ uuid }: { uuid: string }) {
  const [rows, setRows] = useState<Result[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    setState("loading");
    cfsmGet(`/api/iperf/results?${new URLSearchParams({ id: uuid })}`,
      z.array(ResultSchema), { base: getServerApiBase(uuid) })
      .then(data => { if (active) { setRows(data); setState("ready"); } })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [uuid]);

  const latest = new Map<string, Result>();
  for (const row of rows) {
    const key = `${row.family}-${row.direction}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  return <InstancePanel title="iperf3 测速" description="从 deb 发起的公网 TCP 单流测试；数值为 Mbps（TCP 重传次数）。">
    {state === "loading" ? <p>加载测速结果…</p> : state === "error" ?
      <p>测速结果暂不可用。</p> : rows.length === 0 ?
      <p>暂无测速记录。</p> : <div className="instance-info-groups">
        {(["ipv4", "ipv6"] as const).map(family => <div className="instance-info-group" key={family}>
          <div className="instance-info-group-title">{family.toUpperCase()}</div>
          {(["download", "upload"] as const).map(direction => {
            const row = latest.get(`${family}-${direction}`);
            const label = direction === "download" ? "deb 下载" : "deb 上传";
            const value = !row ? "未测试" : row.status === "ok" ?
              `${row.mbps?.toFixed(2)} Mbps（${row.retransmits} 次）` :
              row.status === "no_response" ? "无响应" : "失败";
            return <div className="instance-info-item" key={direction}>
              <span className="instance-info-label">{label}</span>
              <span className="instance-info-value" title={row?.error ?? undefined}>{value}</span>
            </div>;
          })}
        </div>)}
        <div className="instance-info-group">
          <div className="instance-info-group-title">最近测试</div>
          <div className="instance-info-item">
            <span className="instance-info-label">时间</span>
            <span className="instance-info-value">{new Date(rows[0].tested_at).toLocaleString("zh-CN")}</span>
          </div>
          <div className="instance-info-item">
            <span className="instance-info-label">条件</span>
            <span className="instance-info-value">{rows[0].source} · TCP 单流 · {rows[0].duration_seconds} 秒 · 端口 {rows[0].port}</span>
          </div>
        </div>
      </div>}
  </InstancePanel>;
}
