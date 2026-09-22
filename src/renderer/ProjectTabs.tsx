// 画布 tab 条：一张画布一个 tab，点击切换，末尾「＋」新建空白画布。
// 当前 tab 里内嵌可编辑的画布名（= 顶栏原来的 project-name 输入框，搬到这里避免名字显示两遍）。
//
// 最左边是「历史画布」按钮：点开左侧抽屉（HistoryDrawer），列出**全部**画布文件供打开。
// 抽屉由 App 渲染（要覆盖在画布区域上），这里只负责触发，所以 open 状态不放在本组件里。

import { useEffect, useRef, useState } from 'react'
import { useTreeStore } from './store/treeStore'

export function ProjectTabs({ onOpenHistory }: { onOpenHistory: () => void }) {
  const projects = useTreeStore((s) => s.projects)
  const projectId = useTreeStore((s) => s.projectId)
  const projectName = useTreeStore((s) => s.projectName)
  const switchingProject = useTreeStore((s) => s.switchingProject)
  const switchProject = useTreeStore((s) => s.switchProject)
  const createProject = useTreeStore((s) => s.createProject)
  const renameProject = useTreeStore((s) => s.renameProject)
  const closedProjects = useTreeStore((s) => s.closedProjects)
  const closeProject = useTreeStore((s) => s.closeProject)

  /**
   * 当前画布的节点数**用本地实时值**：`projects` 是后端返回的快照，生成/删节点后不会自动刷新，
   * 若照抄快照会出现"画布上有 3 个节点、tab 上写 0"。
   * 其余 tab 一律用快照 —— 它们的内容此刻不可能变，没必要为每个 tab 多打一次 IPC。
   */
  const liveCount = useTreeStore((s) => s.nodes.filter((n) => n.type !== 'comment').length)

  const [nameDraft, setNameDraft] = useState(projectName)
  useEffect(() => {
    setNameDraft(projectName)
  }, [projectName])
  // 切画布时若正在编辑旧名字，先把草稿丢掉（新画布的 projectName 会刷新 draft）
  const lastId = useRef(projectId)
  useEffect(() => {
    if (lastId.current !== projectId) lastId.current = projectId
  }, [projectId])

  const commitName = () => {
    const next = nameDraft.trim()
    if (next && next !== projectName) void renameProject(next)
    else setNameDraft(projectName)
  }

  const tabs =
    projectId && projects.some((p) => p.id === projectId)
      ? projects
      : projectId
        ? [
            ...projects,
            { id: projectId, name: projectName, updatedAt: new Date().toISOString(), nodeCount: liveCount },
          ]
        : projects

  return (
    <div
      className="project-tabs"
      data-testid="project-tabs"
      data-count={tabs.length}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 4,
        padding: '0 12px',
        background: '#0d1117',
        borderBottom: '1px solid #21262d',
        overflowX: 'auto',
        flex: '0 0 auto',
      }}
    >
      {/* 「历史画布」在 tab 条最左边：点开左侧抽屉，可挑任意历史画布打开（含已关闭的） */}
      <button
        data-testid="history-canvases-toggle"
        className="project-tab-history"
        onClick={onOpenHistory}
        title="历史画布：所有画布文件（含已关闭的，数据都还在）"
      >
        历史画布
        <span className="project-tab-history__count" data-testid="history-closed-count">
          {closedProjects.length}
        </span>
      </button>

      {tabs.map((p) => {
        const active = p.id === projectId
        return (
          <div
            key={p.id}
            className={`project-tab${active ? ' project-tab--active' : ''}`}
            data-testid="project-tab"
            data-project-id={p.id}
            data-active={active ? '1' : '0'}
            onClick={() => {
              if (!active) void switchProject(p.id)
            }}
            title={active ? '当前画布（可直接改名字）' : `切到「${p.name}」`}
          >
            {active ? (
              <input
                data-testid="project-name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                onClick={(e) => e.stopPropagation()}
                className="project-tab__name-input"
              />
            ) : (
              <span className="project-tab__name">{p.name}</span>
            )}
            <span className="project-tab__count" title="想法节点数" data-testid="project-tab-count">
              {active ? liveCount : p.nodeCount}
            </span>
            {/*
              关闭 tab：**不删画布数据**，只是从 tab 条移除，之后可从「已关闭」恢复。
              所以要 stopPropagation —— 否则点 × 会先触发 tab 的 onClick 去切画布。
            */}
            <button
              className="project-tab__close"
              data-testid="close-canvas"
              data-project-id={p.id}
              disabled={switchingProject}
              title={`关闭「${p.name}」（画布数据保留，可从「已关闭」恢复）`}
              onClick={(e) => {
                e.stopPropagation()
                void closeProject(p.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}

      <button
        data-testid="new-canvas"
        className="project-tab-new"
        disabled={switchingProject}
        onClick={() => void createProject()}
        title="新建一张空白画布（第一次发散时会让你定主题，作为顶层节点）"
      >
        {switchingProject ? '切换中…' : '＋ 新建画布'}
      </button>

    </div>
  )
}
