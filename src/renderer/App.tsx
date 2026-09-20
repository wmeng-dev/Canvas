// C.3 应用外壳：顶栏（项目名 + 新增想法）+ 画布 + 预览面板 + 生成对话框。

import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { CreativeTree } from './canvas/CreativeTree'
import { PreviewPanel } from './panels/PreviewPanel'
import { GenerateDialog } from './dialogs/GenerateDialog'
import { useTreeStore } from './store/treeStore'

export function App() {
  const projectName = useTreeStore((s) => s.projectName)
  const init = useTreeStore((s) => s.init)
  const openDialog = useTreeStore((s) => s.openDialog)
  const error = useTreeStore((s) => s.error)

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
          <span style={{ fontSize: 12, color: '#7d8590' }}>{projectName}</span>
          <div style={{ flex: 1 }} />
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
            style={{
              padding: '6px 16px',
              background: '#3d1418',
              color: '#f85149',
              fontSize: 12,
              borderBottom: '1px solid #21262d',
            }}
          >
            {error}
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
    </ReactFlowProvider>
  )
}
