import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { RefreshCw } from "lucide-react";
import { cfsmGet } from "@/services/cfsm/http";
import { getServerApiBase } from "@/services/api";
import { InstancePanel } from "./InstancePanel";
import { IperfTrendChart } from "./IperfTrendChart";
import { CHART_PALETTE } from "./chartShared";

const ResultSchema = z.object({
  run_id: z.string(), server_id: z.string(), source: z.string(),
  family: z.enum(["ipv4", "ipv6"]), direction: z.enum(["download", "upload"]),
  tested_at: z.number(), duration_seconds: z.number(), port: z.number(),
  status: z.enum(["ok", "no_response", "failed"]),
  mbps: z.number().nullable(), retransmits: z.number().nullable(), error: z.string().nullable(),
});
type Result = z.infer<typeof ResultSchema>;
export type IperfResult = Result;
const HistorySchema = z.object({ rows: z.array(ResultSchema), page: z.number(), page_size: z.number(), total_runs: z.number() });
type Run = { id: string; time: number; source: string; duration: number; port: number; results: Map<string, Result> };

const LANES = [
  { key: "ipv4-download", label: "IPv4 下载", color: CHART_PALETTE.cpu },
  { key: "ipv4-upload", label: "IPv4 上传", color: CHART_PALETTE.success },
  { key: "ipv6-download", label: "IPv6 下载", color: CHART_PALETTE.memory },
  { key: "ipv6-upload", label: "IPv6 上传", color: CHART_PALETTE.warning },
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
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<z.infer<typeof HistorySchema> | null>(null);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    cfsmGet(`/api/iperf/results?${new URLSearchParams({ id: uuid })}`,
      z.array(ResultSchema), { base: getServerApiBase(uuid) })
      .then((data) => { if (active) { setRows(data); setState("ready"); } })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [uuid, revision]);

  useEffect(() => {
    let active = true;
    cfsmGet(`/api/iperf/results?${new URLSearchParams({ id: uuid, view: "history", page: String(page), page_size: "5" })}`,
      HistorySchema, { base: getServerApiBase(uuid) })
      .then((data) => { if (active) { setHistory(data); setHistoryState("ready"); } })
      .catch(() => { if (active) setHistoryState("error"); });
    return () => { active = false; };
  }, [uuid, page, revision]);

  const runs = useMemo(() => groupRuns(rows).slice(0, count), [rows, count]);
  const oldestFirst = [...runs].reverse();
  const detailRuns = useMemo(() => groupRuns(history?.rows ?? []), [history]);
  const totalPages = Math.max(1, Math.ceil((history?.total_runs ?? 0) / 5));
  const changePage = (next: number) => { setHistoryState("loading"); setPage(next); };

  return <InstancePanel title="iperf3 测速历史" className="iperf-history-panel instance-chart-panel"
    description="从 deb 发起的公网 TCP 单流测试；每个点代表一次测试，下载、上传均以 deb 为视角。"
    aside={<button type="button" className="instance-toggle-button" disabled={state === "loading"} onClick={() => { setState("loading"); setHistoryState("loading"); setRevision((n) => n + 1); }}>
      <RefreshCw size={14} aria-hidden />刷新
    </button>}>
    {state === "loading" ? <div className="instance-empty">加载测速历史…</div> :
      state === "error" ? <div className="instance-empty">测速历史暂不可用，请稍后重试。</div> :
      runs.length === 0 ? <div className="instance-empty">暂无测速历史。可在 CFSM 管理后台的“测速”页手动发起。</div> : <>
        <div className="iperf-history-grid">
          {LANES.map((lane) => <IperfTrendChart key={lane.key} label={lane.label} color={lane.color}
            points={oldestFirst.map((run) => ({ time: run.time, result: run.results.get(lane.key) }))} />)}
        </div>
        <div className="iperf-history-detail-head"><strong>测试明细</strong><span>共 {history?.total_runs ?? 0} 次 · 每页 5 次</span></div>
        {historyState === "error" ? <div className="instance-empty">明细暂不可用，请点击刷新重试。</div> : <>
        <div className="iperf-history-table-wrap" aria-busy={historyState === "loading"}><table className="iperf-history-table">
          <thead><tr><th>测试时间</th><th>条件</th>{LANES.map((lane) => <th key={lane.key}>{lane.label}</th>)}</tr></thead>
          <tbody>{detailRuns.map((run) => <tr key={run.id}>
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
        <div className="iperf-history-pagination">
          <button type="button" className="instance-toggle-button" disabled={historyState === "loading" || (history?.page ?? 1) <= 1} onClick={() => changePage((history?.page ?? 1) - 1)}>上一页</button>
          <span aria-live="polite">{historyState === "loading" ? "加载中…" : `第 ${history?.page ?? 1} / ${totalPages} 页`}</span>
          <button type="button" className="instance-toggle-button" disabled={historyState === "loading" || (history?.page ?? 1) >= totalPages} onClick={() => changePage((history?.page ?? 1) + 1)}>下一页</button>
        </div></>}
        <p className="iperf-history-note">折线展示最近 {runs.length} 次测试的变化，悬浮或触摸可查看测试时间与重传次数。失败记录形成断点；TCP 重传次数不等于物理丢包率。</p>
      </>}
  </InstancePanel>;
}
