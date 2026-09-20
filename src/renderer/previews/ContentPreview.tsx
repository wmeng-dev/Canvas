// C.4 多类型预览分发：按 contentType 选择渲染方式。
// - markdown → react-markdown（不解析内嵌 HTML）
// - html     → 沙箱 iframe（sandbox=""，脚本不执行）
// - svg      → 沙箱 iframe（同上；SVG 可含 <script>，故不内联注入）
// - text     → <pre> 纯文本
// - image    → 占位提示（后续阶段实现）

import type { ContentType } from '../../shared/types'
import { MarkdownView } from './MarkdownView'
import { SandboxFrame } from './SandboxFrame'

const SVG_WRAPPER = (svg: string) =>
  `<body style="margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#0d1117">${svg}</body>`

export function ContentPreview({
  contentType,
  content,
}: {
  contentType?: ContentType
  content: string
}) {
  switch (contentType) {
    case 'html':
      return <SandboxFrame html={content} testId="preview-html" title="HTML 预览（沙箱）" height={260} />

    case 'svg':
      return (
        <SandboxFrame
          html={SVG_WRAPPER(content)}
          testId="preview-svg"
          title="SVG 预览（沙箱）"
          height={220}
        />
      )

    case 'text':
      return (
        <pre
          data-testid="preview-text"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
            fontSize: 13,
            lineHeight: 1.7,
            margin: 0,
            color: '#c9d1d9',
          }}
        >
          {content}
        </pre>
      )

    case 'image':
      return (
        <p data-testid="preview-image" style={{ color: '#7d8590', fontSize: 12 }}>
          图片预览将在后续阶段实现。
        </p>
      )

    case 'markdown':
    default:
      return <MarkdownView content={content} />
  }
}
