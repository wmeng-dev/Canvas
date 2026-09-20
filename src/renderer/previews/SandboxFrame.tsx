// 沙箱预览框：HTML / SVG 都经这里渲染。
// sandbox=""（空值）＝ 开启全部限制：禁脚本、禁表单、禁弹窗、禁顶层导航，
// 且 iframe 处于不透明源（opaque origin）—— 因此即使生成内容里带 <script>，
// 既不执行、也无法触达宿主页面。
//
// 注意判据：**不要**用 `contentDocument === null` 来判断隔离是否生效。宿主页是 file:// 时
// Chromium 仍允许父页读取沙箱 iframe 的文档（C.4 实测），所以那条断言会误判。
// 可靠判据是 `iframe.contentWindow.origin === 'null'`（不透明源）。

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
