/**
 * 文档图谱独立窗口(V3 ①,hash 路由 #/graph,显示菜单进入):
 * 全库文档为节点、[[双链]] 为边的力导向图(d3-force + SVG + d3-zoom)。
 * - 数据:readAllDocs 全文 → parseWikiOut 出链 → resolveWikiTarget 归一(与编辑器
 *   点击跳转同一解析),失效目标不画边;度数 = 出 + 入(去重后),决定节点大小
 * - 视觉色全部走 design token(var(--primary)/var(--ring)/…),主题跟随自动生效
 * - 点击节点 → emit `yz-graph-open`(tauri)/ CustomEvent(浏览器 E2E)→ 主窗打开
 * - d3 经 React.lazy 懒加载(独立 chunk),主窗口 bundle 不背图谱依赖
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  drag,
  select,
  zoom,
  zoomIdentity,
  type D3DragEvent,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type ZoomBehavior,
  type ZoomTransform,
} from "d3";
import { RefreshCw, Maximize2 } from "lucide-react";
import { kbBackend, isTauriEnv } from "./kb/backend";
import { parseWikiOut } from "./kb/backlinks";
import { resolveWikiTarget } from "./kb/wiki-refs";
import { useSettings } from "./settings";
import { Hint } from "./components/hint";

interface GraphNode extends SimulationNodeDatum {
  path: string;
  name: string;
  /** 出 + 入链数(同源同目标去重) */
  degree: number;
}

type GraphEdge = SimulationLinkDatum<GraphNode>;

type Phase = "loading" | "nolib" | "nodocs" | "ready" | "error";

const nodeR = (d: GraphNode): number => 5 + Math.sqrt(d.degree) * 2.4;

