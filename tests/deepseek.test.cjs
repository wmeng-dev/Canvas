// B.5 验证：DeepSeek 直连 adapter（mock fetch，无需网络/密钥）。
// 运行：先重新编译测试构建，再 `node tests/deepseek.test.cjs`
const assert = require('assert')
const { DeepSeekGenerator } = require('../dist-test/core/generator/direct/deepseek')

;(async () => {
  let passed = 0
  const ok = (n) => { passed++; console.log('  ✓', n) }
  const calls = []

  // mock 一个成功响应
  global.fetch = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'deepseek-chat',
        choices: [{ message: { content: '## 发散结果\n- 子方向1\n- 子方向2' } }],
      }),
    }
  }

  const g = new DeepSeekGenerator({ apiKey: 'sk-test' })
  assert.strictEqual(g.id, 'deepseek-direct')
  assert.strictEqual(g.kind, 'direct')

  const out = await g.generate({
    projectId: 'p1',
    nodeId: 'n1',
    prompt: '请围绕主题发散',
    contentType: 'markdown',
  })
  assert.ok(out.text.includes('子方向'), 'content mapped')
  assert.strictEqual(out.contentType, 'markdown')
  assert.strictEqual(out.model, 'deepseek-chat')
  ok('generate returns mapped content + model')

  // 校验请求形态
  assert.strictEqual(calls.length, 1)
  const sent = JSON.parse(calls[0].init.body)
  assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer sk-test')
  assert.strictEqual(sent.model, 'deepseek-chat')
  assert.strictEqual(sent.messages[sent.messages.length - 1].role, 'user')
  assert.strictEqual(sent.messages[sent.messages.length - 1].content, '请围绕主题发散')
  ok('request carries Bearer key + correct model + user message')

  // 校验无 parentContext 时不注入 system 消息
  const calls2 = []
  global.fetch = async (url, init) => { calls2.push(init); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } }
  await g.generate({ projectId: 'p1', nodeId: 'n2', prompt: 'q' })
  const sent2 = JSON.parse(calls2[0].body)
  assert.strictEqual(sent2.messages.length, 1)
  ok('no parentContext => no system message')

  // 错误路径：非 2xx 抛出状态码
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
  await assert.rejects(
    () => g.generate({ projectId: 'p1', nodeId: 'n3', prompt: 'q' }),
    /401/,
  )
  ok('non-2xx throws with status code')

  console.log(`\nALL DEEPSEEK TESTS PASSED (${passed} checks)`)
})().catch((e) => {
  console.error('DEEPSEEK TEST FAILED:', e)
  process.exit(1)
})
