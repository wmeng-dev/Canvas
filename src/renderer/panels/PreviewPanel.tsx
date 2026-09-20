// C.2 预览面板（文本版）：显示当前选中节点的内容。
// C.4 会扩展为多类型预览（markdown / html / svg）。

import { useTreeStore } from '../store/treeStore'

export function PreviewPanel() {
  const node = useTreeStore(
    (s) => s.nodes.find((n) => n.id === s.selectedNodeId) ?? null,
  )
  const openDialog = useTreeStore((s) => s.openDialog)

  return (
    <aside
      style={{
        width: 340,
        flex: '0 0 340px',
        borderLeft: '1px solid #21262d',
        background: '#0b0f14',
        padding: 16,
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      <h2 style={{ fontSize: 13, letterSpacing: 0.5, margin: '0 0 12px', color: '#7d8590' }}>
        节点预览
      </h2>
      {!node ? (
        <p style={{ color: '#7d8590', fontSize: 13, lineHeight: 1.6 }}>
          点击画布中的节点查看内容。
        </p>
      ) : (
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10, color: '#e6edf3' }}>
            {node.data.label}
          </div>
          <button
            data-testid="branch-from-node"
            onClick={() => openDialog(node.id)}
            style={{
              marginBottom: 14,
              background: 'transparent',
              color: '#58a6ff',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            从这里发散
          </button>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'inherit',
              fontSize: 13,
              lineHeight: 1.7,
              margin: 0,
              color: '#c9d1d9',
            }}
          >
            {node.data.content ?? '（暂无内容）'}
          </pre>
        </div>
      )}
    </aside>
  )
}
