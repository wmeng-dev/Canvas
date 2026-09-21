// D.1 单文件 HTML 导出：把 ExportDoc 渲染成自包含的 .html（内联全部 CSS，无 CDN、无外部请求）。
//
// 关键取舍：每个节点的正文**复用应用内的预览组件**（ContentPreview → MarkdownView / SandboxFrame），
// 用 react-dom/server 静态渲染成字符串。这样"导出所见"与"应用内预览所见"必然一致，
// 也避免在 core 层另写一个 markdown→HTML 解析器（那会与预览逐日漂移）。
//
// 安全姿态与预览一致：html / svg 正文进 `<iframe sandbox="">`，脚本不执行、也触达不到文档本身。

import { renderToStaticMarkup } from 'react-dom/server'
import type { ExportDoc, ExportNode } from '../../core/export'
import { feasibilityBand, hasAnalysis } from '../../shared/analysis'
import { ContentPreview } from '../previews/ContentPreview'

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c])
}

const TYPE_LABEL: Record<string, string> = {
  markdown: 'Markdown',
  text: '纯文本',
  html: 'HTML',
  svg: 'SVG',
  image: '图片',
}

/** 文档样式：与应用深色主题一致（正文预览的配色是深色内联的，浅色底会对比失衡）。 */
const DOC_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 0 64px;
  background: #0d1117; color: #e6edf3;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px; line-height: 1.7;
}
.wrap { max-width: 860px; margin: 0 auto; padding: 0 24px; }
header.doc { border-bottom: 1px solid #21262d; padding: 40px 0 20px; margin-bottom: 24px; }
header.doc h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.3; }
.meta { margin: 0; color: #8b949e; font-size: 12px; }
nav.toc { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 14px 18px; margin-bottom: 32px; }
nav.toc h2 { margin: 0 0 8px; font-size: 13px; color: #8b949e; font-weight: 600; letter-spacing: .04em; }
nav.toc ol { margin: 0; padding-left: 0; list-style: none; }
nav.toc li { margin: 3px 0; }
nav.toc a { color: #58a6ff; text-decoration: none; font-size: 13px; }
nav.toc a:hover { text-decoration: underline; }
section.node { border-top: 1px solid #21262d; padding: 22px 0 6px; }
section.node:first-of-type { border-top: none; }
section.node h2, section.node h3, section.node h4, section.node h5, section.node h6 {
  margin: 0 0 6px; color: #e6edf3; line-height: 1.35;
}
section.node h2 { font-size: 20px; }
section.node h3 { font-size: 17px; }
section.node h4, section.node h5, section.node h6 { font-size: 15px; }
.badges { margin: 0 0 10px; color: #8b949e; font-size: 11px; }
.badges span { border: 1px solid #30363d; border-radius: 10px; padding: 1px 8px; margin-right: 6px; }
.prompt { margin: 0 0 12px; padding: 8px 12px; border-left: 3px solid #30363d; background: #161b22; color: #8b949e; font-size: 12.5px; }
/* 发散评估：可行性一行 + 优点/缺点/风险三组 */
.analysis { margin: 0 0 14px; padding: 12px 14px; background: #161b22; border: 1px solid #21262d; border-radius: 8px; }
.analysis .feas { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.analysis .feas .label { color: #8b949e; font-size: 12.5px; }
.analysis .feas .pct { font-size: 18px; font-weight: 700; line-height: 1; }
.analysis .feas .band { font-size: 11px; border: 1px solid currentColor; border-radius: 10px; padding: 0 7px; }
.analysis .feas .bar { flex: 1 1 120px; min-width: 120px; height: 6px; border-radius: 3px; background: #30363d; overflow: hidden; }
.analysis .feas .bar i { display: block; height: 100%; border-radius: 3px; }
.analysis ul { list-style: none; margin: 0; padding: 0; }
.analysis li { font-size: 12.5px; color: #c9d1d9; margin: 3px 0; padding-left: 46px; position: relative; }
.analysis li b { position: absolute; left: 0; font-weight: 600; font-size: 12px; }
.analysis li.pros b { color: #3fb950; }
.analysis li.cons b { color: #d29922; }
.analysis li.risks b { color: #f85149; }
.content { margin: 0; }
.content pre.text-block {
  white-space: pre-wrap; word-break: break-word; background: #010409;
  border: 1px solid #21262d; border-radius: 6px; padding: 12px;
  font-size: 12.5px; color: #c9d1d9; margin: 0; overflow-x: auto;
}
.content iframe { display: block; width: 100%; border: 1px solid #30363d; border-radius: 8px; background: #fff; }
.empty { color: #6e7681; font-size: 12.5px; margin: 0; }
footer.doc { margin-top: 40px; padding-top: 16px; border-top: 1px solid #21262d; color: #6e7681; font-size: 11.5px; }

/* Markdown 排版（与 src/renderer/styles.css 的 .md-body 保持一致） */
.md-body { font-size: 13.5px; line-height: 1.75; color: #c9d1d9; word-break: break-word; }
.md-body > :first-child { margin-top: 0; }
.md-body h1, .md-body h2, .md-body h3 { color: #e6edf3; line-height: 1.35; margin: 16px 0 8px; }
.md-body h1 { font-size: 17px; border-bottom: 1px solid #21262d; padding-bottom: 6px; }
.md-body h2 { font-size: 15px; }
.md-body h3 { font-size: 14px; }
.md-body p { margin: 0 0 10px; }
.md-body ul, .md-body ol { margin: 0 0 10px; padding-left: 20px; }
.md-body li { margin: 2px 0; }
.md-body a { color: #58a6ff; }
.md-body code { background: #161b22; border: 1px solid #21262d; border-radius: 4px; padding: 1px 5px; font-size: 12px; }
.md-body pre { background: #010409; border: 1px solid #21262d; border-radius: 6px; padding: 10px; overflow-x: auto; }
.md-body pre code { background: none; border: none; padding: 0; }
.md-body blockquote { margin: 0 0 10px; padding: 6px 10px; border-left: 3px solid #30363d; background: #161b22; color: #8b949e; }
.md-body hr { border: none; border-top: 1px solid #21262d; margin: 14px 0; }
.md-body table { border-collapse: collapse; width: 100%; margin: 0 0 10px; }
.md-body th, .md-body td { border: 1px solid #21262d; padding: 5px 8px; text-align: left; }
.md-body img { max-width: 100%; }
`

function anchorId(nodeId: string): string {
  return `node-${nodeId.replace(/[^A-Za-z0-9_-]/g, '')}`
}

function headingLevel(depth: number): number {
  return Math.min(depth + 2, 6)
}

/** 单节点正文：复用应用内预览组件，保证与预览完全一致。 */
function renderContent(node: ExportNode): string {
  if (!node.content) return '<p class="empty">（该节点暂无内容）</p>'
  // text 用纯 <pre>（与预览一致）；markdown/html/svg 走 ContentPreview
  return renderToStaticMarkup(
    <div className="content">
      <ContentPreview contentType={node.contentType} content={node.content} />
    </div>,
  )
}

/** 评估区块：无评估内容时返回空串（旧节点 / 第三方后端不显示空盒子）。 */
function renderAnalysis(node: ExportNode): string {
  const a = node.analysis
  if (!hasAnalysis(a)) return ''
  const band = feasibilityBand(a.feasibility)
  const rows: string[] = []
  const push = (cls: string, name: string, items: string[]): void => {
    for (const it of items) rows.push(`<li class="${cls}"><b>${name}</b>${esc(it)}</li>`)
  }
  push('pros', '优点', a.pros)
  push('cons', '缺点', a.cons)
  push('risks', '风险', a.risks)
  return [
    '<div class="analysis">',
    '<div class="feas">',
    '<span class="label">可行性</span>',
    `<span class="pct" style="color:${band.color}">${a.feasibility}%</span>`,
    `<span class="band" style="color:${band.color}">${band.label}</span>`,
    `<span class="bar"><i style="width:${a.feasibility}%;background:${band.color}"></i></span>`,
    '</div>',
    rows.length ? `<ul>${rows.join('')}</ul>` : '',
    '</div>',
  ].join('')
}

function renderSection(node: ExportNode): string {
  const level = headingLevel(node.depth)
  const tag = `h${level}`
  const badges: string[] = [`<span>${esc(TYPE_LABEL[node.contentType] ?? node.contentType)}</span>`]
  if (node.versionCount > 1) {
    badges.push(`<span>v${node.versionNumber} / 共 ${node.versionCount} 版</span>`)
  }
  const prompt = node.prompt
    ? `<p class="prompt">提示词：${esc(node.prompt)}</p>`
    : ''
  return [
    `<section class="node" id="${anchorId(node.id)}">`,
    `<${tag}>${esc(node.label || '未命名')}</${tag}>`,
    `<p class="badges">${badges.join('')}</p>`,
    prompt,
    renderAnalysis(node),
    renderContent(node),
    `</section>`,
  ].join('\n')
}

function renderToc(doc: ExportDoc): string {
  if (doc.nodes.length === 0) return ''
  const items = doc.nodes
    .map(
      (n) =>
        `<li style="padding-left:${n.depth * 14}px"><a href="#${anchorId(n.id)}">${esc(n.label || '未命名')}</a></li>`,
    )
    .join('\n')
  return `<nav class="toc">\n<h2>目录</h2>\n<ol>\n${items}\n</ol>\n</nav>`
}

export function renderStandaloneHtml(doc: ExportDoc): string {
  const scopeLabel = doc.scope === 'path' ? '收敛路径（根 → 选中节点）' : '完整发散树'
  const body =
    doc.nodes.length === 0
      ? '<p class="empty">（当前范围没有可导出的节点）</p>'
      : doc.nodes.map(renderSection).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.projectName)} · 风衍 IdeaSprout</title>
<style>${DOC_CSS}</style>
</head>
<body>
<div class="wrap">
<header class="doc">
<h1>${esc(doc.projectName)}</h1>
<p class="meta">导出时间：${esc(doc.exportedAt)}　｜　范围：${esc(scopeLabel)}　｜　节点数：${doc.nodes.length}</p>
</header>
${renderToc(doc)}
<main>
${body}
</main>
<footer class="doc">由「风衍 IdeaSprout」导出 · 单文件 HTML（含内联样式，无外部依赖）</footer>
</div>
</body>
</html>
`
}
