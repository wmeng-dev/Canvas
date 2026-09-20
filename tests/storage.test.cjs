// B.2/B.3 验证：JSON 存储层 Node 运行时测试（不依赖 Electron）。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/storage.test.cjs`
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { JsonStore } = require('../dist-test/core/storage/store')
const { ProjectRepository } = require('../dist-test/core/storage/repositories')

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'diverge-test-'))
const store = new JsonStore({ baseDir: base })
const repo = new ProjectRepository(store)

// 1. 创建项目
const p = repo.create('我的创意发散')
assert.ok(p.project.id, 'project id generated')
assert.strictEqual(p.project.name, '我的创意发散')
assert.strictEqual(p.tree.nodes.length, 0)
assert.strictEqual(p.tree.edges.length, 0)
ok('create project + empty tree')

// 2. 持久化后立即可读（新 store 实例）
const store2 = new JsonStore({ baseDir: base })
const repo2 = new ProjectRepository(store2)
const back = repo2.get(p.project.id)
assert.strictEqual(back.project.name, '我的创意发散')
ok('persisted file readable by fresh store (atomic write)')

// 3. 根节点（parentId=null，不应产生边）
const root = repo.addNode(p.project.id, { label: '根主题', prompt: '围绕 X 发散' })
assert.strictEqual(root.parentId, null)
assert.strictEqual(repo.get(p.project.id).tree.edges.length, 0)
ok('add root node (no edge when parentId null)')

// 4. 子节点（自动建边 + parentId 指向父）
const child = repo.addNode(p.project.id, { label: '子方向A', parentId: root.id })
const pf = repo.get(p.project.id)
assert.strictEqual(pf.tree.nodes.length, 2)
assert.strictEqual(pf.tree.edges.length, 1)
assert.strictEqual(pf.tree.edges[0].source, root.id)
assert.strictEqual(pf.tree.edges[0].target, child.id)
assert.strictEqual(child.parentId, root.id)
ok('add child node creates node + edge + parent link')

// 5. 更新节点内容/状态
repo.updateNode(p.project.id, child.id, { content: '生成的内容', status: 'done' })
const updated = repo.get(p.project.id).tree.nodes.find((n) => n.id === child.id)
assert.strictEqual(updated.content, '生成的内容')
assert.strictEqual(updated.status, 'done')
ok('update node content/status')

// 5b. 向后兼容：内容已存在但没有版本字段时，读取会补一个「稳定 id」的 v1
const migrated = repo.get(p.project.id).tree.nodes.find((n) => n.id === child.id)
assert.strictEqual(migrated.versions.length, 1, 'migration synthesizes v1 for pre-existing content')
assert.strictEqual(migrated.versions[0].id, `${child.id}-v1`, 'synthesized id is stable/derivable')
assert.strictEqual(migrated.versions[0].content, '生成的内容')
assert.strictEqual(migrated.currentVersionId, `${child.id}-v1`)

// 追加新版本：旧版本保留
const withV2 = repo.addVersion(p.project.id, child.id, {
  content: '第二版内容', contentType: 'html', generatorId: 'fake', model: 'm',
})
assert.strictEqual(withV2.versions.length, 2)
assert.strictEqual(withV2.currentVersionId, withV2.versions[1].id)
assert.strictEqual(withV2.content, '第二版内容')
assert.strictEqual(withV2.contentType, 'html')
assert.strictEqual(withV2.versions[0].content, '生成的内容', 'v1 preserved')
ok('addVersion appends new version and keeps history')

// 5c. 翻案：指回旧版本（版本一个不删），且落盘
const reverted = repo.setCurrentVersion(p.project.id, child.id, migrated.versions[0].id)
assert.strictEqual(reverted.currentVersionId, `${child.id}-v1`)
assert.strictEqual(reverted.content, '生成的内容')
assert.strictEqual(reverted.versions.length, 2, 'nothing deleted')
assert.strictEqual(
  repo.get(p.project.id).tree.nodes.find((n) => n.id === child.id).content,
  '生成的内容',
  'revert persisted',
)
assert.throws(() => repo.setCurrentVersion(p.project.id, child.id, 'nope'), /Version not found/)
ok('setCurrentVersion reverts + persists + rejects unknown version')

// 6. 重复边拒绝
assert.throws(() => repo.addEdge(p.project.id, root.id, child.id), /already exists/)
ok('duplicate edge rejected')

// 7. 自环边拒绝
assert.throws(() => repo.addEdge(p.project.id, root.id, root.id), /self-loop/)
ok('self-loop edge rejected')

// 8. 手动加边（跨节点）
const child2 = repo.addNode(p.project.id, { label: '子方向B', parentId: root.id })
const e = repo.addEdge(p.project.id, child.id, child2.id)
assert.ok(e.id)
assert.strictEqual(repo.get(p.project.id).tree.edges.length, 3)
ok('add explicit edge between nodes')

// 9. 删除边
repo.removeEdge(p.project.id, e.id)
assert.strictEqual(repo.get(p.project.id).tree.edges.length, 2)
ok('remove edge')

// 10. 删除节点级联清理边
repo.removeNode(p.project.id, root.id)
const after = repo.get(p.project.id)
assert.strictEqual(after.tree.nodes.length, 2)
// root 相关的边（2 条以 root 为 source 的）应被清除
assert.ok(after.tree.edges.every((ed) => ed.source !== root.id && ed.target !== root.id))
ok('remove node cascades edge cleanup')

// 11. list / rename / remove
const list = repo.list()
assert.strictEqual(list.length, 1)
repo.rename(p.project.id, '  重命名创意  ')
assert.strictEqual(repo.get(p.project.id).project.name, '重命名创意')
repo.remove(p.project.id)
assert.strictEqual(store.exists(p.project.id), false)
ok('list + rename trim + remove project')

console.log(`\nALL STORAGE TESTS PASSED (${passed} checks)`)
