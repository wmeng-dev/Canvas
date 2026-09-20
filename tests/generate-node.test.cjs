// C.3/C.5 验证：主进程"发散子节点 / 重新生成（版本）/ 翻案"核心逻辑（不依赖 Electron / 网络）。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/generate-node.test.cjs`
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { createServices, ensureProject } = require('../dist-test/core/services')
const { generateNode, regenerateNode, MAX_GENERATE_COUNT } = require('../dist-test/core/generate-node')
const { mapWithConcurrency } = require('../dist-test/core/concurrency')

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'diverge-gen-'))

// 必然失败的生成器（用于验证"批量发散时个别失败不拖垮整批"）
const flaky = {
  id: 'flaky',
  label: '偶尔失败的生成器',
  kind: 'direct',
  async generate(spec) {
    if (spec.prompt.includes('方向 2')) throw new Error('后端 429：限流')
    return { contentType: spec.contentType ?? 'markdown', text: `# ${spec.prompt}`, model: 'flaky', finishedAt: new Date().toISOString() }
  },
}

// 1. 服务装配：注册 fake 生成器并成为默认
const svc = createServices({ dataDir: base, fakeGenerator: true })
svc.registry.register(flaky)
assert.strictEqual(svc.registry.list().length, 2)
assert.strictEqual(svc.defaultGeneratorId, 'fake')
ok('createServices registers fake generator as default')

// 2. ensureProject：首次进入自动建项目 + 根节点
const file = ensureProject(svc)
const projectId = file.project.id
assert.ok(projectId, 'project created')
assert.strictEqual(file.tree.nodes.length, 1)
assert.strictEqual(file.tree.nodes[0].label, '创意主题')
const rootId = file.tree.nodes[0].id
// 空内容的根节点不应有版本
assert.strictEqual(file.tree.nodes[0].versions.length, 0)
assert.strictEqual(file.tree.nodes[0].currentVersionId, null)
ok('ensureProject bootstraps project + root node (no version for empty content)')

// 3. 幂等
assert.strictEqual(ensureProject(svc).project.id, projectId)
ok('ensureProject is idempotent')

