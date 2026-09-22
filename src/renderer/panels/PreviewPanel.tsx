// C.2/C.4/C.5/D.3 预览面板：选中节点 → 按 contentType 预览 + 版本历史（可翻案）+ 编辑描述/重新生成。
// 类型分发见 previews/ContentPreview.tsx。
// D.3：面板宽度可拖左边缘调整（不再固定 340），双击把手复位。
// 编辑描述：点「重新生成」**不再直接生成**，而是就地进入编辑态（描述 → 输入框），
//          编辑后可选择「重新生成」或「保存（不生成）」，也可「取消」。
//          编辑态的"谁在编辑"存在 store 里（右键菜单同一个入口），此处只渲染。
//
// 样式：静态外观走 .preview-panel*（styles.css）。**宽度必须留内联** —— 它来自
// store（可拖拽），写进 CSS 就拖不动了。
// ⚠️ DOM 结构有探针契约（probe-d3）：把手必须是面板的**直接子节点**且不在滚动区内
//    （滚动时把手不能跟着滚走）；面板 overflow:hidden、滚动区 overflow-y:auto；
//    面板 rect 宽度必须等于 data-width（所以面板上不能有 transform）。

import { useEffect, useState } from 'react'
import { useTreeStore, PREVIEW_WIDTH_MAX, PREVIEW_WIDTH_MIN } from '../store/treeStore'
import { AnalysisBlock } from './AnalysisBlock'
import { ContentPreview } from '../previews/ContentPreview'
import type { ContentType } from '../../shared/types'

