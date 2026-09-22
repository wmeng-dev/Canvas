// C.3/C.5/D.1 应用外壳：顶栏 + 画布 + 预览面板 + 生成对话框 + 导出对话框 + 节点右键菜单。

import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { CreativeTree } from './canvas/CreativeTree'
import { ProjectTabs } from './ProjectTabs'
import { HistoryDrawer } from './HistoryDrawer'
import { NodeContextMenu } from './canvas/NodeContextMenu'
import { PreviewPanel } from './panels/PreviewPanel'
import { AiSettingsPanel } from './panels/AiSettingsPanel'
import { GenerateDialog } from './dialogs/GenerateDialog'
import { ExportDialog } from './dialogs/ExportDialog'
import { useTreeStore } from './store/treeStore'

export function App() {
  const lastSavedAt = useTreeStore((s) => s.lastSavedAt)
  const init = useTreeStore((s) => s.init)
  const openDialog = useTreeStore((s) => s.openDialog)
  const openAi = useTreeStore((s) => s.openAi)
  const openExport = useTreeStore((s) => s.openExport)
  const saveProject = useTreeStore((s) => s.saveProject)
  const saveProjectAs = useTreeStore((s) => s.saveProjectAs)
  const openProject = useTreeStore((s) => s.openProject)
  const placingComment = useTreeStore((s) => s.placingComment)
  const togglePlacingComment = useTreeStore((s) => s.togglePlacingComment)
  const generators = useTreeStore((s) => s.generators)
  const error = useTreeStore((s) => s.error)
  const clearError = useTreeStore((s) => s.clearError)
  const warning = useTreeStore((s) => s.warning)
  const clearWarning = useTreeStore((s) => s.clearWarning)

  const savedLabel = lastSavedAt
    ? `已保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
    : null

  /** 左侧「历史画布」抽屉是否展开（覆盖在画布上，不挤占宽度）。 */
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <ReactFlowProvider>
      {/* 外壳 / 顶栏 / 横幅 / 按钮的样式全在 styles.css（.app-shell/.app-header/.app-banner/.btn）——
          这里**故意不写内联样式**：内联优先级高于类，写了就等于把材质化设计整块盖掉。 */}
      <div className="app-shell">
        <header className="app-header">
          <span className="app-title">风衍 IdeaSprout</span>
          {savedLabel && (
            <span data-testid="saved-hint" className="app-hint">
              {savedLabel}
            </span>
          )}
          <div className="app-spacer" />
          <button data-testid="open-project" className="btn" onClick={() => void openProject()}>
            打开
          </button>
          <button data-testid="save-project-as" className="btn" onClick={() => void saveProjectAs()}>
            另存为
          </button>
          <button data-testid="save-project" className="btn" onClick={() => void saveProject()}>
            保存
          </button>
          <button data-testid="open-ai" className="btn" onClick={openAi}>
            AI 后端{generators.length > 0 ? `（${generators.length}）` : ''}
          </button>
          <button data-testid="open-export" className="btn" onClick={openExport}>
            导出
          </button>
          <button
            data-testid="toggle-comment"
            className={placingComment ? 'btn btn--on' : 'btn'}
            onClick={togglePlacingComment}
            title="在画布空白处点击，放置一条评论气泡"
          >
            {placingComment ? '点击画布放置评论…' : '💬 评论'}
          </button>
          <button data-testid="new-idea" className="btn btn--primary" onClick={() => openDialog(null)}>
            ＋ 新增想法
          </button>
        </header>

        {/* 画布 tab 条：切画布 + 新建空白画布；当前 tab 里内嵌画布名（可改） */}
        <ProjectTabs onOpenHistory={() => setHistoryOpen(true)} />

        {error && (
          <div
            data-testid="app-error"
            className="app-banner app-banner--error"
            onClick={clearError}
          >
            <span>{error}</span>
            <span className="app-banner__close">点击关闭</span>
          </div>
        )}

        {warning && (
          <div
            data-testid="app-warning"
            className="app-banner app-banner--warn"
            onClick={clearWarning}
          >
            <span>{warning}</span>
            <span className="app-banner__close">点击关闭</span>
          </div>
        )}

        <div className="app-body">
          {/*
            历史画布抽屉：**覆盖**在画布上（不是挤占宽度）——
            React Flow 对容器尺寸变化敏感，push 布局会白白触发一次重排/重测。
            遮罩兼作"点外面收起"。
          */}
          {historyOpen && (
            <div
              className="history-backdrop"
              data-testid="history-backdrop"
              onClick={() => setHistoryOpen(false)}
            />
          )}
          <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <CreativeTree />
          </div>
          <PreviewPanel />
        </div>
      </div>

      <GenerateDialog />
      <ExportDialog />
      <NodeContextMenu />
      <AiSettingsPanel />
    </ReactFlowProvider>
  )
}
