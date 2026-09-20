// C.1 画布基础渲染：用 @xyflow/react 渲染写死的节点与连线。
// 当前为静态数据；C.2 起接入 Zustand store，C.3 起接入生成链路。

import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const initialNodes: Node[] = [
  { id: 'root', position: { x: 0, y: 0 }, data: { label: '创意主题' } },
  { id: 'a', position: { x: 280, y: -120 }, data: { label: '方向 A' } },
  { id: 'b', position: { x: 280, y: 120 }, data: { label: '方向 B' } },
]

const initialEdges: Edge[] = [
  { id: 'root-a', source: 'root', target: 'a', animated: true },
  { id: 'root-b', source: 'root', target: 'b', animated: true },
]

export function CreativeTree() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow nodes={initialNodes} edges={initialEdges} fitView>
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
