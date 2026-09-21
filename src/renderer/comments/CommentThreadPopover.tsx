// 评论弹层里的一条 thread：根评论（可编辑）+ 回复列表 + 回复输入框。
// 被 IdeaNode（节点级评论）与 CommentNode（画布自由气泡）共用。
// 输入草稿遵循 D.9 的原则：**成功才清空**，失败保留用户敲的内容。

import { useEffect, useState } from 'react'
import type { CommentThread } from '../../shared/types'
import { useTreeStore } from '../store/treeStore'

export function CommentThreadPopover({ thread }: { thread: CommentThread }) {
  const updateCommentBody = useTreeStore((s) => s.updateCommentBody)
  const addReply = useTreeStore((s) => s.addReply)
  const removeComment = useTreeStore((s) => s.removeComment)
  const removeReply = useTreeStore((s) => s.removeReply)

  const [draft, setDraft] = useState(thread.body)
  const [reply, setReply] = useState('')

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
          title="删除整条评论（含回复）"
          onClick={() => void removeComment(thread.id)}
        >
          删除
        </button>
      </div>

      {thread.replies.length > 0 && (
        <ul className="comment-replies" data-testid="comment-replies" data-count={thread.replies.length}>
          {thread.replies.map((r) => (
            <li key={r.id} className="comment-reply" data-testid="comment-reply-item">
              <span className="comment-reply-body">{r.body}</span>
              <button
                className="comment-x"
                title="删除回复"
                onClick={() => void removeReply(thread.id, r.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        className="comment-input"
        data-testid="comment-reply-input"
        value={reply}
        placeholder="回复…"
        rows={2}
        onChange={(e) => setReply(e.target.value)}
      />
      <div className="comment-row">
        <button
          className="comment-btn primary"
          data-testid="comment-reply-send"
          disabled={!reply.trim()}
          onClick={async () => {
            const ok = await addReply(thread.id, reply)
            if (ok) setReply('') // 成功才清空；失败保留草稿
          }}
        >
          回复
        </button>
      </div>
    </div>
  )
}