const TYPE_LABEL: Record<ContentType, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  svg: 'SVG',
  text: '纯文本',
  image: '图片',
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function PreviewPanel() {
  const node = useTreeStore(
    (s) => s.nodes.find((n) => n.id === s.selectedNodeId) ?? null,
  )
  const openDialog = useTreeStore((s) => s.openDialog)
  const regenerate = useTreeStore((s) => s.regenerate)
  const beginEditPrompt = useTreeStore((s) => s.beginEditPrompt)
  const cancelEditPrompt = useTreeStore((s) => s.cancelEditPrompt)
  const savePrompt = useTreeStore((s) => s.savePrompt)
  const editingPromptNodeId = useTreeStore((s) => s.editingPromptNodeId)
  const proposingId = useTreeStore((s) => s.proposingId)
  const generateProposal = useTreeStore((s) => s.generateProposal)
  const setVersion = useTreeStore((s) => s.setVersion)
  const regeneratingId = useTreeStore((s) => s.regeneratingId)
  const width = useTreeStore((s) => s.previewWidth)
  const setPreviewWidth = useTreeStore((s) => s.setPreviewWidth)
  const resetPreviewWidth = useTreeStore((s) => s.resetPreviewWidth)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState('')

  const editing = !!node && editingPromptNodeId === node.id

  // 进入编辑态（或换节点）时，把当前描述灌进草稿；退出编辑态时清空，
  // 免得下次进来先闪一下上次的残留文字。
  useEffect(() => {
    setDraft(editing ? (node?.data.prompt ?? '') : '')
  }, [editing, node?.id])

  /** 拖左边缘改宽：面板贴右边，指针左移 → 变大。 */
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault() // 阻止拖拽时选中文本（不影响 dblclick）
    const startX = e.clientX
    const startW = width
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => setPreviewWidth(startW + (startX - ev.clientX))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const contentType = (node?.data.contentType ?? 'markdown') as ContentType
  const versions = node?.data.versions ?? []
  const currentVersionId = node?.data.currentVersionId ?? null
  const busy = !!node && regeneratingId === node.id
  /** 选中节点到根的层数：方案是沿这条链生成的，按钮上直接说清楚"用几层" */
  const chainLength = useTreeStore((s) => {
    if (!s.selectedNodeId) return 0
    let len = 0
    let cur = s.nodes.find((n) => n.id === s.selectedNodeId)
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      len++
      cur = cur.data.parentId ? s.nodes.find((n) => n.id === cur!.data.parentId) : undefined
    }
    return len
  })
  const proposing = !!node && proposingId === node.id

  return (
    <aside
      data-testid="preview-panel"
      data-width={width}
      className="preview-panel"
      style={{ width, flex: `0 0 ${width}px` }}
    >
      {/* 拖拽把手：贴左边缘，拖动改宽，双击复位 */}
      <div
        data-testid="preview-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整预览宽度"
        title={`拖动调整宽度（${PREVIEW_WIDTH_MIN}–${PREVIEW_WIDTH_MAX}px，双击复位）`}
        onMouseDown={onResizeStart}
        onDoubleClick={resetPreviewWidth}
        className={`preview-panel__resizer${dragging ? ' is-dragging' : ''}`}
      >
        <div className="preview-panel__grip" />
      </div>
      {/* 滚动区独立成层：把手在它外面，滚内容时把手不会跟着滚走 */}
      <div data-testid="preview-scroll" className="preview-panel__scroll">
        <h2 className="preview-panel__title">节点预览</h2>
        {!node ? (
          <p className="preview-panel__empty">点击画布中的节点查看内容。</p>
        ) : (
          <div>
            <div className="preview-panel__name">{node.data.label}</div>

            <div className="preview-panel__actions">
              <span data-testid="preview-type" className="type-tag">
                {TYPE_LABEL[contentType]}
              </span>
              <button
                data-testid="branch-from-node"
                onClick={() => openDialog(node.id)}
                className="btn btn--sm btn--accent"
              >
                从这里发散
              </button>
              {/* 入口：进入"编辑描述"，**不触发生成**（生成/不生成在编辑态里再选） */}
              {!editing && (
                <button
                  data-testid="regenerate-node"
                  onClick={() => beginEditPrompt(node.id)}
                  className="btn btn--sm btn--accent"
                >
                  重新生成
                </button>
              )}
              {/* 收敛：沿「根 → 本节点」这条链路生成一份方案，产物挂在本节点下 */}
              <button
                data-testid="generate-proposal"
                data-chain-length={chainLength}
                disabled={proposing || busy}
                title={`沿「根 → ${node.data.label}」这条链路（${chainLength} 层）生成一份可落地方案`}
                onClick={() => void generateProposal(node.id)}
                className="btn btn--sm btn--accent"
              >
                {proposing ? '生成方案中…' : `沿链路生成方案（${chainLength} 层）`}
              </button>
            </div>

            {/* 描述区：只读展示原始描述；编辑态下变成输入框 + 「重新生成 / 保存（不生成）/ 取消」 */}
            {(editing || node.data.prompt) && (
              <div
                data-testid="preview-prompt"
                data-editing={editing ? '1' : '0'}
                className={`preview-panel__prompt${editing ? ' is-editing' : ''}`}
              >
                <span className="preview-panel__prompt-label">
                  {editing ? '编辑描述：' : '原始描述：'}
                </span>
                {!editing && node.data.prompt}

                {editing && (
                  <>
                    <textarea
                      data-testid="prompt-editor"
                      autoFocus
                      value={draft}
                      disabled={busy}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') cancelEditPrompt()
                      }}
                      placeholder="这段描述决定接下来怎么发散（留空则无法重新生成）"
                      className="textarea preview-panel__editor"
                    />
                    <div className="preview-panel__edit-actions">
                      <button
                        data-testid="confirm-regenerate"
                        disabled={busy || !draft.trim()}
                        title={draft.trim() ? undefined : '描述不能为空'}
                        onClick={() => void regenerate(node.id, draft)}
                        className="btn btn--sm btn--accent"
                      >
                        {busy ? '重新生成中…' : '重新生成'}
                      </button>
                      <button
                        data-testid="save-prompt"
                        disabled={busy}
                        title="只保存描述，不重新生成"
                        onClick={() => void savePrompt(node.id, draft)}
                        className="btn btn--sm"
                      >
                        保存（不生成）
                      </button>
                      <button
                        data-testid="cancel-edit"
                        disabled={busy}
                        onClick={cancelEditPrompt}
                        className="btn btn--sm text-muted"
                      >
                        取消
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <AnalysisBlock analysis={node.data.analysis} />

            <ContentPreview contentType={contentType} content={node.data.content ?? ''} />

            {versions.length > 0 && (
              <div data-testid="version-history" className="preview-panel__history">
                <h3 className="preview-panel__history-title">版本历史（{versions.length}）</h3>
                <ul className="version-list">
                  {[...versions].reverse().map((v) => {
                    const index = versions.indexOf(v) + 1
                    const isCurrent = v.id === currentVersionId
                    return (
                      <li
                        key={v.id}
                        data-testid="version-item"
                        data-current={isCurrent ? '1' : '0'}
                        data-version={index}
                        className={`version-item${isCurrent ? ' is-current' : ''}`}
                      >
                        <span className="version-item__no">v{index}</span>
                        <span className="version-item__time">{shortTime(v.createdAt)}</span>
                        <span className="version-item__spacer" />
                        {isCurrent ? (
                          <span className="version-item__current">当前</span>
                        ) : (
                          <button
                            data-testid="version-revert"
                            data-version={index}
                            onClick={() => void setVersion(node.id, v.id)}
                            className="btn btn--sm btn--accent"
                          >
                            翻案
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
