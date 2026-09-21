// 历史画布抽屉：从左侧滑出，列出**所有**存过的画布文件，点一条即可打开。
//
// 与 tab 条的分工：tab 条只放"正在用"的画布，这里放"全部历史" ——
// 包括被关掉 tab 的（数据仍在磁盘，恢复只是把 id 从 closedProjectIds 里摘掉）。
// 之所以列全部而不只列已关闭：只列已关闭的话，没关过任何画布时抽屉是空的，
// 用户点开什么也看不到，会以为功能坏了。
//
// 抽屉是**覆盖**在画布上的（absolute），不挤占画布宽度 ——
// React Flow 对容器尺寸变化很敏感（见 CreativeTree 的测量兜底），push 布局会触发一次无谓的重排。

import { useEffect, useMemo } from 'react'
import { useTreeStore } from './store/treeStore'

interface HistoryRow {
  id: string
  name: string
  nodeCount: number
  updatedAt: string
  closed: boolean
}

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projects = useTreeStore((s) => s.projects)
  const closedProjects = useTreeStore((s) => s.closedProjects)
  const projectId = useTreeStore((s) => s.projectId)
  const projectName = useTreeStore((s) => s.projectName)
  const switchingProject = useTreeStore((s) => s.switchingProject)
  const switchProject = useTreeStore((s) => s.switchProject)
  const reopenProject = useTreeStore((s) => s.reopenProject)

  const liveCount = useTreeStore((s) => s.nodes.filter((n) => n.type !== 'comment').length)

  // ⚠️ 与 ProjectTabs 同样的兜底：**当前画布可能不在 projects 里**（如刚导入的外部项目），
  // 不补一条的话当前画布会从历史里"消失"。
  const openTabs = useMemo(() => {
    if (!projectId) return projects
    if (projects.some((p) => p.id === projectId)) return projects
    return [
      ...projects,
      { id: projectId, name: projectName, updatedAt: new Date().toISOString(), nodeCount: liveCount },
    ]
  }, [projects, projectId, projectName, liveCount])

  const rows = useMemo<HistoryRow[]>(() => {
    const opened = openTabs.map((p) => ({ ...p, closed: false }))
    const closed = closedProjects
      .filter((p) => !openTabs.some((q) => q.id === p.id))
      .map((p) => ({ ...p, closed: true }))
    return [...opened, ...closed].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  }, [openTabs, closedProjects])

  // Esc 收起（抽屉是覆盖层，键盘逃生口别省）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const openRow = (row: HistoryRow) => {
    if (row.id === projectId) {
      onClose()
      return
    }
    if (row.closed) void reopenProject(row.id)
    else void switchProject(row.id)
    onClose()
  }

  return (
    <div
      className={`history-drawer${open ? ' history-drawer--open' : ''}`}
      data-testid="history-drawer"
      data-open={open ? '1' : '0'}
      data-count={rows.length}
      aria-hidden={!open}
    >
      <div className="history-drawer__head">
        <span className="history-drawer__title">历史画布</span>
        <button
          className="history-drawer__close"
          data-testid="history-drawer-close"
          onClick={onClose}
          title="收起（Esc）"
        >
          ×
        </button>
      </div>

      <div className="history-drawer__list">
        {rows.length === 0 && <div className="history-drawer__empty">还没有画布</div>}
        {rows.map((row) => {
          const current = row.id === projectId
          return (
            <button
              key={row.id}
              className={`history-item${current ? ' history-item--current' : ''}`}
              data-testid="history-canvas-item"
              data-project-id={row.id}
              data-closed={row.closed ? '1' : '0'}
              data-current={current ? '1' : '0'}
              disabled={switchingProject}
              title={current ? '当前画布' : row.closed ? `重新打开「${row.name}」` : `切到「${row.name}」`}
              onClick={() => openRow(row)}
            >
              <span className="history-item__name">{row.name}</span>
              {current ? (
                <span className="history-item__tag history-item__tag--current">当前</span>
              ) : row.closed ? (
                <span className="history-item__tag">已关闭</span>
              ) : null}
              <span className="history-item__meta">
                {row.nodeCount} 个想法{row.updatedAt ? ` · ${fmtTime(row.updatedAt)}` : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
