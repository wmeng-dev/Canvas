// C.3 生成对话框：输入一个想法 → 调用主进程生成 → 作为新节点落入画布。
// 纯受控组件，状态取自 treeStore（Zustand）。
//
// ⚠️ **默认落点是画布的"顶层主题节点"，不是"根层"。**
// 挂根层的话，一次发散 3 条会得到 3 个并列的孤立根节点 —— 画布看着散，也没有统一父上下文。
// 画布还没有顶层节点时（新建后第一次发散），这里会多问一个「主题」：
// 可以直接写，也可以让 AI 生成；它会成为顶层节点，发散结果都挂在它下面。
//
// 结构照 styles.css 的 `.dialog-backdrop > .dialog` 约定写（遮罩负责压暗 + 点击关闭，
// 面板负责材质），**不要在这里写内联外观样式**——内联会盖掉材质/动效。

import { useEffect, useState } from 'react'
import { useTreeStore } from '../store/treeStore'
import type { ContentType } from '../../shared/types'

/** 可选内容类型（image 留待后续阶段） */
const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: '纯文本' },
  { value: 'html', label: 'HTML' },
  { value: 'svg', label: 'SVG' },
]

export function GenerateDialog() {
  const open = useTreeStore((s) => s.dialogOpen)
  const parentId = useTreeStore((s) => s.dialogParentId)
  const nodes = useTreeStore((s) => s.nodes)
  const generators = useTreeStore((s) => s.generators)
  const generating = useTreeStore((s) => s.generating)
  const error = useTreeStore((s) => s.error)
  const closeDialog = useTreeStore((s) => s.closeDialog)
  const generate = useTreeStore((s) => s.generate)
  const suggestTheme = useTreeStore((s) => s.suggestTheme)

  const [prompt, setPrompt] = useState('')
  const [generatorId, setGeneratorId] = useState('')
  const [contentType, setContentType] = useState<ContentType>('markdown')
  const [count, setCount] = useState(1)
  const [theme, setTheme] = useState('')
  const [themeBusy, setThemeBusy] = useState(false)
  const [themeErr, setThemeErr] = useState<string | null>(null)

  // 每次打开时重置输入，并默认选中首个生成器
  useEffect(() => {
    if (open) {
      setPrompt('')
      setCount(1)
      setTheme('')
      setThemeBusy(false)
      setThemeErr(null)
      setGeneratorId((prev) => prev || generators[0]?.id || '')
    }
  }, [open, generators])

  if (!open) return null

  const parentLabel = parentId
    ? nodes.find((n) => n.id === parentId)?.data.label ?? '（未知节点）'
    : null
  /** 画布的顶层主题节点：`parentId === null` 的想法节点（评论气泡不算） */
  const topNode = nodes.find((n) => n.type !== 'comment' && (n.data.parentId ?? null) === null)
  /** 只有"没指定父节点、且画布连顶层节点都还没有"时，才需要用户先定一个主题 */
  const needTheme = !parentId && !topNode

  const runSuggest = async () => {
    setThemeBusy(true)
    setThemeErr(null)
    try {
      // 把当前输入当作"参考方向"传进去：用户已经打了两个词时，AI 顺着它想更准
      setTheme(await suggestTheme(theme))
    } catch (e) {
      setThemeErr(`生成主题失败：${(e as Error).message}`)
    } finally {
      setThemeBusy(false)
    }
  }

  const submit = () => {
    if (generating || themeBusy) return
    void generate(
      prompt,
      generatorId || undefined,
      contentType,
      count,
      needTheme ? theme.trim() || undefined : undefined,
    )
  }

  return (
    <div
      data-testid="generate-dialog"
      className="dialog-backdrop"
      onClick={() => !generating && closeDialog()}
    >
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog__title">发散新想法</h2>
        <p className="dialog__sub">
          {parentLabel
            ? `基于「${parentLabel}」继续发散`
            : topNode
              ? `发散结果会挂在顶层主题「${topNode.data.label}」下面`
              : '这张画布还没有主题节点 —— 先给它定一个主题，发散结果都挂在它下面'}
        </p>

        <textarea
          data-testid="prompt-input"
          className="textarea"
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想探索的方向，例如：把核心体验做减法，只保留一条主线。"
          rows={4}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />

        {needTheme && (
          <div className="field">
            <label className="field__label">主题</label>
            <input
              data-testid="theme-input"
              className="input"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="例如：把核心体验做减法"
              style={{ flex: 1 }}
            />
            <button
              data-testid="suggest-theme"
              className="btn"
              disabled={generating || themeBusy}
              onClick={() => void runSuggest()}
            >
              {themeBusy ? '生成中…' : '✨ AI 生成'}
            </button>
          </div>
        )}
        {needTheme && (
          <p className="field__hint">
            可以直接写，也可以让 AI 想一个（先打两个关键词当参考方向会更准）。留空则用默认主题「创意主题」。
          </p>
        )}

        {themeErr && (
          <p data-testid="theme-error" className="dialog__error">
            {themeErr}
          </p>
        )}

        <div className="field">
          <label className="field__label">生成器</label>
          <select
            data-testid="generator-select"
            className="select"
            value={generatorId}
            onChange={(e) => setGeneratorId(e.target.value)}
            style={{ flex: 1 }}
          >
            {generators.length === 0 && <option value="">（无可用生成器）</option>}
            {generators.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}（{g.kind}）
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label">内容类型</label>
          <select
            data-testid="content-type-select"
            className="select"
            value={contentType}
            onChange={(e) => setContentType(e.target.value as ContentType)}
            style={{ flex: 1 }}
          >
            {CONTENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label">一次发散</label>
          <select
            data-testid="count-select"
            className="select"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{ width: 96 }}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} 条
              </option>
            ))}
          </select>
          <span className="field__hint">{count > 1 ? '多条并发，旧节点保留' : '单条生成'}</span>
        </div>

        {error && (
          <p data-testid="dialog-error" className="dialog__error">
            {error}
          </p>
        )}

        <div className="dialog__actions">
          <button className="btn" onClick={() => closeDialog()} disabled={generating}>
            取消
          </button>
          <button
            data-testid="submit-generate"
            className="btn btn--primary"
            onClick={submit}
            disabled={generating || themeBusy}
          >
            {generating ? '生成中…' : '生成'}
          </button>
        </div>
      </div>
    </div>
  )
}
