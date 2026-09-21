// B.6 验证：示例 MCP Server 的 tool 集 —— `generate`（生成）+ 三个只读 tool（读画布）。
// 用 InMemoryTransport 在进程内把 Client 与 Server 对接，无需子进程/网络。
// 运行：先编译测试构建，再 `node tests/mcp-server.test.cjs`
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
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

  // ---------- 4) 三个只读 tool 已注册 ----------
  const READ_TOOLS = ['list_projects', 'get_tree', 'get_node']
  for (const n of READ_TOOLS) {
    assert.ok(names.includes(n), `read tool "${n}" registered, got: ${names.join(',')}`)
  }
  assert.strictEqual(names.length, 4, 'tool 集合应恰为 generate + 3 个只读，实得: ' + names.join(','))
  ok('listTools exposes generate + 3 read-only tools')

  // ---------- 5) 只读 tool 真的读到磁盘上的画布 JSON ----------
  const T = '2024-01-01T00:00:00.000Z'
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-mcpsrv-'))
  const projectsDir = path.join(dataDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  fs.writeFileSync(
    path.join(projectsDir, 'proj-1.json'),
    JSON.stringify({
      project: { id: 'proj-1', name: '读测试', createdAt: T, updatedAt: T },
      tree: {
        nodes: [
          {
            id: 'node-1',
            parentId: null,
            label: '结果标题',
            prompt: '用户原始描述',
            content: '正文',
            contentType: 'markdown',
            analysis: { feasibility: 70, pros: ['a'], cons: ['b'], risks: ['c'] },
            status: 'done',
            generatorId: null,
            versions: [{ id: 'v1', content: '正文', contentType: 'markdown', title: '结果标题', generatorId: null, createdAt: T }],
            currentVersionId: 'v1',
            createdAt: T,
            updatedAt: T,
          },
        ],
        edges: [],
      },
    }),
  )
  process.env.IDEASPROUT_DATA_DIR = dataDir

  const lp = await client.callTool({ name: 'list_projects', arguments: {} })
  assert.ok(!lp.isError, lp.content[0].text)
  const lpData = JSON.parse(lp.content[0].text)
  assert.strictEqual(lpData.length, 1)
  assert.strictEqual(lpData[0].id, 'proj-1')
  assert.strictEqual(lpData[0].nodeCount, 1)

  // 用「项目名」而不是 id 也能定位
  const gt = await client.callTool({ name: 'get_tree', arguments: { projectId: '读测试' } })
  assert.ok(!gt.isError, gt.content[0].text)
  const gtData = JSON.parse(gt.content[0].text)
  assert.strictEqual(gtData.nodes.length, 1)
  assert.strictEqual(gtData.nodes[0].label, '结果标题')
  assert.strictEqual(gtData.nodes[0].prompt, '用户原始描述')
  assert.ok(!('content' in gtData.nodes[0]), 'get_tree 默认不带正文（防止大树灌满上下文）')

  const gn = await client.callTool({
    name: 'get_node',
    arguments: { projectId: 'proj-1', nodeId: 'node-1' },
  })
  assert.ok(!gn.isError, gn.content[0].text)
  const gnData = JSON.parse(gn.content[0].text)
  assert.strictEqual(gnData.node.id, 'node-1')
  assert.strictEqual(gnData.node.versions.length, 1)
  ok('read-only tools read the canvas JSON (list_projects / get_tree / get_node)')

  // ---------- 6) 未知项目 → isError（不静默返回空） ----------
  const badProj = await client.callTool({ name: 'get_tree', arguments: { projectId: 'no-such-project' } })
  assert.ok(badProj.isError, 'unknown project must be isError')
  assert.ok(/找不到项目/.test(badProj.content[0].text), badProj.content[0].text)
  ok('unknown project => isError with a human-readable message')

  // ---------- 7) 数据目录无法定位 → isError 且给出怎么办 ----------
  // 临时清掉所有候选来源，保证"解析不到"这条分支确定命中（本机可能真有 dev 数据目录）
  const saved = { d: process.env.IDEASPROUT_DATA_DIR, a: process.env.APPDATA, l: process.env.LOCALAPPDATA, h: process.env.HOME }
  delete process.env.IDEASPROUT_DATA_DIR
  delete process.env.APPDATA
  delete process.env.LOCALAPPDATA
  delete process.env.HOME
  const noDir = await client.callTool({ name: 'list_projects', arguments: {} })
  Object.assign(process.env, {
    ...(saved.d ? { IDEASPROUT_DATA_DIR: saved.d } : {}),
    ...(saved.a ? { APPDATA: saved.a } : {}),
    ...(saved.l ? { LOCALAPPDATA: saved.l } : {}),
    ...(saved.h ? { HOME: saved.h } : {}),
  })
  assert.ok(noDir.isError, 'unresolvable data dir must be isError')
  assert.ok(/IDEASPROUT_DATA_DIR/.test(noDir.content[0].text), noDir.content[0].text)
  ok('unresolvable data dir => isError telling the user to set IDEASPROUT_DATA_DIR')

  await client.close()
  await server.close()
  console.log(`\nALL MCP SERVER TESTS PASSED (${passed} checks)`)
})().catch((e) => {
  console.error('MCP SERVER TEST FAILED:', e)
  process.exit(1)
})
