// 沙箱预览框：HTML / SVG 都经这里渲染。
// sandbox=""（空值）＝ 开启全部限制：禁脚本、禁表单、禁弹窗、禁顶层导航，
// 且 iframe 处于不透明源（opaque origin），父页面无法读取其 contentDocument。
// 因此即使生成内容里带 <script>，也不会执行、也无法触达宿主。

interface Props {
  html: string
  title?: string
  testId?: string
  height?: number
}

export function SandboxFrame({ html, title = '沙箱预览', testId, height = 240 }: Props) {
  return (
    <iframe
      data-testid={testId}
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={html}
      style={{
        width: '100%',
        height,
        border: '1px solid #30363d',
        borderRadius: 8,
        background: '#fff',
        display: 'block',
      }}
    />
  )
}
