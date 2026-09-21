// 画布自由气泡节点（type 'comment'）：不挂在任何创意节点上，钉在画布流坐标。
// 点击气泡开关评论弹层（NodeToolbar 随节点走，画布平移缩放都跟随）。
// 拖拽由 React Flow 处理，落点持久化在 CreativeTree 的 onNodeDragStop。
// 注意：本组件**不带 Handle**（评论气泡不参与连线）。

import { NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import type { CreativeNode } from '../store/treeStore'
import { useTreeStore } from '../store/treeStore'
import { CommentThreadPopover } from '../comments/CommentThreadPopover'

export function CommentNode({ id, data, selected }: NodeProps<CreativeNode>) {
  const thread = data.thread
  const activeThreadId = useTreeStore((s) => s.activeThreadId)
  const setActiveThread = useTreeStore((s) => s.setActiveThread)

  if (!thread) return null // 只会出现在错误用法下；防御一下

  // 一个气泡就是一条评论（不做回复线程），所以气泡上没有"条数"可显示。
  const active = activeThreadId === id

  return (
    <div
      className={'comment-bubble' + (active ? ' active' : '')}
      data-testid="comment-bubble"
      data-thread-id={thread.id}
      style={selected ? { borderColor: '#1f6feb' } : undefined}
      title={thread.body || '（空评论，点击填写）'}
      onClick={(e) => {
        // 阻止冒泡：不让 React Flow 的 onNodeClick 把它当普通节点选中（预览面板不切走）
        e.stopPropagation()
        setActiveThread(active ? null : id)
      }}
    >
      <span className="comment-bubble-icon">💬</span>
      {thread.body && <span className="comment-bubble-preview">{thread.body.slice(0, 12)}</span>}
      <NodeToolbar isVisible={active} position={Position.Right} offset={10}>
        <CommentThreadPopover thread={thread} />
      </NodeToolbar>
    </div>
  )
}
