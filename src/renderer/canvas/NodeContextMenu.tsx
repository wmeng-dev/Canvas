// C.5 节点右键菜单：发散子节点 / 重新生成（追加新版本）。
// 位置用 fixed + 视口坐标，并做右/下边界收敛，避免菜单跑出窗口。

import { useEffect } from 'react'
import { useTreeStore } from '../store/treeStore'

const MENU_WIDTH = 216
const MENU_HEIGHT = 132

export function NodeContextMenu() {
  const menu = useTreeStore((s) => s.menu)
  const nodes = useTreeStore((s) => s.nodes)
  const closeMenu = useTreeStore((s) => s.closeMenu)
  const openDialog = useTreeStore((s) => s.openDialog)
  const regenerate = useTreeStore((s) => s.regenerate)
  const selectNode = useTreeStore((s) => s.selectNode)
  const regeneratingId = useTreeStore((s) => s.regeneratingId)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, closeMenu])

  if (!menu) return null
  const node = nodes.find((n) => n.id === menu.nodeId)
  if (!node) return null

  const x = Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8)
  const y = Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 8)
  const busy = regeneratingId === node.id
  const versionCount = node.data.versions?.length ?? 0
  // 空内容节点（如根节点）还没有版本，说"新版本 v1"会让人困惑 → 区分首版/新版本
  const regenerateLabel = busy
    ? '重新生成中…'
    : versionCount === 0
      ? '生成内容（首版）'
      : `重新生成（新版本 v${versionCount + 1}）`

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    color: '#e6edf3',
    border: 'none',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    cursor: 'pointer',
  }

  return (
    <>
      {/* 点击任意位置关闭 */}
      <div
        data-testid="menu-backdrop"
        onClick={closeMenu}
        onContextMenu={(e) => {
          e.preventDefault()
          closeMenu()
        }}
        style={{ position: 'fixed', inset: 0, zIndex: 60 }}
      />
      <div
        data-testid="node-context-menu"
        style={{
          position: 'fixed',
          left: x,
          top: y,
          width: MENU_WIDTH,
          zIndex: 61,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 8,
          padding: 6,
          boxShadow: '0 10px 28px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            padding: '4px 10px 8px',
            fontSize: 11,
            color: '#7d8590',
            borderBottom: '1px solid #21262d',
            marginBottom: 4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {node.data.label}
        </div>

        <button
          data-testid="menu-diverge"
          onClick={() => {
            selectNode(node.id)
            closeMenu()
            openDialog(node.id)
          }}
          style={itemStyle}
        >
          发散子节点…
        </button>

        <button
          data-testid="menu-regenerate"
          disabled={busy}
          onClick={() => void regenerate(node.id)}
          style={{ ...itemStyle, color: busy ? '#7d8590' : '#e6edf3', cursor: busy ? 'wait' : 'pointer' }}
        >
          {regenerateLabel}
        </button>
      </div>
    </>
  )
}
