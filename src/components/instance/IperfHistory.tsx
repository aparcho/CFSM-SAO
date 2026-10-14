import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { RefreshCw } from "lucide-react";
import { cfsmGet } from "@/services/cfsm/http";
import { getServerApiBase } from "@/services/api";
import { InstancePanel } from "./InstancePanel";

const ResultSchema = z.object({
  run_id: z.string(), server_id: z.string(), source: z.string(),
  family: z.enum(["ipv4", "ipv6"]), direction: z.enum(["download", "upload"]),
  tested_at: z.number(), duration_seconds: z.number(), port: z.number(),
  status: z.enum(["ok", "no_response", "failed"]),
  mbps: z.number().nullable(), retransmits: z.number().nullable(), error: z.string().nullable(),
});
type Result = z.infer<typeof ResultSchema>;
type Run = { id: string; time: number; source: string; duration: number; port: number; results: Map<string, Result> };

const LANES = [
  { key: "ipv4-download", label: "IPv4 下载", color: "#3b82f6" },
  { key: "ipv4-upload", label: "IPv4 上传", color: "#18b87a" },
  { key: "ipv6-download", label: "IPv6 下载", color: "#9b5cf6" },
  { key: "ipv6-upload", label: "IPv6 上传", color: "#e39b27" },
] as const;

function groupRuns(rows: Result[]): Run[] {
  const byId = new Map<string, Run>();
  for (const row of rows) {
    let run = byId.get(row.run_id);
    if (!run) {
      run = { id: row.run_id, time: row.tested_at, source: row.source,
        duration: row.duration_seconds, port: row.port, results: new Map() };
      byId.set(row.run_id, run);
    }
    run.time = Math.max(run.time, row.tested_at);
    run.results.set(`${row.family}-${row.direction}`, row);
  }
  return [...byId.values()].sort((a, b) => b.time - a.time);
}

function valueLabel(row?: Result) {
  if (!row) return "未记录";
  if (row.status === "no_response") return "无响应";
  if (row.status === "failed") return "失败";
  return `${row.mbps?.toFixed(2)} Mbps`;
}

export function IperfHistory({ uuid, count }: { uuid: string; count: number }) {
  const [rows, setRows] = useState<Result[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    cfsmGet(`/api/iperf/results?${new URLSearchParams({ id: uuid })}`,
      z.array(ResultSchema), { base: getServerApiBase(uuid) })
      .then((data) => { if (active) { setRows(data); setState("ready"); } })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [uuid, revision]);

  const runs = useMemo(() => groupRuns(rows).slice(0, count), [rows, count]);
  const oldestFirst = [...runs].reverse();

  return <InstancePanel title="iperf3 测速历史" className="iperf-history-panel"
    description="从 deb 发起的公网 TCP 单流测试。每根柱代表一次测试；下载、上传均以 deb 为视角。"
    aside={<button type="button" className="instance-toggle-button" onClick={() => { setState("loading"); setRevision((n) => n + 1); }}>
      <RefreshCw size={14} aria-hidden />刷新
    </button>}>
    {state === "loading" ? <div className="instance-empty">加载测速历史…</div> :
      state === "error" ? <div className="instance-empty">测速历史暂不可用，请稍后重试。</div> :
      runs.length === 0 ? <div className="instance-empty">暂无测速历史。可在 CFSM 管理后台的“测速”页手动发起。</div> : <>
        <div className="iperf-history-grid">
          {LANES.map((lane) => {
            const values = oldestFirst.map((run) => run.results.get(lane.key));
            const max = Math.max(1, ...values.map((row) => row?.status === "ok" ? row.mbps ?? 0 : 0));
            const latest = runs[0].results.get(lane.key);
            return <div className="iperf-history-card" key={lane.key}>
              <div className="iperf-history-card-head"><strong>{lane.label}</strong><span>{valueLabel(latest)}</span></div>
              <div className="iperf-history-bars" role="img" aria-label={`${lane.label}，最近 ${runs.length} 次测试`}>
                {values.map((row, index) => <div className="iperf-history-bar-slot" key={oldestFirst[index].id}
                  title={`${new Date(oldestFirst[index].time).toLocaleString("zh-CN")} · ${valueLabel(row)}${row?.status === "ok" ? ` · TCP 重传 ${row.retransmits} 次` : row?.error ? ` · ${row.error}` : ""}`}>
                  <div className={`iperf-history-bar${row?.status !== "ok" ? " is-missing" : ""}`}
                    style={{ height: row?.status === "ok" ? `${Math.max(3, (row.mbps ?? 0) / max * 100)}%` : "3px",
                      backgroundColor: row?.status === "ok" ? lane.color : undefined }} />
                </div>)}
              </div>
              <div className="iperf-history-axis"><span>较早</span><span>最近</span></div>
            </div>;
          })}
        </div>
        <div className="iperf-history-table-wrap"><table className="iperf-history-table">
          <thead><tr><th>测试时间</th><th>条件</th>{LANES.map((lane) => <th key={lane.key}>{lane.label}</th>)}</tr></thead>
          <tbody>{runs.map((run) => <tr key={run.id}>
            <td>{new Date(run.time).toLocaleString("zh-CN")}</td>
            <td>{run.source} · {run.duration} 秒 · {run.port}</td>
            {LANES.map((lane) => {
              const row = run.results.get(lane.key);
              return <td key={lane.key} title={row?.error ?? undefined}>
                <strong>{valueLabel(row)}</strong>{row?.status === "ok" && <small>TCP 重传 {row.retransmits} 次</small>}
              </td>;
            })}
          </tr>)}</tbody>
        </table></div>
        <p className="iperf-history-note">仅显示接口保留的最近记录；不同测试时长或网络路径的结果不宜直接比较。TCP 重传次数不等于物理丢包率。</p>
      </>}
  </InstancePanel>;
}