;(async () => {
  // 4. 单条发散：走 GeneratorRegistry → fake → 落库，并自动生成 v1
  const res = await generateNode(svc, {
    projectId,
    parentNodeId: rootId,
    prompt: '方向 A：把核心体验做减法',
    position: { x: 280, y: 0 },
  })
  assert.strictEqual(res.items.length, 1)
  assert.deepStrictEqual(res.failures, [])
  const n1 = res.items[0].node
  assert.strictEqual(n1.label, '方向 A：把核心体验做减法')
  assert.strictEqual(n1.status, 'done')
  assert.strictEqual(n1.generatorId, 'fake')
  assert.strictEqual(n1.parentId, rootId)
  assert.deepStrictEqual(n1.position, { x: 280, y: 0 })
  assert.strictEqual(n1.contentType, 'markdown')
  assert.ok(n1.content.includes('方向 A：把核心体验做减法'))
  assert.strictEqual(res.items[0].edge.source, rootId)
  assert.strictEqual(res.items[0].edge.target, n1.id)
  // 首次生成即建立 v1
  assert.strictEqual(n1.versions.length, 1)
  assert.strictEqual(n1.currentVersionId, n1.versions[0].id)
  assert.strictEqual(n1.versions[0].content, n1.content)
  ok('single diverge creates node + edge + initial version')

  // 5. 落盘校验
  const after = svc.repo.get(projectId)
  assert.strictEqual(after.tree.nodes.length, 2)
  assert.strictEqual(after.tree.edges.length, 1)
  ok('node + edge persisted to disk')

  // 6. 父上下文自动推断 / 显式优先
  const child2 = await generateNode(svc, { projectId, parentNodeId: n1.id, prompt: '方向 A-1' })
  assert.ok(child2.items[0].node.content.includes('基于父节点：'))
  const child3 = await generateNode(svc, {
    projectId, parentNodeId: n1.id, prompt: '方向 A-2', parentContext: '自定义上下文',
  })
  assert.ok(child3.items[0].node.content.includes('自定义上下文'))
  ok('parentContext inferred, explicit wins')

  // 7. 根层新增（parentNodeId=null → 无 edge）
  const rootSibling = await generateNode(svc, { projectId, parentNodeId: null, prompt: '另一个根想法' })
  assert.strictEqual(rootSibling.items[0].node.parentId, null)
  assert.strictEqual(rootSibling.items[0].edge, null)
  ok('root-level node has no edge')

  // 8. label 截断
  const longPrompt = '这是一个非常非常非常长的想法标题需要被截断处理才不会撑爆节点宽度'
  const longNode = await generateNode(svc, { projectId, parentNodeId: rootId, prompt: longPrompt })
  assert.strictEqual(longNode.items[0].node.label.length, 25)
  assert.ok(longNode.items[0].node.label.endsWith('…'))
  ok('label truncated to 24 chars + ellipsis')

  // 9. contentType 透传
  const htmlRes = await generateNode(svc, {
    projectId, parentNodeId: rootId, prompt: 'HTML 卡片', contentType: 'html',
  })
  assert.strictEqual(htmlRes.items[0].node.contentType, 'html')
  assert.ok(htmlRes.items[0].node.content.includes('<h1>'))
  const svgRes = await generateNode(svc, {
    projectId, parentNodeId: rootId, prompt: 'SVG 图', contentType: 'svg',
  })
  assert.strictEqual(svgRes.items[0].node.contentType, 'svg')
  assert.ok(svgRes.items[0].node.content.includes('<svg'))
  ok('contentType flows through (html + svg)')

  // 10. 批量发散：count=3 生成 3 个子节点，坐标按序号下移，边各自建立
  const beforeEdgeCount = svc.repo.get(projectId).tree.edges.length
  const batch = await generateNode(svc, {
    projectId, parentNodeId: rootId, prompt: '批量方向', count: 3, position: { x: 500, y: 100 },
  })
  assert.strictEqual(batch.items.length, 3)
  assert.deepStrictEqual(batch.items.map((i) => i.node.position), [
    { x: 500, y: 100 }, { x: 500, y: 250 }, { x: 500, y: 400 },
  ])
  assert.deepStrictEqual(batch.items.map((i) => i.node.parentId), [rootId, rootId, rootId])
  assert.ok(batch.items.every((i, k) => i.edge && i.edge.source === rootId && i.edge.target === i.node.id))
  assert.strictEqual(svc.repo.get(projectId).tree.edges.length, beforeEdgeCount + 3)
  assert.ok(batch.items.every((i) => i.node.versions.length === 1), 'each node starts with v1')
  ok('batch diverge (count=3) creates 3 children + 3 edges with staggered positions')

  // 11. count 上限收敛
  const clamped = await generateNode(svc, { projectId, parentNodeId: null, prompt: '上限测试', count: 99 })
  assert.strictEqual(clamped.items.length, MAX_GENERATE_COUNT)
  ok(`count is clamped to MAX_GENERATE_COUNT (${MAX_GENERATE_COUNT})`)

  // 12. 个别失败不拖垮整批
  const partial = await generateNode(svc, {
    projectId, parentNodeId: rootId, prompt: '部分失败', count: 3, generatorId: 'flaky',
  })
  assert.strictEqual(partial.items.length, 2, 'two succeeded')
  assert.strictEqual(partial.failures.length, 1, 'one reported as failure')
  assert.ok(partial.failures[0].prompt.includes('方向 2'))
  assert.ok(/429/.test(partial.failures[0].error))
  ok('partial failure: winners persist, loser reported (no whole-batch failure)')

  // 13. 全部失败 → 抛错
  let allFailed = false
  try {
    await generateNode(svc, { projectId, parentNodeId: null, prompt: '都失败', count: 1, generatorId: 'nope' })
  } catch (e) {
    allFailed = /generator not found/.test(e.message)
  }
  assert.ok(allFailed)
  ok('all-failed batch rejects')

  // 14. 重新生成 → 追加新版本（旧版本保留）
  const target = res.items[0].node
  const v1Content = target.content
  const regenerated = await regenerateNode(svc, { projectId, nodeId: target.id })
  assert.strictEqual(regenerated.versions.length, 2)
  assert.strictEqual(regenerated.currentVersionId, regenerated.versions[1].id)
  assert.strictEqual(regenerated.content, regenerated.versions[1].content)
  assert.strictEqual(regenerated.label, target.label, 'label unchanged on regenerate')
  // 占位生成器每次产出都带序号 → 两个版本内容可区分（真实模型同样不会两次完全一致）
  assert.notStrictEqual(regenerated.content, v1Content)
  assert.strictEqual(regenerated.versions[0].content, v1Content, 'v1 preserved verbatim')
  ok('regenerate appends v2 with distinct content, keeps v1')

  // 14b. 换 prompt 重新生成 → 内容确实变化
  const newPrompt = await regenerateNode(svc, { projectId, nodeId: target.id, prompt: '完全不同的方向' })
  assert.notStrictEqual(newPrompt.content, v1Content)
  assert.ok(newPrompt.content.includes('完全不同的方向'))
  assert.strictEqual(newPrompt.versions.length, 3)
  ok('regenerate with a new prompt produces different content (v3)')

  // 15. 重新生成可换类型
  const asSvg = await regenerateNode(svc, { projectId, nodeId: target.id, contentType: 'svg' })
  assert.strictEqual(asSvg.contentType, 'svg')
  assert.strictEqual(asSvg.versions.length, 4)
  ok('regenerate can switch contentType (v4)')

  // 16. 翻案：把当前版本指回 v1，内容回退但版本一个不少
  const reverted = svc.repo.setCurrentVersion(projectId, target.id, target.versions[0].id)
  assert.strictEqual(reverted.currentVersionId, target.versions[0].id)
  assert.strictEqual(reverted.content, v1Content)
  assert.strictEqual(reverted.contentType, 'markdown', 'type reverts with content')
  assert.strictEqual(reverted.versions.length, 4, 'no version is deleted')
  ok('revert (翻案) restores v1 content while keeping all versions')

  // 17. 翻案到不存在的版本 → 抛错
  let badRevert = false
  try {
    svc.repo.setCurrentVersion(projectId, target.id, 'nope')
  } catch (e) {
    badRevert = /Version not found/.test(e.message)
  }
  assert.ok(badRevert)
  ok('revert to unknown version rejects')

  // 18. 并发限制：同时最多跑 limit 个
  let inFlight = 0
  let peak = 0
  const order = []
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 6))
    order.push(n)
    inFlight--
    return n * 2
  })
  assert.ok(peak <= 3, `peak concurrency ${peak} <= 3`)
  assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12, 14, 16], 'results keep input order')
  assert.strictEqual(out.length, 8)
  ok(`mapWithConcurrency caps concurrency (peak=${peak}) and preserves order`)

  // 19. 未知生成器报错
  let threw = false
  try {
    await generateNode(svc, { projectId, parentNodeId: rootId, prompt: 'x', generatorId: 'nope' })
  } catch (e) {
    threw = /generator not found/.test(e.message)
  }
  assert.ok(threw)
  ok('unknown generatorId rejects')

  console.log(`\nALL GENERATE-NODE TESTS PASSED (${passed} checks)`)
})().catch((e) => {
  console.error('\nTEST FAILED:', e)
  process.exit(1)
})
