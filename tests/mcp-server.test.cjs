// B.6 验证：示例 MCP Server 的 `generate` tool。
// 用 InMemoryTransport 在进程内把 Client 与 Server 对接，无需子进程/网络。
// 运行：先编译测试构建，再 `node tests/mcp-server.test.cjs`
const assert = require('assert')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js')
const { createMcpServer } = require('../dist-test/core/mcp-server/workbuddy-mcp-server')

;(async () => {
  let passed = 0
  const ok = (n) => { passed++; console.log('  ✓', n) }

  // 假生成器：不发网络请求
  const fakeGenerator = {
    id: 'fake',
    label: 'Fake',
    kind: 'direct',
    async generate(spec) {
      return {
        contentType: spec.contentType || 'text',
        text: 'FAKE:' + spec.prompt,
        model: 'fake',
        finishedAt: new Date().toISOString(),
      }
    },
  }

  const server = createMcpServer(fakeGenerator)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} })

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  // 1) listTools 能看到 generate
  const listed = await client.listTools()
  const names = listed.tools.map((t) => t.name)
  assert.ok(names.includes('generate'), 'generate tool registered, got: ' + names.join(','))
  const genTool = listed.tools.find((t) => t.name === 'generate')
  assert.ok(genTool.description, 'tool has description')
  assert.ok(genTool.inputSchema, 'tool has inputSchema (zod -> json schema)')
  ok('listTools exposes "generate" with description + inputSchema')

  // 2) callTool 正常路径
  const res = await client.callTool({
    name: 'generate',
    arguments: { projectId: 'p1', nodeId: 'n1', prompt: 'hello', contentType: 'markdown' },
  })
  assert.ok(res.content && res.content.length, 'result has content')
  assert.strictEqual(res.content[0].text, 'FAKE:hello')
  ok('callTool generate returns generator text')

  // 3) 缺少必填参数 → 不应静默成功（返回 isError 或抛错）
  let bad
  try {
    bad = await client.callTool({ name: 'generate', arguments: { projectId: 'p1', nodeId: 'n1' } })
  } catch (e) {
    bad = { isError: true }
  }
  assert.ok(bad.isError, 'missing required "prompt" must not succeed')
  ok('missing required arg => isError (no silent success)')

  await client.close()
  await server.close()
  console.log(`\nALL MCP SERVER TESTS PASSED (${passed} checks)`)
})().catch((e) => {
  console.error('MCP SERVER TEST FAILED:', e)
  process.exit(1)
})
