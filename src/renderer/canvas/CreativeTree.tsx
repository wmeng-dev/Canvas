// C.1/C.2/C.3 画布：用 @xyflow/react 渲染创意树，节点/边/选中态由 Zustand store 驱动。
// 新增节点后自动 fitView，避免新节点落在视口外（初次 fitView 只覆盖初始节点）。

import { useEffect, useRef } from 'react'
import { Background, Controls, MiniMap, ReactFlow, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTreeStore } from '../store/treeStore'

export function CreativeTree() {
  const nodes = useTreeStore((s) => s.nodes)
  const edges = useTreeStore((s) => s.edges)
  const onNodesChange = useTreeStore((s) => s.onNodesChange)
  const onEdgesChange = useTreeStore((s) => s.onEdgesChange)
  const onConnect = useTreeStore((s) => s.onConnect)
  const selectNode = useTreeStore((s) => s.selectNode)

  const { fitView } = useReactFlow()
  const prevCount = useRef(0)

  // 节点数量增加时（生成/新增）重新适配视口，保证新节点可见
  useEffect(() => {
    if (nodes.length > prevCount.current) {
      const id = window.setTimeout(() => void fitView({ duration: 300, padding: 0.25 }), 60)
      prevCount.current = nodes.length
      return () => window.clearTimeout(id)
    }
    prevCount.current = nodes.length
  }, [nodes.length, fitView])

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
