// 想法回收站：画布底部居中的固定覆盖层。
// 拖想法卡片到它上面松手 = 归档（从画布隐藏，可随时取出）。

import { useState } from 'react'
import { toVisibilityNode, useTreeStore } from '../store/treeStore'
import { collectArchivedTopIds } from '../../shared/tree'

export function TrashBin({ highlight }: { highlight: boolean }) {
  const nodes = useTreeStore((s) => s.nodes)
  const restoreNode = useTreeStore((s) => s.restoreNode)
  const [open, setOpen] = useState(false)

  // 只列"顶层"被归档项：后代跟着祖先一起走，不重复占位
  const archivedIds = collectArchivedTopIds(nodes.filter((n) => n.type !== 'comment').map(toVisibilityNode))
  const archived = archivedIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n)
  const count = archived.length

  return (
    <div
      className={`trash-bin${highlight ? ' trash-bin--hot' : ''}`}
      data-testid="trash-bin"
      data-count={count}
      data-highlight={highlight ? '1' : '0'}
    >
      <button
        data-testid="trash-bin-toggle"
        className="trash-bin__bar"
        onClick={() => setOpen((v) => !v)}
        title={count > 0 ? '点击展开回收站，取出归档的想法' : '把不想要的想法卡片拖到这里'}
      >
        <span className="trash-bin__icon">🗑</span>
        <span>回收站</span>
        <span data-testid="trash-bin-count" className="trash-bin__count">
          {count}
        </span>
        <span className="trash-bin__caret">{open ? '▾' : '▴'}</span>
      </button>

      {open && (
        <div className="trash-bin__panel" data-testid="trash-bin-panel">
          {count === 0 ? (
            <div className="trash-bin__empty">还没有归档的想法。把卡片拖到这里即可归档。</div>
          ) : (
            <ul className="trash-bin__list">
              {archived.map((n) => (
                <li key={n.id} className="trash-bin__item" data-testid="trash-bin-item" data-node-id={n.id}>
                  <span className="trash-bin__label" title={n.data.prompt || n.data.label}>
                    {n.data.label}
                  </span>
                  <button
                    className="trash-bin__restore"
                    data-testid="trash-bin-restore"
                    onClick={() => {
                      void restoreNode(n.id)
                      if (count === 1) setOpen(false)
                    }}
                  >
                    取出
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
