import { ReactFlowProvider } from '@xyflow/react'
import { CreativeTree } from './canvas/CreativeTree'
import { PreviewPanel } from './panels/PreviewPanel'

export function App() {
  return (
    <ReactFlowProvider>
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CreativeTree />
        </div>
        <PreviewPanel />
      </div>
    </ReactFlowProvider>
  )
}
