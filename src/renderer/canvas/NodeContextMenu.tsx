// C.5 节点右键菜单：发散子节点 / 重新生成（追加新版本）。
// D.9：「重新生成」不再是"一键直出"，而是和面板按钮一样**先进编辑态**（描述 → 输入框），
//      编辑后可选择重新生成或只保存。两个入口共用 store 里的 editingPromptNodeId。
// 位置用 fixed + 视口坐标，并做右/下边界收敛，避免菜单跑出窗口。
//
// 样式：静态外观走 .ctx-menu*（styles.css）。**left/top 与色点颜色留内联** ——
// 前者是鼠标坐标、后者来自 shared/colors 的色板，都是数据而非样式。

import { useEffect } from 'react'
import { useTreeStore } from '../store/treeStore'
import { CARD_COLORS } from '../../shared/colors'

// ⚠️ 菜单变高（加了颜色行）时这个数要跟着改，否则靠近窗口底部时菜单会被裁掉。
//    CSS 里 .ctx-menu 的 width 也要与 MENU_WIDTH 同步。
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

  return (
    <>
      {/* 点击任意位置关闭 */}
      <div
        data-testid="menu-backdrop"
        className="ctx-menu__backdrop"
        onClick={closeMenu}
        onContextMenu={(e) => {
          e.preventDefault()
          closeMenu()
        }}
      />
      <div data-testid="node-context-menu" className="ctx-menu" style={{ left: x, top: y }}>
        <div className="ctx-menu__header">{node.data.label}</div>

        <button
          data-testid="menu-ideasprout"
          className="ctx-menu__item"
          onClick={() => {
            selectNode(node.id)
            closeMenu()
            openDialog(node.id)
          }}
        >
          发散子节点…
        </button>

        <button
          data-testid="menu-regenerate"
          className="ctx-menu__item"
          disabled={busy}
          onClick={() => {
            // 进编辑态（beginEditPrompt 内部会选中节点并关菜单）
            beginEditPrompt(node.id)
          }}
        >
          {regenerateLabel}
        </button>

        {/* 卡片颜色：一排圆点，点一下即改色；最左边那颗（默认白）= 恢复默认色 */}
        <div data-testid="menu-colors" className="ctx-menu__colors">
          <span className="ctx-menu__colors-label">颜色</span>
          {CARD_COLORS.map((c) => {
            const on = (node.data.color ?? CARD_COLORS[0].bg) === c.bg
            return (
              <button
                key={c.id}
                data-testid="menu-color-swatch"
                data-color-id={c.id}
                data-color-bg={c.bg}
                title={c.label}
                className="ctx-menu__swatch"
                onClick={() => {
                  closeMenu()
                  // default 那颗表示"恢复默认色"（落 null，而不是存一个白色值）
                  void setNodeColor(node.id, c.id === 'default' ? null : c.bg)
                }}
                // 色点底色/描边来自色板数据，必须内联
                style={{ background: c.bg, border: on ? '2px solid var(--accent)' : `1px solid ${c.border}` }}
              />
            )
          })}
        </div>
      </div>
    </>
  )
}
