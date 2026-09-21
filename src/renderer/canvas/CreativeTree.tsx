// C.1/C.2/C.3/C.5 画布：用 @xyflow/react 渲染创意树，节点/边/选中态由 Zustand store 驱动。
// 新节点后自动 fitView；右键节点弹出上下文菜单（发散 / 重新生成）。
// 缩略图（MiniMap）做「快速定位」：拖拽平移 + 滚轮缩放 + 单击跳转。
// D.7 节点用自定义组件 IdeaNode（结果标题 + 可行性 + 优缺点风险）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react'
import type { NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CreativeNode } from '../store/treeStore'
import { toVisibilityNode, useTreeStore } from '../store/treeStore'
import { IdeaNode } from './IdeaNode'
import { CommentNode } from './CommentNode'
import { TrashBin } from './TrashBin'
import { collectDescendantIds, collectHiddenIds } from '../../shared/tree'

/** 判定"这是拖拽而不是点击"的位移阈值（px） */
const CLICK_DRAG_TOLERANCE = 4

/**
 * 从 React Flow 的拖拽事件里取光标位置。
 * ⚠️ 库把事件类型标成 `MouseEvent | TouchEvent`（触屏拖拽走 TouchEvent），
 * 直接读 `evt.clientX` 过不了类型；触屏取第一个触点即可满足命中判定。
 */
function clientPointOf(evt: { clientX?: number; clientY?: number } | TouchEvent): { x: number; y: number } | null {
  const anyEvt = evt as { clientX?: number; clientY?: number; touches?: TouchList }
  const touch = anyEvt.touches?.[0]
  if (touch) return { x: touch.clientX, y: touch.clientY }
  if (typeof anyEvt.clientX === 'number' && typeof anyEvt.clientY === 'number') {
    return { x: anyEvt.clientX, y: anyEvt.clientY }
  }
  return null
}

/** 兜底重测的最大重试次数与间隔（上界很小，避免长命定时器和库自己的测量抢主线程） */
const MEASURE_RETRY_MAX = 12
const MEASURE_RETRY_INTERVAL = 70

/**
 * ⚠️ nodeTypes 必须定义在组件**外面**（模块级常量）。
 * 放在组件里每次都生成新对象 → React Flow 认为节点类型变了 → 整棵树重新挂载
 * （表现为每次渲染都丢选中态/重测量，且控制台会警告）。
 * 'comment' = 画布自由评论气泡（CommentNode，无 Handle、不参与连线）。
 */
const nodeTypes: NodeTypes = { idea: IdeaNode, comment: CommentNode }

