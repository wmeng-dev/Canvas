// B.5 / D.7 验证：DeepSeek 直连 adapter（mock fetch，无需网络/密钥）。
// 覆盖：请求形态（JSON 契约 system 提示 + response_format）、结构化响应解析、解析失败兜底、错误路径。
// 运行：先重新编译测试构建，再 `node tests/deepseek.test.cjs`
const assert = require('assert')
const { DeepSeekGenerator } = require('../dist-test/core/generator/direct/deepseek')

;(async () => {
  let passed = 0
  const ok = (n) => { passed++; console.log('  ✓', n) }

  const mockOnce = (content) => {
    const calls = []
    global.fetch = async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ model: 'deepseek-chat', choices: [{ message: { content } }] }),
      }
    }
    return calls
  }

  const g = new DeepSeekGenerator({ apiKey: 'sk-test' })
  assert.strictEqual(g.id, 'deepseek-direct')
  assert.strictEqual(g.kind, 'direct')

  // 1. 结构化响应：模型按契约返回 JSON → 标题 / 评估 / 正文 三样都被拆出来
  const structured = JSON.stringify({
    title: '把核心体验做减法',
    feasibility: 78,
    pros: ['实现成本低', '用户负担小'],
    cons: ['差异化不足'],
    risks: ['可能劝退重度用户'],
    content: '# 说明\n\n- 要点一\n- 要点二',
  })
  const calls1 = mockOnce(structured)
  const out = await g.generate({
    projectId: 'p1',
    nodeId: 'n1',
    prompt: '请围绕主题发散',
    contentType: 'markdown',
  })
  assert.strictEqual(out.title, '把核心体验做减法')
  assert.strictEqual(out.analysis.feasibility, 78)
  assert.deepStrictEqual(out.analysis.pros, ['实现成本低', '用户负担小'])
  assert.deepStrictEqual(out.analysis.cons, ['差异化不足'])
  assert.deepStrictEqual(out.analysis.risks, ['可能劝退重度用户'])
  assert.ok(out.text.includes('要点一'), 'content 作为正文')
  assert.ok(!out.text.includes('feasibility'), '正文里不应混进 JSON 字段名')
  assert.strictEqual(out.contentType, 'markdown')
  assert.strictEqual(out.model, 'deepseek-chat')
  ok('structured response -> title + analysis + body extracted')

  // 2. 请求形态：system 提示承载输出契约，user 消息是用户输入
  assert.strictEqual(calls1.length, 1)
  const sent = JSON.parse(calls1[0].init.body)
  assert.strictEqual(calls1[0].init.headers.Authorization, 'Bearer sk-test')
  assert.strictEqual(sent.model, 'deepseek-chat')
  assert.strictEqual(sent.messages.length, 2)
  assert.strictEqual(sent.messages[0].role, 'system')
  assert.strictEqual(sent.messages[1].role, 'user')
  assert.strictEqual(sent.messages[1].content, '请围绕主题发散')
  // OpenAI 兼容接口的 json_object 模式要求提示里出现 "json" 字样
  assert.ok(/json/i.test(sent.messages[0].content), 'system prompt mentions json')
  for (const field of ['title', 'feasibility', 'pros', 'cons', 'risks', 'content']) {
    assert.ok(sent.messages[0].content.includes(field), `contract declares ${field}`)
  }
  assert.deepStrictEqual(sent.response_format, { type: 'json_object' })
  ok('request carries contract system prompt + response_format=json_object')

  // 3. 正文格式随 contentType 变（契约文案要跟着走，否则 HTML 节点会被要求写 markdown）
  const callsHtml = mockOnce(structured)
  await g.generate({ projectId: 'p1', nodeId: 'n2', prompt: 'q', contentType: 'html' })
  const htmlSent = JSON.parse(callsHtml[0].init.body)
  assert.ok(/HTML/.test(htmlSent.messages[0].content), 'html 契约')
  const callsSvg = mockOnce(structured)
  await g.generate({ projectId: 'p1', nodeId: 'n3', prompt: 'q', contentType: 'svg' })
  const svgSent = JSON.parse(callsSvg[0].init.body)
  assert.ok(/<svg>/.test(svgSent.messages[0].content), 'svg 契约')
  ok('body format rule follows contentType (html / svg)')

  // 4. parentContext 进 system 消息
  const calls2 = mockOnce('{"title":"t","content":"c"}')
  await g.generate({ projectId: 'p1', nodeId: 'n4', prompt: 'q', parentContext: '父节点说了什么' })
  const sent2 = JSON.parse(calls2[0].init.body)
  assert.strictEqual(sent2.messages.length, 2)
  assert.ok(sent2.messages[0].content.includes('父节点说了什么'), 'parentContext injected into system')
  ok('parentContext is injected into the system message')

  // 5. 解析失败兜底：模型不守契约（普通文本）→ 正文原样保留、无标题无评估，生成不失败
  const calls3 = mockOnce('## 发散结果\n- 子方向1\n- 子方向2')
  const plain = await g.generate({ projectId: 'p1', nodeId: 'n5', prompt: 'q' })
  assert.ok(plain.text.includes('子方向1'), 'plain text preserved as body')
  assert.strictEqual(plain.text.slice(0, 2), '##', 'body is exactly the raw text')
  assert.strictEqual(plain.title, undefined, 'no title when model ignores the contract')
  assert.ok(!plain.analysis, 'no analysis when model ignores the contract')
  ok('unparseable response degrades to plain body (generation still succeeds)')

  // 6. 围栏包裹 + 前置寒暄也能解析（模型常见写法）
  const fenced = '好的，这是结果：\n```json\n{"title":"围栏标题","feasibility":"62%","pros":["a"],"content":"正文"}\n```'
  mockOnce(fenced)
  const fencedOut = await g.generate({ projectId: 'p1', nodeId: 'n6', prompt: 'q' })
  assert.strictEqual(fencedOut.title, '围栏标题')
  assert.strictEqual(fencedOut.analysis.feasibility, 62, '"62%" -> 62')
  assert.strictEqual(fencedOut.text, '正文')
  ok('fenced / chit-chat wrapped json still parses')

  // 7. 错误路径：非 2xx 抛出状态码
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
  await assert.rejects(
    () => g.generate({ projectId: 'p1', nodeId: 'n7', prompt: 'q' }),
    /401/,
  )
  ok('non-2xx throws with status code')

  console.log(`\nALL DEEPSEEK TESTS PASSED (${passed} checks)`)
})().catch((e) => {
  console.error('DEEPSEEK TEST FAILED:', e)
  process.exit(1)
})
