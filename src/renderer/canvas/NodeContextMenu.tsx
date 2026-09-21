// C.5 节点右键菜单：发散子节点 / 重新生成（追加新版本）。
// D.9：「重新生成」不再是"一键直出"，而是和面板按钮一样**先进编辑态**（描述 → 输入框），
//      编辑后可选择重新生成或只保存。两个入口共用 store 里的 editingPromptNodeId。
// 位置用 fixed + 视口坐标，并做右/下边界收敛，避免菜单跑出窗口。

import { useEffect } from 'react'
import { useTreeStore } from '../store/treeStore'
import { CARD_COLORS } from '../../shared/colors'

// ⚠️ 菜单变高（加了颜色行）时这个数要跟着改，否则靠近窗口底部时菜单会被裁掉。
const MENU_WIDTH = 216
const MENU_HEIGHT = 178

export function NodeContextMenu() {
  const menu = useTreeStore((s) => s.menu)
  const nodes = useTreeStore((s) => s.nodes)
  const closeMenu = useTreeStore((s) => s.closeMenu)
  const openDialog = useTreeStore((s) => s.openDialog)
  const beginEditPrompt = useTreeStore((s) => s.beginEditPrompt)
  const selectNode = useTreeStore((s) => s.selectNode)
  const regeneratingId = useTreeStore((s) => s.regeneratingId)
  const setNodeColor = useTreeStore((s) => s.setNodeColor)

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
      ? '编辑描述并生成…'
      : `编辑描述并重新生成（新版本 v${versionCount + 1}）`

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
          data-testid="menu-ideasprout"
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
          onClick={() => {
            // 进编辑态（beginEditPrompt 内部会选中节点并关菜单）
            beginEditPrompt(node.id)
          }}
          style={{ ...itemStyle, color: busy ? '#7d8590' : '#e6edf3', cursor: busy ? 'wait' : 'pointer' }}
        >
          {regenerateLabel}
        </button>

        {/* 卡片颜色：一排圆点，点一下即改色；最左边那颗（默认白）= 恢复默认色 */}
        <div
          data-testid="menu-colors"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '8px 10px 6px',
            borderTop: '1px solid #21262d',
            marginTop: 4,
          }}
        >
          <span style={{ fontSize: 11, color: '#7d8590', marginRight: 2 }}>颜色</span>
          {CARD_COLORS.map((c) => {
            const on = (node.data.color ?? CARD_COLORS[0].bg) === c.bg
            return (
              <button
                key={c.id}
                data-testid="menu-color-swatch"
                data-color-id={c.id}
                data-color-bg={c.bg}
                title={c.label}
                onClick={() => {
                  closeMenu()
                  // default 那颗表示"恢复默认色"（落 null，而不是存一个白色值）
                  void setNodeColor(node.id, c.id === 'default' ? null : c.bg)
                }}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: c.bg,
                  border: on ? '2px solid #1f6feb' : `1px solid ${c.border}`,
                  padding: 0,
                  cursor: 'pointer',
                }}
              />
            )
          })}
        </div>
      </div>
    </>
  )
}