export function CreativeTree() {
  const nodes = useTreeStore((s) => s.nodes)
  const edges = useTreeStore((s) => s.edges)
  const onNodesChange = useTreeStore((s) => s.onNodesChange)
  const onEdgesChange = useTreeStore((s) => s.onEdgesChange)
  const onConnect = useTreeStore((s) => s.onConnect)
  const selectNode = useTreeStore((s) => s.selectNode)
  const openMenu = useTreeStore((s) => s.openMenu)
  const closeMenu = useTreeStore((s) => s.closeMenu)
  // 评论（气泡）：放置模式 + 弹层开关 + 拖拽落点持久化
  const placingComment = useTreeStore((s) => s.placingComment)
  const addCanvasComment = useTreeStore((s) => s.addCanvasComment)
  const updateCommentPosition = useTreeStore((s) => s.updateCommentPosition)
  const setNodePosition = useTreeStore((s) => s.setNodePosition)
  const setActiveCommentNode = useTreeStore((s) => s.setActiveCommentNode)
  const setActiveThread = useTreeStore((s) => s.setActiveThread)
  const togglePlacingComment = useTreeStore((s) => s.togglePlacingComment)
  const toggleCollapse = useTreeStore((s) => s.toggleCollapse)
  // 卡片自定义颜色
  const setNodeColor = useTreeStore((s) => s.setNodeColor)
  // 想法回收站：拖入归档 / 取出
  const archiveNode = useTreeStore((s) => s.archiveNode)
  const [dragOverTrash, setDragOverTrash] = useState(false)

  /** 光标是否落在回收站上（用 DOM 矩形判定：回收站是画布上的固定覆盖层，与画布缩放无关） */
  const hitTrash = useCallback((clientX: number, clientY: number): boolean => {
    const el = document.querySelector('[data-testid="trash-bin"]')
    if (!el) return false
    const r = el.getBoundingClientRect()
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
  }, [])

  /**
   * 收展后的"可见集"：被收起节点的**全部后代**隐藏，通向它们的边也一并去掉
   * （边只要有一端不可见就必须移除，否则 React Flow 会去连一个已不在画布上的节点）。
   * 没有任何收起节点时直接复用原数组 —— 保持引用稳定，别让 React Flow 每帧白重算。
   */
  const { visibleNodes, visibleEdges } = useMemo(() => {
    const collapsible = nodes.map(toVisibilityNode)
    const hidden = collectHiddenIds(collapsible)

    // 每个节点的"直接子节点数"（决定要不要显示收展开关）与"后代总数"（收起时的 +N）
    const childCount = new Map<string, number>()
    for (const c of collapsible) childCount.set(c.id, 0)
    for (const c of collapsible) {
      if (c.parentId) childCount.set(c.parentId, (childCount.get(c.parentId) ?? 0) + 1)
    }
    // ⚠️ 这两个计数在画布这一层算好、随 data 下发给卡片，而不是让卡片自己订阅 store 现算：
    // 卡片的那份订阅覆盖不到"画布拓扑"，两边各算一次就会出现"画布有子节点、卡片却认为没有"的错位。
    const decorate = (list: CreativeNode[]) =>
      list.map((n) => {
        const kids = childCount.get(n.id) ?? 0
        return {
          ...n,
          data: {
            ...n.data,
            childCount: kids,
            descendantCount: kids === 0 ? 0 : collectDescendantIds(collapsible, n.id).length,
            // 与两个计数同理：动作也从画布这一层下发，避免卡片绑到 store 的另一个副本
            onToggleCollapse: toggleCollapse,
            onSetColor: setNodeColor,
          },
        }
      })

    const base = hidden.size === 0 ? nodes : nodes.filter((n) => !hidden.has(n.id))
    return {
      visibleNodes: decorate(base),
      visibleEdges:
        hidden.size === 0
          ? edges
          : edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target)),
    }
  }, [nodes, edges, toggleCollapse, setNodeColor])

  const { fitView, setCenter, screenToFlowPosition } = useReactFlow()
  const store = useStoreApi()
  const nodesInitialized = useNodesInitialized()
  const prevCount = useRef(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const downRef = useRef<{ x: number; y: number } | null>(null)

  /**
   * ⚠️ 兜底重测"还没量到尺寸"的节点 —— 修掉「新节点偶尔不画连线、视口也不 fitView」。
   *
   * 机制（读 @xyflow/react + @xyflow/system 源码，并直接 dump 库内部 store 实测定案，非猜测）：
   *   1. 一条边能不能渲染，取决于两端节点是否"已初始化"：
   *      `isNodeInitialized(n) = !!(n.internals.handleBounds || n.handles?.length) && !!(n.measured.width ...)`。
   *      不满足则 `getEdgePosition()` 返回 null → EdgeWrapper 直接 `return null` → **DOM 里连边元素都没有**。
   *      `useNodesInitialized()` 用的是同一个信号，所以下面那个 fitView 会一起失效（视口停在 scale(1)）。
   *   2. 尺寸只有两种来源：`measured`（元素尺寸）与 `internals.handleBounds`（Handle 位置）。
   *      库自己的 `useResizeObserver` 用 ResizeObserver 观察每个节点元素，回调里是
   *      `updates.set(id, { id, nodeElement, force: true })` —— 也就是**库自己也认为"重测必须 force"**。
   *      但它的 `useNodeObserver` 只在 `[isInitialized, node.hidden]` 变化时 observe，
   *      **这个依赖里没有元素引用**；一旦某次 observe 没覆盖到（元素还没挂上 / 已被换掉），
   *      该节点就**永远停在未初始化**：边不画、fitView 不跑，且改选中态 / 触发 resize 都救不回来
   *      （实测：点完节点边仍为 0；卡住时 dump 库 store 可见 `measured:{}`、`hasHandleBounds:false`）。
   *   3. 并发压力下稳定复现（probe-d7 ×3 并发：12 次里 2~3 次命中）。手动 `updateNodeInternals(force)`
   *      后**当场恢复**（edges 0 → 1），所以"主动重测"就是正确的修法。
   *
   * ⚠️ 为什么不能直接用官方的 `useUpdateNodeInternals()`：它的**元素查找是同步的**（调用当刻就
   * `querySelector`），但把"写 store"放进了 `requestAnimationFrame`。并发压力下 rAF 会被饿死/合并，
   * 于是这个写操作时有时无（第一版修复：单次调用 → 仍 2/12 失败）。
   * 这里直接拿 `useStoreApi()` 的 store，同步调 `updateNodeInternals(map)` —— 与库自身
   * ResizeObserver 回调**完全相同的调用**，没有任何延迟。
   *
   * ⚠️ 为什么不能用"轮询到某个时刻"就完事：`pending` 必须取自**库内部 store 的 `nodeLookup`**
   * 而不是我们 zustand store 的 `nodes[].measured`。卡住时我们的 store 永远等不到那次
   * dimensions change，`nodes[].measured` 一直是空 → 判据永远非空 → 定时器永远不收手，
   * 每次 nodes 变化又叠一层（第二版 rAF 限 30 帧 → 1/12；第三版 setTimeout 轮询 5 秒 → **反而恶化到 8/15**，
   * 就是因为这些长命定时器在主线程上和库自己的测量互相抢时间）。所以这里：
   *   - 判据读库的 `nodeLookup`（真实状态，量到就立刻收敛）；
   *   - 只在元素**已完成布局**（offsetWidth/Height > 0）时才 force，避免把 0×0 写回去；
   *   - 重试次数/间隔都是**上界很小的常量**，且一旦全部量到立即停。
   */
  useEffect(() => {
    const read = () => store.getState()
    const unmeasured = (v: Map<string, { measured?: { width?: number; height?: number } }>) => {
      const ids: string[] = []
      for (const [id, n] of v) {
        if (!n.measured?.width || !n.measured?.height) ids.push(id)
      }
      return ids
    }
    if (unmeasured(read().nodeLookup).length === 0) return

    let stopped = false
    let tries = 0
    const tick = () => {
      if (stopped) return
      tries += 1
      const st = read()
      const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: boolean }>()
      const pending = unmeasured(st.nodeLookup)
      for (const id of pending) {
        const el = st.domNode?.querySelector<HTMLDivElement>(`.react-flow__node[data-id="${id}"]`)
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          updates.set(id, { id, nodeElement: el, force: true })
        }
      }
      if (updates.size > 0) {
        // React Flow 把该内部类型（Map<string, InternalNodeUpdate>）标成 internal，未从包根导出；
        // 这里做一次结构等价窄化，避免 import 包内深层路径（那会随上游重构而崩）。
        st.updateNodeInternals(updates as Parameters<typeof st.updateNodeInternals>[0])
      }
      if (pending.length === 0 || tries >= MEASURE_RETRY_MAX) return
      window.setTimeout(tick, MEASURE_RETRY_INTERVAL)
    }
    const timer = window.setTimeout(tick, 0)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [visibleNodes, store])

  // 节点数量增加时（生成/新增）重新适配视口，保证新节点可见。
  // ⚠️ 必须先等 nodesInitialized：React Flow 靠 ResizeObserver **异步**量节点尺寸，
  // 尺寸还没量到就 fitView 会失效（视口停在原地 matrix(1,0,0,1,0,0)，缩略图也是空的）。
  // 未就绪时提前 return 且**不推进 prevCount**，等就绪后这次 fitView 仍会补上。
  // ⚠️ 只统计 idea 节点：放置一个评论气泡不该触发"整树适配视口"（相机会突兀地跳）。
  // 统计的是**可见**节点 → 展开一个收起的分支时数量增加，相机自动把新露出的子节点带进视野。
  // ⚠️ **maxZoom: 1 是硬要求**（实测踩过）：新生成的子节点偶尔还没被量到尺寸，此时 fitView
  //    只把"已测量的那部分"算进去 → 内容看着很小 → 一路放大到库默认的 maxZoom=2，
  //    于是那个没参与计算的新节点被推出可视区（屏幕坐标跑到画布右边界之外，被预览面板挡住）。
  //    表现为"刚生成的想法看不见了"。限制在 100% 后，即使少算了节点也只是位置略偏，不会飞出去。
  const ideaCount = visibleNodes.filter((n) => n.type !== 'comment').length
  useEffect(() => {
    if (!nodesInitialized) return
    if (ideaCount > prevCount.current) {
      const id = window.setTimeout(
        () => void fitView({ duration: 300, padding: 0.25, maxZoom: 1 }),
        60,
      )
      prevCount.current = ideaCount
      return () => window.clearTimeout(id)
    }
    prevCount.current = ideaCount
  }, [ideaCount, nodesInitialized, fitView])

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
    <div
      ref={wrapRef}
      className={placingComment ? 'canvas-placing' : undefined}
      style={{ width: '100%', height: '100%' }}
    >
      <ReactFlow
        nodes={visibleNodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          closeMenu()
          // 放置模式下点任何节点都只是取消放置（气泡只落在空白画布上）
          if (placingComment) {
            togglePlacingComment()
            return
          }
          setActiveCommentNode(null)
          setActiveThread(null)
          selectNode(node.id)
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault()
          selectNode(node.id)
          openMenu(node.id, e.clientX, e.clientY)
        }}
        onNodeDrag={(evt, node) => {
          if (node.type === 'comment') return
          const p = clientPointOf(evt)
          if (!p) return
          const over = hitTrash(p.x, p.y)
          if (over !== dragOverTrash) setDragOverTrash(over)
        }}
        onNodeDragStop={(evt, node, dragged) => {
          // 自由气泡拖完把流坐标写回项目文件
          if (node.type === 'comment') {
            void updateCommentPosition(node.id, node.position.x, node.position.y)
            return
          }
          // 想法回收站：拖到回收站上松手 = 归档（多选拖动时整批归档）
          const p = clientPointOf(evt)
          const over = p ? hitTrash(p.x, p.y) : false
          setDragOverTrash(false)
          if (over) {
            const batch = (dragged ?? [node]).filter((n) => n.type !== 'comment')
            for (const n of batch) void archiveNode(n.id)
            return
          }
          // 普通 idea 节点：把拖完的流坐标写盘，重进画布保持位置（单节点或整批多选都落）
          const moved = (dragged ?? [node]).filter((n) => n.type !== 'comment')
          for (const n of moved) void setNodePosition(n.id, n.position.x, n.position.y)
        }}
        onPaneClick={(e) => {
          closeMenu()
          if (placingComment) {
            // 放置模式：把点击处换算成流坐标，创建自由气泡（store 内会退出放置模式并打开弹层）
            const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
            void addCanvasComment({ x: pos.x, y: pos.y })
            return
          }
          setActiveCommentNode(null)
          setActiveThread(null)
          selectNode(null)
        }}
        onMoveStart={() => closeMenu()}
        fitView
        // 同上的 maxZoom：初始适配与控件按钮（Controls 的 fitView）都别放大超过 100%
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        // 去掉右下角那个第三方「React Flow」署名链接（.react-flow__attribution），与本产品无关。
        // 注意：@xyflow 官方是希望"隐藏署名即订阅 React Flow Pro"（见 reactflow.dev/remove-attribution），
        // 代码层面 MIT 且该开关是公开 API；如后续要合规，可考虑为上游订阅。
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls fitViewOptions={{ padding: 0.25, maxZoom: 1 }} />
        {/*
          ⚠️ @xyflow/react v12 的 <MiniMap> 把 pannable / zoomable 默认写成了 false
          （内核 XYMinimap.update 的默认值本是 true），不显式打开的话缩略图只是个"死的缩略图"：
          拖不动、滚不动、点不动 —— 也就是"快速定位不能用"。
        */}
        <MiniMap pannable zoomable onClick={onMinimapClick} />
      </ReactFlow>
      {/* 想法回收站：画布上的固定覆盖层（不随画布平移/缩放），拖入归档、点开取出 */}
      <TrashBin highlight={dragOverTrash} />
    </div>
  )
}
