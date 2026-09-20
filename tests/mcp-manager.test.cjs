// B.7 验证：McpClientManager + McpAdapter —— 真实拉起子进程 MCP Server（stdio）。
// 用 DIVERGE_MCP_FAKE=1 让子进程使用确定性假生成器，避免联网。
// 运行：先编译测试构建，再 `node tests/mcp-manager.test.cjs`
const path = require('path')
const assert = require('assert')
const { McpClientManager } = require('../dist-test/core/mcp/McpClientManager')
const { McpAdapter } = require('../dist-test/core/mcp/McpAdapter')

;(async () => {
  let passed = 0
  const ok = (n) => { passed++; console.log('  ✓', n) }

  const serverPath = path.join(
    __dirname, '..', 'dist-test', 'core', 'mcp-server', 'workbuddy-mcp-server.js',
  )
  const manager = new McpClientManager()

  const toolNames = await manager.connect({
    id: 'example',
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, DIVERGE_MCP_FAKE: '1' },
  })
  assert.ok(toolNames.includes('generate'), 'tools: ' + toolNames.join(','))
  ok('spawned child MCP server over stdio; exposes "generate"')

  assert.ok(manager.isConnected('example'), 'manager tracks the connection')
  const tools = await manager.listTools('example')
  assert.ok(tools.find((t) => t.name === 'generate' && t.description), 'generate has description')
  ok('listTools returns generate (with description)')

  const adapter = new McpAdapter(manager, 'example', 'generate')
  assert.strictEqual(adapter.kind, 'mcp')
  assert.strictEqual(adapter.id, 'mcp:example:generate')
  const out = await adapter.generate({
    projectId: 'p1', nodeId: 'n1', prompt: 'hello', contentType: 'markdown',
  })
  assert.strictEqual(out.text, 'FAKE:hello')
  assert.strictEqual(out.contentType, 'markdown')
  assert.strictEqual(out.model, 'example:generate')
  ok('McpAdapter.generate() over real subprocess -> text + contentType')

  await manager.disconnectAll()
  assert.strictEqual(manager.isConnected('example'), false)
  ok('disconnectAll closes the connection')

  console.log(`\nALL MCP MANAGER TESTS PASSED (${passed} checks)`)
  process.exit(0)
})().catch((e) => {
  console.error('MCP MANAGER TEST FAILED:', e)
  process.exit(1)
})
