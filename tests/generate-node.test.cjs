// C.3 验证：主进程"生成子节点并落库"核心逻辑（不依赖 Electron / 网络）。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/generate-node.test.cjs`
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { createServices, ensureProject } = require('../dist-test/core/services')
const { generateNode } = require('../dist-test/core/generate-node')

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'diverge-gen-'))

// 1. 服务装配：注册 fake 生成器并成为默认
const svc = createServices({ dataDir: base, fakeGenerator: true })
assert.strictEqual(svc.registry.list().length, 1)
assert.strictEqual(svc.defaultGeneratorId, 'fake')
ok('createServices registers fake generator as default')

// 2. ensureProject：首次进入自动建项目 + 根节点
const file = ensureProject(svc)
const projectId = file.project.id
assert.ok(projectId, 'project created')
assert.strictEqual(file.tree.nodes.length, 1)
assert.strictEqual(file.tree.nodes[0].label, '创意主题')
assert.strictEqual(file.tree.nodes[0].status, 'empty')
const rootId = file.tree.nodes[0].id
ok('ensureProject bootstraps project + root node')

// 3. 幂等：再次 ensureProject 返回同一项目
assert.strictEqual(ensureProject(svc).project.id, projectId)
assert.strictEqual(ensureProject(svc).tree.nodes.length, 1)
ok('ensureProject is idempotent')

// 4. 生成子节点：走 GeneratorRegistry → fake → 落库
;(async () => {
  const res = await generateNode(svc, {
    projectId,
    parentNodeId: rootId,
    prompt: '方向 A：把核心体验做减法',
    position: { x: 280, y: 0 },
  })
  assert.strictEqual(res.node.label, '方向 A：把核心体验做减法')
  assert.strictEqual(res.node.status, 'done')
  assert.strictEqual(res.node.generatorId, 'fake')
  assert.strictEqual(res.node.parentId, rootId)
  assert.deepStrictEqual(res.node.position, { x: 280, y: 0 })
  assert.ok(res.node.content.includes('方向 A：把核心体验做减法'), 'content carries prompt')
  assert.ok(res.edge, 'edge returned')
  assert.strictEqual(res.edge.source, rootId)
  assert.strictEqual(res.edge.target, res.node.id)
  ok('generateNode creates node + edge via generator')

  // 5. 落盘校验
  const after = svc.repo.get(projectId)
  assert.strictEqual(after.tree.nodes.length, 2)
  assert.strictEqual(after.tree.edges.length, 1)
  ok('node + edge persisted to disk')

  // 6. 父上下文自动推断（未显式传 parentContext 时取父节点内容/prompt/label）
  const child2 = await generateNode(svc, {
    projectId,
    parentNodeId: res.node.id,
    prompt: '方向 A-1',
  })
  assert.ok(
    child2.node.content.includes('基于父节点：'),
    'parentContext inferred from parent node',
  )
  ok('parentContext inferred from parent node')

  // 7. 显式 parentContext 优先于推断
  const child3 = await generateNode(svc, {
    projectId,
    parentNodeId: res.node.id,
    prompt: '方向 A-2',
    parentContext: '自定义上下文',
  })
  assert.ok(child3.node.content.includes('自定义上下文'))
  assert.ok(!child3.node.content.includes('基于父节点：方向 A：把核心体验做减法'))
  ok('explicit parentContext takes precedence')

  // 8. 根层新增（parentNodeId=null → 无 edge）
  const rootSibling = await generateNode(svc, {
    projectId,
    parentNodeId: null,
    prompt: '另一个根想法',
  })
  assert.strictEqual(rootSibling.node.parentId, null)
  assert.strictEqual(rootSibling.edge, null)
  ok('root-level node has no edge')

  // 9. label 截断（首行超 24 字符）
  const longPrompt = '这是一个非常非常非常长的想法标题需要被截断处理才不会撑爆节点宽度'
  const longNode = await generateNode(svc, { projectId, parentNodeId: rootId, prompt: longPrompt })
  assert.strictEqual(longNode.node.label.length, 25) // 24 + '…'
  assert.ok(longNode.node.label.endsWith('…'))
  ok('label truncated to 24 chars + ellipsis')

  // 10. 未知生成器报错
  let threw = false
  try {
    await generateNode(svc, { projectId, parentNodeId: rootId, prompt: 'x', generatorId: 'nope' })
  } catch (e) {
    threw = /generator not found/.test(e.message)
  }
  assert.ok(threw, 'unknown generator rejects')
  ok('unknown generatorId rejects')

  console.log(`\nALL GENERATE-NODE TESTS PASSED (${passed} checks)`)
})().catch((e) => {
  console.error('\nTEST FAILED:', e)
  process.exit(1)
})
