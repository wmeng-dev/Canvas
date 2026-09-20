// C.1/C.2/C.3/C.5 画布：用 @xyflow/react 渲染创意树，节点/边/选中态由 Zustand store 驱动。
// 新节点后自动 fitView；右键节点弹出上下文菜单（发散 / 重新生成）。
// 缩略图（MiniMap）做「快速定位」：拖拽平移 + 滚轮缩放 + 单击跳转。

import { useCallback, useEffect, useRef } from 'react'
import { Background, Controls, MiniMap, ReactFlow, useNodesInitialized, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTreeStore } from '../store/treeStore'

/** 判定"这是拖拽而不是点击"的位移阈值（px） */
const CLICK_DRAG_TOLERANCE = 4

export function CreativeTree() {
  const nodes = useTreeStore((s) => s.nodes)
  const edges = useTreeStore((s) => s.edges)
  const onNodesChange = useTreeStore((s) => s.onNodesChange)
  const onEdgesChange = useTreeStore((s) => s.onEdgesChange)
  const onConnect = useTreeStore((s) => s.onConnect)
  const selectNode = useTreeStore((s) => s.selectNode)
  const openMenu = useTreeStore((s) => s.openMenu)
  const closeMenu = useTreeStore((s) => s.closeMenu)

  const { fitView, setCenter } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const prevCount = useRef(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const downRef = useRef<{ x: number; y: number } | null>(null)

  // 节点数量增加时（生成/新增）重新适配视口，保证新节点可见。
  // ⚠️ 必须先等 nodesInitialized：React Flow 靠 ResizeObserver **异步**量节点尺寸，
  // 尺寸还没量到就 fitView 会失效（视口停在原地 matrix(1,0,0,1,0,0)，缩略图也是空的）。
  // 未就绪时提前 return 且**不推进 prevCount**，等就绪后这次 fitView 仍会补上。
  useEffect(() => {
    if (!nodesInitialized) return
    if (nodes.length > prevCount.current) {
      const id = window.setTimeout(() => void fitView({ duration: 300, padding: 0.25 }), 60)
      prevCount.current = nodes.length
      return () => window.clearTimeout(id)
    }
    prevCount.current = nodes.length
  }, [nodes.length, nodesInitialized, fitView])

  // 记录"在缩略图上按下"的位置：拖拽平移结束后浏览器仍会补发一个 click，
  // 用它把"拖拽"和"单击定位"区分开，否则每次拖完都会被强制跳一次。
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      downRef.current = t && t.closest('.react-flow__minimap') ? { x: e.clientX, y: e.clientY } : null
    }
    el.addEventListener('mousedown', onDown, true) // 捕获阶段才拿得到 minimap 内部的按下
    return () => el.removeEventListener('mousedown', onDown, true)
  }, [])

  /**
   * 单击缩略图 → 视口中心跳到该处。
   * 缩略图 <svg> 的 viewBox 就是**流坐标**（见 @xyflow/react MiniMap 实现），
   * 所以按 视口像素→viewBox 的比例换算即可，不必依赖库的 pointer()。
   */
  const onMinimapClick = useCallback(
    (event: React.MouseEvent<Element>) => {
      const down = downRef.current
      downRef.current = null
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_DRAG_TOLERANCE) return

      const svg = event.currentTarget as SVGSVGElement
      const vb = (svg.getAttribute?.('viewBox') || '').split(/[\s,]+/).map(Number)
      if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return
      const rect = svg.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const [vx, vy, vw, vh] = vb
      const fx = vx + ((event.clientX - rect.left) / rect.width) * vw
      const fy = vy + ((event.clientY - rect.top) / rect.height) * vh
      void setCenter(fx, fy, { duration: 250 })
    },
    [setCenter],
  )

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          closeMenu()
          selectNode(node.id)
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault()
          selectNode(node.id)
          openMenu(node.id, e.clientX, e.clientY)
        }}
        onPaneClick={() => {
          closeMenu()
          selectNode(null)
        }}
        onMoveStart={() => closeMenu()}
        fitView
        // 去掉右下角那个第三方「React Flow」署名链接（.react-flow__attribution），与本产品无关。
        // 注意：@xyflow 官方是希望"隐藏署名即订阅 React Flow Pro"（见 reactflow.dev/remove-attribution），
        // 代码层面 MIT 且该开关是公开 API；如后续要合规，可考虑为上游订阅。
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        {/*
          ⚠️ @xyflow/react v12 的 <MiniMap> 把 pannable / zoomable 默认写成了 false
          （内核 XYMinimap.update 的默认值本是 true），不显式打开的话缩略图只是个"死的缩略图"：
          拖不动、滚不动、点不动 —— 也就是"快速定位不能用"。
        */}
        <MiniMap pannable zoomable onClick={onMinimapClick} />
      </ReactFlow>
    </div>
  )
}
