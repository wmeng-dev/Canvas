// 弹层里的一条评论：正文（可编辑）+ 删除。
// 被 IdeaNode（节点级评论）与 CommentNode（画布自由气泡）共用。
// ⚠️ 单人使用、非协作场景：**不做回复 / 线程**，想补充就再写一条评论。
// 输入草稿遵循 D.9 的原则：**成功才清空**，失败保留用户敲的内容。

import { useEffect, useState } from 'react'
import type { CommentThread } from '../../shared/types'
import { useTreeStore } from '../store/treeStore'

export function CommentThreadPopover({ thread }: { thread: CommentThread }) {
  const updateCommentBody = useTreeStore((s) => s.updateCommentBody)
  const removeComment = useTreeStore((s) => s.removeComment)

  const [draft, setDraft] = useState(thread.body)

  // 切换到另一条 thread 时重置草稿（同组件实例被复用的场景）
  useEffect(() => {
    setDraft(thread.body)
  }, [thread.id, thread.body])

  return (
    <div
      className="comment-thread"
      data-testid="comment-thread"
      data-thread-id={thread.id}
      // NodeToolbar 的弹层在 DOM 上位于 pane 内部：不阻断冒泡的话，弹层里任何一次点击
      // 都会一路冒到 pane 的 onClick，把刚打开的评论弹层自己关掉（实测踩过）。
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        className="comment-input"
        data-testid="comment-root-input"
        value={draft}
        placeholder="写评论…"
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="comment-row">
        <button
          className="comment-btn primary"
          data-testid="comment-save-root"
          disabled={!draft.trim()}
          onClick={() => void updateCommentBody(thread.id, draft)}
        >
          保存
        </button>
        <span style={{ flex: 1 }} />
        <button
          className="comment-btn danger"
          data-testid="comment-delete"
          title="删除这条评论"
          onClick={() => void removeComment(thread.id)}
        >
          删除
        </button>
      </div>
    </div>
  )
}
