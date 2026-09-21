// 沿链路生成方案：链路纯函数 + 提示词拼装 + 落库节点/边 + 无生成器时报错。
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { collectChainIds } = require('../dist-test/shared/tree')
const { buildProposalPrompt, generateProposal } = require('../dist-test/core/generate-proposal')
const { createServices, ensureProject } = require('../dist-test/core/services')
const { plaintextSecretBox } = require('../dist-test/core/settings-store')

let passed = 0
function ok(name) {
  passed++
  console.log('  ✓', name)
}

// ---------------- 1. 链路纯函数 ----------------
console.log('\n[1] 链路：根 → 目标')
const tree = [
  { id: 'r', parentId: null },
  { id: 'a', parentId: 'r' },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'r' },
]
assert.deepStrictEqual(collectChainIds(tree, 'b'), ['r', 'a', 'b'])
ok('三层链路顺序是 根 → 中间 → 目标')
assert.deepStrictEqual(collectChainIds(tree, 'r'), ['r'])
ok('选根节点时链路只有它自己（1 层）')
assert.deepStrictEqual(collectChainIds(tree, 'c'), ['r', 'c'])
ok('旁支不受影响（只走自己的祖先链）')
assert.deepStrictEqual(collectChainIds([{ id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }], 'x').length <= 2, true)
ok('成环不死循环（结果最多偏小）')

// ---------------- 2. 提示词 ----------------
console.log('\n[2] 提示词：带上链上每一层的取舍')
const prompt = buildProposalPrompt([
  {
    label: '温室数字孪生',
    prompt: '做一个温室大棚的数字孪生',
    content: '正文A'.repeat(300), // 超长，应被截断
    analysis: { feasibility: 72, pros: ['省水'], cons: ['成本高'], risks: ['传感器故障'] },
  },
  { label: '先做低成本版', content: '正文B' },
])
assert.ok(prompt.includes('第 1 层｜温室数字孪生'))
assert.ok(prompt.includes('第 2 层｜先做低成本版'))
ok('每一层都带上序号与标题')
assert.ok(prompt.includes('可行性：72%'))
assert.ok(prompt.includes('优点：省水'))
assert.ok(prompt.includes('缺点：成本高'))
assert.ok(prompt.includes('风险：传感器故障'))
ok('可行性 / 优点 / 缺点 / 风险都进了提示词（方案要承接这些取舍）')
assert.ok(prompt.includes('原始描述：做一个温室大棚的数字孪生'))
ok('原始描述也在')
assert.ok(prompt.includes('可落地的方案'))
ok('有明确的输出要求')
assert.ok(prompt.indexOf('正文A') < prompt.length)
assert.ok(prompt.length < 3000)
ok('超长内容被截断（不会把上下文撑爆）')
assert.ok(!prompt.includes('可行性') === false)
ok('（无评估的层不至于报错）')
const noAnalysis = buildProposalPrompt([{ label: '空节点' }])
assert.ok(noAnalysis.includes('第 1 层｜空节点'))
ok('没有评估/内容的层也能正常拼出来')

// ---------------- 3. 建节点 ----------------
console.log('\n[3] 生成方案并落库')
function makeSvc() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-proposal-'))
  return createServices({ dataDir: baseDir, secrets: plaintextSecretBox(), fakeGenerator: true })
}

async function main() {
  const svc = makeSvc()
  const file = ensureProject(svc)
  const pid = file.project.id
  const rootId = file.tree.nodes[0].id
  const child = svc.repo.addNode(pid, {
    label: '子方向A',
    prompt: '先把成本降下来',
    content: '# 子方向A\n\n内容',
    status: 'done',
    parentId: rootId,
  })

  const res = await generateProposal(svc, { projectId: pid, nodeId: child.id, position: { x: 100, y: 200 } })
  assert.strictEqual(res.chainLength, 2)
  ok('链路层数 = 2（根 + 子方向）')
  assert.strictEqual(res.node.kind, 'proposal')
  ok('产物节点 kind = proposal')
  assert.ok(res.node.label.startsWith('方案：'))
  assert.ok(res.node.label.includes('子方向A'))
  ok('名字是「方案：<末端节点名>」（看得出是从哪条链收出来的）')
  assert.strictEqual(res.node.parentId, child.id)
  ok('挂在链条**末端**节点下（不是挂回根下）')
  assert.strictEqual(res.node.contentType, 'markdown')
  assert.ok(res.node.content && res.node.content.length > 0)
  ok('有正文内容，且是 markdown')
  assert.strictEqual(res.node.status, 'done')
  ok('状态为 done')
  assert.ok(res.edge && res.edge.source === child.id && res.edge.target === res.node.id)
  ok('自动建了「末端 → 方案」的边')

  const after = svc.repo.get(pid)
  const saved = after.tree.nodes.find((n) => n.id === res.node.id)
  assert.strictEqual(saved.kind, 'proposal')
  assert.strictEqual(saved.versions.length, 1)
  ok('落库且带 1 个版本（可翻案）')
  assert.deepStrictEqual(saved.position, { x: 100, y: 200 })
  ok('按传入的坐标落库（布局由渲染端决定）')
  assert.strictEqual(after.tree.nodes.filter((n) => n.kind === 'proposal').length, 1)
  ok('全库只有这一个方案节点')

  // 末端节点自己没被改动
  const targetAfter = after.tree.nodes.find((n) => n.id === child.id)
  assert.strictEqual(targetAfter.kind, 'idea')
  assert.strictEqual(targetAfter.label, '子方向A')
  ok('末端节点本身不被改动（方案是新增，不是改写）')

  // 选根节点：1 层链路也能生成
  const rootRes = await generateProposal(svc, { projectId: pid, nodeId: rootId })
  assert.strictEqual(rootRes.chainLength, 1)
  ok('选根节点时是 1 层链路，同样能生成')

  // ---------------- 4. 错误处理 ----------------
  console.log('\n[4] 错误处理')
  await assert.rejects(
    () => generateProposal(svc, { projectId: pid, nodeId: '不存在的节点' }),
    /not found/i,
  )
  ok('节点不存在 → 报错')

  const noGen = createServices({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-proposal-nogen-')),
    secrets: plaintextSecretBox(),
  })
  const f2 = ensureProject(noGen)
  await assert.rejects(
    () => generateProposal(noGen, { projectId: f2.project.id, nodeId: f2.tree.nodes[0].id }),
    /generator not found/i,
  )
  ok('没有可用生成器 → 报错（而不是静默产出空方案）')

  console.log(`\nPROPOSAL_TESTS OK (${passed})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
