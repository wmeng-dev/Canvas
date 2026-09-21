// C.3/C.5/D.1 应用外壳：顶栏 + 画布 + 预览面板 + 生成对话框 + 导出对话框 + 节点右键菜单。

import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { CreativeTree } from './canvas/CreativeTree'
import { NodeContextMenu } from './canvas/NodeContextMenu'
import { PreviewPanel } from './panels/PreviewPanel'
import { AiSettingsPanel } from './panels/AiSettingsPanel'
import { GenerateDialog } from './dialogs/GenerateDialog'
import { ExportDialog } from './dialogs/ExportDialog'
import { useTreeStore } from './store/treeStore'

/** 顶栏次级按钮（描边风格，与「AI 后端 / 导出」一致） */
const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
  marginRight: 8,
}

export function App() {
  const projectName = useTreeStore((s) => s.projectName)
  const lastSavedAt = useTreeStore((s) => s.lastSavedAt)
  const init = useTreeStore((s) => s.init)
  const openDialog = useTreeStore((s) => s.openDialog)
  const openAi = useTreeStore((s) => s.openAi)
  const openExport = useTreeStore((s) => s.openExport)
  const renameProject = useTreeStore((s) => s.renameProject)
  const saveProject = useTreeStore((s) => s.saveProject)
  const saveProjectAs = useTreeStore((s) => s.saveProjectAs)
  const openProject = useTreeStore((s) => s.openProject)
  const generators = useTreeStore((s) => s.generators)
  const error = useTreeStore((s) => s.error)
  const clearError = useTreeStore((s) => s.clearError)
  const warning = useTreeStore((s) => s.warning)
  const clearWarning = useTreeStore((s) => s.clearWarning)

  const [nameDraft, setNameDraft] = useState(projectName)
  useEffect(() => {
    setNameDraft(projectName)
  }, [projectName])

  const commitName = () => {
    const next = nameDraft.trim()
    if (next && next !== projectName) void renameProject(next)
    else setNameDraft(projectName)
  }

  const savedLabel = lastSavedAt
    ? `已保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
    : null

  useEffect(() => {
    void init()
  }, [init])

  return (
    <ReactFlowProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            borderBottom: '1px solid #21262d',
            background: '#0d1117',
            flex: '0 0 auto',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3' }}>发散创意画布</span>
          <input
            data-testid="project-name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            title="点击修改项目名称"
            style={{
              background: 'transparent',
              color: '#e6edf3',
              border: '1px solid transparent',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 13,
              minWidth: 120,
              maxWidth: 260,
            }}
          />
          {savedLabel && (
            <span data-testid="saved-hint" style={{ fontSize: 12, color: '#3fb950' }}>
              {savedLabel}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button data-testid="open-project" onClick={() => void openProject()} style={ghostBtn}>
            打开
          </button>
          <button data-testid="save-project-as" onClick={() => void saveProjectAs()} style={ghostBtn}>
            另存为
          </button>
          <button data-testid="save-project" onClick={() => void saveProject()} style={ghostBtn}>
            保存
          </button>
          <button
            data-testid="open-ai"
            onClick={openAi}
            style={{
              background: 'transparent',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              marginRight: 8,
            }}
          >
            AI 后端{generators.length > 0 ? `（${generators.length}）` : ''}
          </button>
          <button
            data-testid="open-export"
            onClick={openExport}
            style={{
              background: 'transparent',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
              marginRight: 8,
            }}
          >
            导出
          </button>
          <button
            data-testid="new-idea"
            onClick={() => openDialog(null)}
            style={{
              background: '#1f6feb',
              color: '#fff',
              border: '1px solid #1f6feb',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ＋ 新增想法
          </button>
        </header>

        {error && (
          <div
            data-testid="app-error"
            onClick={clearError}
            style={{
              padding: '6px 16px',
              background: '#3d1418',
              color: '#f85149',
              fontSize: 12,
              borderBottom: '1px solid #21262d',
              cursor: 'pointer',
            }}
          >
            {error}（点击关闭）
          </div>
        )}

        {warning && (
          <div
            data-testid="app-warning"
            onClick={clearWarning}
            style={{
              padding: '6px 16px',
              background: '#3a2d0b',
              color: '#d29922',
              fontSize: 12,
              borderBottom: '1px solid #21262d',
              cursor: 'pointer',
            }}
          >
            {warning}（点击关闭）
          </div>
        )}

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
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
