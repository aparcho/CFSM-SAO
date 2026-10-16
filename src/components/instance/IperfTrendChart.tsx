import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { usePreferences } from "@/hooks/usePreferences";
import { ChartTooltip } from "./ChartParts";
import { buildChartTooltipHooks, formatChartCoverageTime, getAxisColors, useResponsiveChartSize, type ChartTooltipState } from "./chartShared";
import type { IperfResult } from "./IperfHistory";

export function IperfTrendChart({ label, color, points }: {
  label: string;
  color: string;
  points: Array<{ time: number; result?: IperfResult }>;
}) {
  const { resolvedAppearance } = usePreferences();
  const { w, h, ref } = useResponsiveChartSize("grid");
  const [tooltip, setTooltip] = useState<ChartTooltipState>({ show: false, left: 0, top: 0, rows: [], time: "" });
  const data = useMemo<uPlot.AlignedData>(() => [
    points.map((point) => point.time / 1000),
    points.map(({ result }) => result?.status === "ok" ? result.mbps : null),
  ], [points]);
  const dataRef = useRef(data);
  const pointsRef = useRef(points);
  useLayoutEffect(() => { dataRef.current = data; pointsRef.current = points; }, [data, points]);
  const options = useMemo<uPlot.Options>(() => {
    const { grid, text } = getAxisColors(resolvedAppearance === "dark");
    const times = data[0];
    const start = times[0];
    const end = times[times.length - 1];
    const padding = Math.max(60, (end - start) * 0.05);
    const upper = Math.max(1, ...data[1].map((value) => value ?? 0)) * 1.12;
    const hooks = buildChartTooltipHooks({
      dataRef, rangeHours: 24, estimatedWidth: 220, setTooltip,
      buildRows: (index) => {
        const result = pointsRef.current[index]?.result;
        const value = !result ? "未记录" : result.status === "ok" ? `${result.mbps?.toFixed(2)} Mbps` : result.status === "no_response" ? "无响应" : "失败";
        return [
          { label, value, color },
          ...(result?.status === "ok" ? [{ label: "TCP 重传", value: `${result.retransmits ?? "未知"} 次`, color }] : []),
        ];
      },
    });
    return {
      width: w, height: h, padding: [8, 12, 10, 2],
      legend: { show: false }, cursor: { drag: { x: true, y: false } },
      scales: { x: { time: true, auto: false, range: () => [start - padding, end + padding] }, y: { auto: false, range: () => [0, upper] } },
      axes: [
        { stroke: text, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, size: 42, space: 88,
          values: (_self, splits) => splits.map((time) => formatChartCoverageTime(time).replace(" ", "\n")) },
        { stroke: text, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, size: 84,
          values: (_self, splits) => splits.map((value) => `${value < 10 ? value.toFixed(1) : Math.round(value)} Mbps`) },
      ],
      series: [{ label: "time" }, { label, stroke: color, fill: `${color}22`, width: 1.6, spanGaps: false, points: { show: true, size: 5 } }],
      hooks: { init: [(u) => { u.root.setAttribute("role", "img"); u.root.setAttribute("aria-label", `${label}测速历史折线图`); }, hooks.onInit], destroy: [hooks.onDestroy], setCursor: [hooks.onSetCursor] },
    };
  }, [color, data, h, label, resolvedAppearance, w]);
  const latest = points[points.length - 1]?.result;
  const value = latest?.status === "ok" ? `${latest.mbps?.toFixed(2)} Mbps` : latest?.status === "no_response" ? "无响应" : latest?.status === "failed" ? "失败" : "未记录";
  const Icon = label.includes("下载") ? ArrowDown : ArrowUp;
  return <div className="instance-chart-card" style={{ "--chart-accent": color } as CSSProperties}>
    <header className="instance-chart-card-head">
      <div className="instance-panel-subhead"><Icon size={13} /><span>{label}</span></div>
      <div className="instance-series-stats"><span className="tabular">{value}</span><span className="text-(--text-tertiary)">最近一次</span></div>
    </header>
    <div className="instance-uplot-wrap" ref={ref}><UplotReact options={options} data={data} /><ChartTooltip tooltip={tooltip} /></div>
  </div>;
}