export function GraphWindow() {
  useSettings(); // 只为挂主题(与主窗/设置窗的 yz-settings 广播同步)

  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; current: string | null } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<GraphNode, GraphEdge> | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const recent = await kbBackend.getRecent();
      if (!recent.last) {
        setPhase("nolib");
        return;
      }
      const docs = await kbBackend.readAllDocs(recent.last);
      if (!docs.length) {
        setPhase("nodocs");
        return;
      }
      const wikiDocs = docs.map((d) => ({
        path: d.path,
        name: d.path.split("/").pop()!.replace(/\.md$/i, ""),
      }));
      const degree = new Map(docs.map((d) => [d.path, 0]));
      const seen = new Set<string>();
      const edges: { source: string; target: string }[] = [];
      for (const d of docs) {
        for (const link of parseWikiOut(d.content)) {
          const t = resolveWikiTarget(wikiDocs, link.target);
          // 失效目标不画;自链无意义;同源同目标去重为一条边
          if (!t || t === d.path) continue;
          const key = d.path + " " + t;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ source: d.path, target: t });
          degree.set(d.path, (degree.get(d.path) ?? 0) + 1);
          degree.set(t, (degree.get(t) ?? 0) + 1);
        }
      }
      setData({
        nodes: wikiDocs.map((d) => ({ ...d, degree: degree.get(d.path) ?? 0 })),
        edges,
        current: recent.lastDoc ?? null,
      });
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 点击节点 → 主窗打开:tauri 走全局事件;浏览器派生 CustomEvent(E2E 断言用)
  const openFromGraph = useCallback((rel: string) => {
    if (isTauriEnv()) {
      void import("@tauri-apps/api/event").then(({ emit }) => emit("yz-graph-open", rel));
    } else {
      window.dispatchEvent(new CustomEvent("yz-graph-open", { detail: rel }));
    }
  }, []);

  // 视野适配(初始收敛后自动一次 + 「适应窗口」按钮):对当前节点坐标重算 transform
  const fitView = useCallback(() => {
    const z = zoomRef.current;
    const svgEl = svgRef.current;
    const nodes = simRef.current?.nodes();
    if (!z || !svgEl || !nodes?.length) return;
    const rect = svgEl.getBoundingClientRect();
    const W = rect.width || 960;
    const H = rect.height || 640;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const r = nodeR(n) + 40; // 半径 + 文字留白
      minX = Math.min(minX, (n.x ?? 0) - r);
      minY = Math.min(minY, (n.y ?? 0) - r);
      maxX = Math.max(maxX, (n.x ?? 0) + r);
      maxY = Math.max(maxY, (n.y ?? 0) + r);
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const k = Math.max(0.15, Math.min((W - 48) / bw, (H - 48) / bh, 1.6));
    const t = zoomIdentity
      .translate(W / 2 - k * ((minX + maxX) / 2), H / 2 - k * ((minY + maxY) / 2))
      .scale(k);
    select(svgEl).transition().duration(300).call(z.transform, t);
  }, []);

  useEffect(() => {
    if (phase !== "ready" || !data || !svgRef.current) return;
    const svgEl = svgRef.current;
    const svg = select(svgEl);
    const canvas = svg.select<SVGGElement>("g.yz-graph-canvas");
    // StrictMode 双挂载会复用旧 DOM(join 后再 append 会重复元素),先清场
    canvas.selectAll("*").remove();
    const rect = svgEl.getBoundingClientRect();
    const W = rect.width || 960;
    const H = rect.height || 640;

    const nodes = data.nodes.map((n) => ({ ...n }));
    const edges = data.edges.map((e) => ({ ...e }));

    const gEdges = canvas.append("g").attr("class", "yz-graph-edges");
    const gNodes = canvas.append("g").attr("class", "yz-graph-nodes");

    const linkSel = gEdges
      .selectAll<SVGLineElement, GraphEdge>("line")
      .data(edges)
      .join("line")
      .attr("stroke", "var(--primary)")
      .attr("stroke-opacity", 0.32)
      .attr("stroke-width", 1);

    const nodeSel = gNodes
      .selectAll<SVGGElement, GraphNode>("g.yz-graph-node")
      .data(nodes, (d) => d.path)
      .join((enter) => {
        const g = enter.append("g").attr("class", "yz-graph-node");
        g.append("circle")
          .attr("class", "yz-graph-node-ring")
          .attr("fill", "none")
          .attr("stroke-width", 1.5);
        g.append("circle").attr("class", "yz-graph-node-dot");
        g.append("text")
          .attr("class", "yz-graph-node-label")
          .attr("text-anchor", "middle")
          .attr("font-size", 11)
          // 文字描边与底同色,拉远/重叠时不糊成一片
          .attr("paint-order", "stroke")
          .attr("stroke", "var(--background)")
          .attr("stroke-width", 3);
        return g;
      });

    nodeSel
      .select("circle.yz-graph-node-dot")
      .attr("r", nodeR)
      .attr("fill", (d) => (d.degree > 0 ? "var(--primary)" : "var(--muted-foreground)"))
      .attr("fill-opacity", (d) => (d.degree > 0 ? 1 : 0.5))
      .attr("stroke", "var(--background)")
      .attr("stroke-width", 1);
    // 当前文档高亮环(主窗 lastDoc 的打开时快照)
    nodeSel
      .select("circle.yz-graph-node-ring")
      .attr("r", (d) => (d.path === data.current ? nodeR(d) + 4 : 0))
      .attr("stroke", (d) => (d.path === data.current ? "var(--ring)" : "none"));
    nodeSel
      .select("text.yz-graph-node-label")
      .attr("y", (d) => nodeR(d) + 13)
      .attr("fill", (d) => (d.path === data.current ? "var(--foreground)" : "var(--muted-foreground)"))
      .attr("font-weight", (d) => (d.path === data.current ? 600 : 400))
      .text((d) => d.name);

    const sim = forceSimulation(nodes)
      // 默认 alphaDecay 要 ~300 tick(≈5s)才触发 "end",自动 fitView 等不起,加速收敛
      .alphaDecay(0.05)
      .force(
        "link",
        forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.path)
          .distance(90)
          .strength(0.3),
      )
      .force("charge", forceManyBody().strength(-260))
      .force("collide", forceCollide<GraphNode>().radius((d) => nodeR(d) + 8).iterations(2))
      // 定心只靠 x/y(forceCenter 会与之叠加把图压得更紧)
      .force("x", forceX(W / 2).strength(0.03))
      .force("y", forceY(H / 2).strength(0.045));
    simRef.current = sim;

    let dragMoved = false;
    nodeSel
      .call(
        drag<SVGGElement, GraphNode>()
          .on("start", (ev: D3DragEvent<SVGGElement, GraphNode, GraphNode>, d) => {
            dragMoved = false;
            if (!ev.active) sim.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (ev: D3DragEvent<SVGGElement, GraphNode, GraphNode>, d) => {
            dragMoved = true;
            d.fx = ev.x;
            d.fy = ev.y;
          })
          .on("end", (ev: D3DragEvent<SVGGElement, GraphNode, GraphNode>, d) => {
            if (!ev.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      )
      .on("click", (e: MouseEvent, d) => {
        e.stopPropagation();
        if (dragMoved) return; // 拖拽整理不是打开
        openFromGraph(d.path);
      });

    sim.on("tick", () => {
      linkSel
        .attr("x1", (l) => (l.source as GraphNode).x ?? 0)
        .attr("y1", (l) => (l.source as GraphNode).y ?? 0)
        .attr("x2", (l) => (l.target as GraphNode).x ?? 0)
        .attr("y2", (l) => (l.target as GraphNode).y ?? 0);
      nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });
    // 初始收敛后自动适配视野一次;之后的收敛可能来自用户拖拽,不再抢镜头
    let fitted = false;
    sim.on("end", () => {
      if (!fitted) {
        fitted = true;
        fitView();
      }
    });

    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .filter((event) => {
        const ev = event as MouseEvent;
        // 节点上的按下交给节点拖拽;其余维持默认(滚轮缩放/空白处拖画布)
        if (ev.type === "mousedown" && (ev.target as Element).closest?.(".yz-graph-node")) {
          return false;
        }
        return (!ev.ctrlKey || ev.type === "wheel") && !ev.button;
      })
      .on("zoom", ({ transform }: { transform: ZoomTransform }) => {
        canvas.attr("transform", transform.toString());
        // 拉远后小节点文字互相叠压,整体隐藏
        canvas
          .selectAll<SVGTextElement, unknown>("text")
          .style("visibility", transform.k < 0.7 ? "hidden" : "visible");
      });
    zoomRef.current = z;
    svg.call(z);

    return () => {
      sim.stop();
      svg.on(".zoom", null);
    };
  }, [phase, data, openFromGraph, fitView]);

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      <header className="border-border flex items-center gap-3 border-b px-4 py-2.5">
        <h1 className="text-sm font-semibold">文档图谱</h1>
        {phase === "ready" && data && (
          <span className="text-muted-foreground text-xs">
            {data.nodes.length} 篇文档 · {data.edges.length} 条双链
            {data.edges.length === 0 && " · 尚无 [[双链]],节点为全部文档"}
          </span>
        )}
        {phase === "ready" && (
          <div className="ml-auto flex items-center gap-1">
            <Hint label="适应窗口">
              <button
                type="button"
                aria-label="适应窗口"
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-7 w-7 items-center justify-center rounded-md"
                onClick={fitView}
              >
                <Maximize2 size={14} />
              </button>
            </Hint>
            <Hint label="重新读取">
              <button
                type="button"
                aria-label="重新读取"
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-7 w-7 items-center justify-center rounded-md"
                onClick={() => void load()}
              >
                <RefreshCw size={14} />
              </button>
            </Hint>
          </div>
        )}
      </header>
      <div className="relative min-h-0 flex-1">
        <svg ref={svgRef} className="yz-graph-svg h-full w-full select-none">
          <g className="yz-graph-canvas" />
        </svg>
        {phase !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">
              {phase === "loading" && "读取知识库…"}
              {phase === "nolib" && "尚未打开知识库——先在主窗口打开或新建一个库"}
              {phase === "nodocs" && "知识库中还没有文档"}
              {phase === "error" && "图谱加载失败,请重试"}
            </p>
          </div>
        )}
      </div>
      {phase === "ready" && (
        <footer className="border-border text-muted-foreground border-t px-4 py-1.5 text-xs">
          点击节点在主窗口打开文档 · 拖拽节点整理布局 · 滚轮缩放 · 圆点大小 = 连接数 · 外环 = 当前文档
        </footer>
      )}
    </div>
  );
}
