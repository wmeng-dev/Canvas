// Markdown 预览：用 react-markdown（默认不解析内嵌 HTML，等价于不开 rehype-raw，
// 因此生成内容里的 <script>/<img onerror> 只会被当纯文本显示，无 XSS 面）。

import Markdown from 'react-markdown'

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="md-body" data-testid="preview-markdown">
      <Markdown>{content}</Markdown>
    </div>
  )
}
