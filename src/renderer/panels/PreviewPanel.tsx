// C.2/C.4 预览面板：显示当前选中节点，并按 contentType 选择预览方式。
// 类型分发见 previews/ContentPreview.tsx。

import { useTreeStore } from '../store/treeStore'
import { ContentPreview } from '../previews/ContentPreview'
import type { ContentType } from '../../shared/types'

const TYPE_LABEL: Record<ContentType, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  svg: 'SVG',
  text: '纯文本',
  image: '图片',
}

export function PreviewPanel() {
  const node = useTreeStore(
    (s) => s.nodes.find((n) => n.id === s.selectedNodeId) ?? null,
  )
  const openDialog = useTreeStore((s) => s.openDialog)

  const contentType = (node?.data.contentType ?? 'markdown') as ContentType

  return (
    <aside
      data-testid="preview-panel"
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
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: '#e6edf3' }}>
            {node.data.label}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span
              data-testid="preview-type"
              style={{
                fontSize: 11,
                color: '#58a6ff',
                border: '1px solid #1f6feb55',
                background: '#1f6feb1a',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              {TYPE_LABEL[contentType]}
            </span>
            <button
              data-testid="branch-from-node"
              onClick={() => openDialog(node.id)}
              style={{
                background: 'transparent',
                color: '#58a6ff',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: '3px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              从这里发散
            </button>
          </div>

          <ContentPreview contentType={contentType} content={node.data.content ?? ''} />
        </div>
      )}
    </aside>
  )
}
