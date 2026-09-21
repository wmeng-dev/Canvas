// 节点收展（折叠子树）测试：纯函数 + 仓储持久化（不依赖 Electron）。
// 覆盖：后代收集 / 成环保护 / 隐藏集（含嵌套收起）/ 新节点默认值 /
//       落库与重读 / 收展状态在各节点间互相独立 / 老项目文件向后兼容。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/collapse.test.cjs`
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { JsonStore } = require('../dist-test/core/storage/store')
const { ProjectRepository } = require('../dist-test/core/storage/repositories')
const { collectDescendantIds, collectHiddenIds } = require('../dist-test/shared/tree')

let passed = 0
function ok(name) {
  passed++
  console.log('  ✓', name)
}

/** 顺序无关比较：栈式 DFS 的产出顺序是实现细节，断言只关心集合内容。 */
function sorted(ids) {
  return [...ids].sort()
}

// ---------------- 1. 纯函数：后代收集 ----------------

// a → (b, c)；b → d；d → e（多层）
const tree = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'a' },
  { id: 'd', parentId: 'b' },
  { id: 'e', parentId: 'd' },
]

assert.deepStrictEqual(
  sorted(collectDescendantIds(tree, 'a')),
  ['b', 'c', 'd', 'e'],
  'a 的后代含所有层级',
)
ok('descendants of root: all levels')

assert.deepStrictEqual(sorted(collectDescendantIds(tree, 'b')), ['d', 'e'])
ok('descendants of b: d and e')

assert.deepStrictEqual(collectDescendantIds(tree, 'e'), [], '叶子没有后代')
ok('leaf has no descendants')

// 成环（手动连线理论上能把 parentId 连成环）必须能终止，不能死循环
const cyclic = [
  { id: 'x', parentId: 'y' },
  { id: 'y', parentId: 'x' },
]
assert.deepStrictEqual(sorted(collectDescendantIds(cyclic, 'x')), ['y'], '成环时也能收敛')
ok('cycle guard: traversal terminates')

// ---------------- 2. 纯函数：隐藏集 ----------------

// 收起 a：隐藏全部后代，但 a 自身仍可见（否则没法点着展开）
const collapsedA = tree.map((n) => (n.id === 'a' ? { ...n, collapsed: true } : n))
const hiddenA = collectHiddenIds(collapsedA)
assert.deepStrictEqual(sorted(hiddenA), ['b', 'c', 'd', 'e'])
assert.ok(!hiddenA.has('a'), '被收起的节点自身不隐藏')
ok('collapse a: hides all descendants, keeps a visible')

assert.strictEqual(collectHiddenIds(tree).size, 0, '没有收起节点时无隐藏')
ok('nothing collapsed → nothing hidden')

// 嵌套收起：a、b 都收起 → 取并集（b 的后代本就被 a 隐藏）
const collapsedAB = tree.map((n) =>
  n.id === 'a' || n.id === 'b' ? { ...n, collapsed: true } : n,
)
assert.deepStrictEqual(sorted(collectHiddenIds(collapsedAB)), ['b', 'c', 'd', 'e'])
ok('nested collapse: union of hidden sets')

// 关键语义：展开 a 之后，b 自己仍是收起的 → b 的后代继续隐藏
const onlyB = tree.map((n) => (n.id === 'b' ? { ...n, collapsed: true } : n))
assert.deepStrictEqual(
  sorted(collectHiddenIds(onlyB)),
  ['d', 'e'],
  '收展状态逐节点独立：展开祖先不会连带展开后代',
)
ok('expanding a keeps b collapsed → d/e stay hidden')

// ---------------- 3. 仓储：默认值 / 落库 / 独立性 ----------------

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'diverge-collapse-'))
const store = new JsonStore({ baseDir: base })
const repo = new ProjectRepository(store)

const file0 = repo.create('收展测试项目')
const pid = file0.project.id

const root = repo.addNode(pid, { label: '根主题', prompt: '围绕 X 发散' })
const child = repo.addNode(pid, { label: '子方向A', parentId: root.id })
const grand = repo.addNode(pid, { label: '孙方向A1', parentId: child.id })

assert.strictEqual(repo.get(pid).tree.nodes.find((n) => n.id === root.id).collapsed, false)
ok('new node defaults to expanded (collapsed=false)')

// 收起根 → 落库后重读仍为收起
const updated = repo.setNodeCollapsed(pid, root.id, true)
assert.strictEqual(updated.collapsed, true)
assert.strictEqual(repo.get(pid).tree.nodes.find((n) => n.id === root.id).collapsed, true)
ok('setNodeCollapsed(true) persists across re-read')

// 展开回来
repo.setNodeCollapsed(pid, root.id, false)
assert.strictEqual(repo.get(pid).tree.nodes.find((n) => n.id === root.id).collapsed, false)
ok('setNodeCollapsed(false) persists across re-read')

// 独立性：root 收起时把 child 也收起；再展开 root，child 仍应是收起状态
repo.setNodeCollapsed(pid, root.id, true)
repo.setNodeCollapsed(pid, child.id, true)
repo.setNodeCollapsed(pid, root.id, false)
const after = repo.get(pid).tree.nodes
assert.strictEqual(after.find((n) => n.id === root.id).collapsed, false, 'root 已展开')
assert.strictEqual(after.find((n) => n.id === child.id).collapsed, true, 'child 仍保持收起')
ok('collapse state is per-node: expanding root leaves child collapsed')

// 未知节点 id → 明确报错（而不是静默写成 undefined）
assert.throws(() => repo.setNodeCollapsed(pid, 'no-such-node', true), /Node not found/)
ok('setNodeCollapsed on unknown id throws')

// ---------------- 4. 向后兼容：老项目文件没有 collapsed 字段 ----------------

const raw = JSON.parse(JSON.stringify(repo.get(pid)))
for (const n of raw.tree.nodes) delete n.collapsed
store.write(pid, raw)
const migrated = repo.get(pid).tree.nodes
assert.ok(
  migrated.length >= 3,
  'migrated file still has nodes',
)
assert.ok(
  migrated.every((n) => n.collapsed === false),
  'old file: collapsed backfilled to false',
)
ok('legacy project file: collapsed backfilled to false')

// 老文件收展仍然可用（补齐后就能正常落库/回读）
repo.setNodeCollapsed(pid, grand.id, true)
assert.strictEqual(repo.get(pid).tree.nodes.find((n) => n.id === grand.id).collapsed, true)
ok('legacy file: collapse works after migration')

console.log(`\n  collapse: ${passed} checks passed`)
