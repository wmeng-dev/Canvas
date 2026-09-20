import { ReactFlowProvider } from '@xyflow/react'
import { CreativeTree } from './canvas/CreativeTree'

export function App() {
  return (
    <ReactFlowProvider>
      <CreativeTree />
    </ReactFlowProvider>
  )
}
