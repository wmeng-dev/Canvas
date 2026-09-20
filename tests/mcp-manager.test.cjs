// B.7 验证：McpClientManager + McpAdapter —— 真实拉起子进程 MCP Server（stdio）。
// 用 DIVERGE_MCP_FAKE=1 让子进程使用确定性假生成器，避免联网。
// 运行：先编译测试构建，再 `node tests/mcp-manager.test.cjs`
const path = require('path')
const fs = require('fs')
const os = require('os')
const assert = require('assert')
const { McpClientManager } = require('../dist-test/core/mcp/McpClientManager')
const { McpAdapter } = require('../dist-test/core/mcp/McpAdapter')

;(async () => {
  let passed = 0
  const ok = (n) => { passed++; console.log('  ✓', n) }

  const serverPath = path.join(
    __dirname, '..', 'dist-test', 'core', 'mcp-server', 'workbuddy-mcp-server.js',
  )

  // 给子进程一份真实的画布数据目录。**必须在 connect 之前设好**：
  // 子进程的环境变量在 spawn 那一刻就固定了。
  // ⚠️ 这也顺便验证了 app.ts 必须显式注入 DIVERGE_DATA_DIR 的必要性 ——
  // SDK 只继承安全白名单变量，这里靠 {...process.env} 显式带上。
  const T = '2024-01-01T00:00:00.000Z'
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diverge-mgr-'))
  const projectsDir = path.join(dataDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  fs.writeFileSync(
    path.join(projectsDir, 'proj-1.json'),
    JSON.stringify({
      project: { id: 'proj-1', name: '子进程读测试', createdAt: T, updatedAt: T },
      tree: {
        nodes: [
          {
            id: 'node-1', parentId: null, label: '结果标题', prompt: '原始描述',
            content: '正文', contentType: 'markdown', analysis: null, status: 'done',
            generatorId: null,
            versions: [{ id: 'v1', content: '正文', contentType: 'markdown', title: '结果标题', generatorId: null, createdAt: T }],
            currentVersionId: 'v1', createdAt: T, updatedAt: T,
          },
        ],
        edges: [],
      },
    }),
  )
  process.env.DIVERGE_DATA_DIR = dataDir

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

  // 只读标注必须能穿过真实 SDK 往返回来 —— core/ai-backends.ts 靠它把只读 tool
  // 排除在"生成后端"之外，标注丢了会让三个读工具污染生成器下拉。
  assert.strictEqual(tools.find((t) => t.name === 'generate').readOnly, false, 'generate 不是只读')
  for (const n of ['list_projects', 'get_tree', 'get_node']) {
    const t = tools.find((x) => x.name === n)
    assert.ok(t, `read tool "${n}" present, got: ${tools.map((x) => x.name).join(',')}`)
    assert.strictEqual(t.readOnly, true, `${n} 应带 readOnlyHint=true`)
  }
  ok('annotations.readOnlyHint round-trips over real stdio (generate=false, 3 read tools=true)')

  // 只读 tool 经真实子进程读到画布 JSON（证明"独立进程直读文件"这条路真的通）
  const lp = JSON.parse(await manager.callTool('example', 'list_projects', {}))
  assert.strictEqual(lp.length, 1)
  assert.strictEqual(lp[0].id, 'proj-1')
  const gn = JSON.parse(
    await manager.callTool('example', 'get_node', { projectId: 'proj-1', nodeId: 'node-1' }),
  )
  assert.strictEqual(gn.node.versions.length, 1)
  ok('read-only tools over real subprocess -> canvas JSON (list_projects / get_node)')

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
