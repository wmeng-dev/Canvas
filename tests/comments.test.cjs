// 评论（气泡）仓储层 Node 运行时测试（不依赖 Electron）。
// 覆盖：节点级评论 / 画布自由气泡 / 回复线程 / 根评论编辑 / 拖拽坐标回写 /
//       删除（thread + 单条回复）/ 向后兼容（老项目文件无 comments 字段）。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/comments.test.cjs`
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { JsonStore } = require('../dist-test/core/storage/store')
const { ProjectRepository } = require('../dist-test/core/storage/repositories')

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'diverge-comments-'))
const store = new JsonStore({ baseDir: base })
const repo = new ProjectRepository(store)

const p = repo.create('评论测试项目')
const pid = p.project.id

// 1. 向后兼容：手工写入一份"没有 comments 字段"的老项目文件，读回应补齐 []
const legacyFile = JSON.parse(JSON.stringify(repo.get(pid)))
delete legacyFile.tree.nodes
legacyFile.tree.nodes = []
store.write(pid, legacyFile)
let file = repo.get(pid)
assert.deepStrictEqual(file.tree.nodes, [])
assert.deepStrictEqual(file.comments, [], 'file.comments migrated to []')
ok('legacy project file: comments field backfilled')

// 2. 建两个节点：root / child
const root = repo.addNode(pid, { label: '根主题', prompt: '围绕 X 发散' })
const child = repo.addNode(pid, { label: '子方向A', parentId: root.id })

// 3. 节点级评论：新建 thread
const t1 = repo.addNodeComment(pid, child.id, '这个方向成本太高')
assert.ok(t1.id, 'thread id generated')
assert.strictEqual(t1.nodeId, child.id)
assert.strictEqual(t1.body, '这个方向成本太高')
assert.strictEqual(t1.replies.length, 0)
assert.strictEqual(t1.position, undefined, 'node comment has no position')
file = repo.get(pid)
const childNode = file.tree.nodes.find((n) => n.id === child.id)
assert.strictEqual(childNode.comments.length, 1)
assert.strictEqual(childNode.comments[0].body, '这个方向成本太高')
ok('addNodeComment creates thread on node + persisted')

// 4. 回复线程
const t1b = repo.addReply(pid, t1.id, '但收益也最大')
assert.strictEqual(t1b.replies.length, 1)
assert.strictEqual(t1b.replies[0].body, '但收益也最大')
assert.ok(t1b.replies[0].id)
file = repo.get(pid)
assert.strictEqual(
  file.tree.nodes.find((n) => n.id === child.id).comments[0].replies.length, 1,
  'reply persisted on disk',
)
ok('addReply appends to node-level thread')

// 5. 根评论内容编辑（定位到节点级 thread）
const t1c = repo.updateCommentBody(pid, t1.id, '这个方向成本太高（改）')
assert.strictEqual(t1c.body, '这个方向成本太高（改）')
assert.strictEqual(t1c.replies.length, 1, 'replies untouched by body edit')
ok('updateCommentBody edits root comment of node-level thread')

// 6. 画布自由气泡：带流坐标、无 nodeId
const t2 = repo.addCanvasComment(pid, 123.5, -77, '')
assert.strictEqual(t2.nodeId, undefined)
assert.deepStrictEqual(t2.position, { x: 123.5, y: -77 })
file = repo.get(pid)
assert.strictEqual(file.comments.length, 1)
ok('addCanvasComment places free bubble on canvas')

// 7. 自由气泡：填根评论 + 回复
const t2b = repo.updateCommentBody(pid, t2.id, '整棵树的布局再疏一点')
assert.strictEqual(t2b.body, '整棵树的布局再疏一点')
const t2c = repo.addReply(pid, t2.id, '同意，间距改 400')
assert.strictEqual(t2c.replies.length, 1)
ok('canvas bubble: body edit + reply')

// 8. 拖拽后回写坐标（updateCommentPosition 定位的是画布上的 thread）
repo.updateCommentPosition(pid, t2.id, 300, 40)
file = repo.get(pid)
assert.deepStrictEqual(file.comments[0].position, { x: 300, y: 40 })
ok('updateCommentPosition persists dragged position')

// 9. 删除单条回复（节点级 thread）
const replyId = t1c.replies[0].id
repo.removeReply(pid, t1.id, replyId)
file = repo.get(pid)
assert.strictEqual(
  file.tree.nodes.find((n) => n.id === child.id).comments[0].replies.length, 0,
  'reply removed',
)
ok('removeReply deletes a single reply')

// 10. 删除整条 thread（节点级 / 画布各一条）
repo.removeComment(pid, t1.id)
file = repo.get(pid)
assert.strictEqual(file.tree.nodes.find((n) => n.id === child.id).comments.length, 0)
repo.removeComment(pid, t2.id)
assert.deepStrictEqual(repo.get(pid).comments, [])
ok('removeComment deletes node-level and canvas threads')

// 11. 删除不存在的 thread 静默返回（不抛、不写盘）
assert.doesNotThrow(() => repo.removeComment(pid, 'no-such-thread'))
ok('removeComment on unknown thread is a no-op')

// 12. 未知节点拒绝加评论
assert.throws(() => repo.addNodeComment(pid, 'no-such-node', 'x'), /Node not found/)
ok('addNodeComment on unknown node rejected')

// 13. 空白 body 归一化为空串（画布气泡"先放后写"的工作流依赖这一点）
const t3 = repo.addNodeComment(pid, root.id, '   ')
assert.strictEqual(t3.body, '')
const t4 = repo.addCanvasComment(pid, 0, 0, '   ')
assert.strictEqual(t4.body, '')
ok('blank body normalized to empty string')

console.log(`\nALL COMMENT TESTS PASSED (${passed} checks)`)
