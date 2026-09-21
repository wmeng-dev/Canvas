// 评论（气泡）仓储层 Node 运行时测试（不依赖 Electron）。
// 覆盖：节点级评论 / 画布自由气泡 / 多条评论彼此独立 / 正文编辑 / 拖拽坐标回写 /
//       删除单条 / 向后兼容（老项目文件无 comments 字段；老 comments 带 replies[] 的迁移）。
// ⚠️ 单人使用、非协作场景：**没有回复机制** —— 一条评论就是一条，补充内容靠再写一条。
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

// 3. 节点级评论：新建一条
const t1 = repo.addNodeComment(pid, child.id, '这个方向成本太高')
assert.ok(t1.id, 'thread id generated')
assert.strictEqual(t1.nodeId, child.id)
assert.strictEqual(t1.body, '这个方向成本太高')
assert.strictEqual('replies' in t1, false, 'no reply mechanism: comment has no replies field')
assert.strictEqual(t1.position, undefined, 'node comment has no position')
file = repo.get(pid)
const childNode = file.tree.nodes.find((n) => n.id === child.id)
assert.strictEqual(childNode.comments.length, 1)
assert.strictEqual(childNode.comments[0].body, '这个方向成本太高')
ok('addNodeComment creates comment on node + persisted')

// 4. 补充内容 = 再写一条独立评论（不是回复）：两条互不影响
const t1b = repo.addNodeComment(pid, child.id, '但收益也最大')
assert.notStrictEqual(t1b.id, t1.id, 'a follow-up is a separate comment, not a reply')
file = repo.get(pid)
const stored = file.tree.nodes.find((n) => n.id === child.id).comments
assert.strictEqual(stored.length, 2)
assert.deepStrictEqual(stored.map((c) => c.body), ['这个方向成本太高', '但收益也最大'])
ok('follow-up comment is a sibling, not nested under the first')

// 5. 正文编辑只影响被改的那条
const t1c = repo.updateCommentBody(pid, t1.id, '这个方向成本太高（改）')
assert.strictEqual(t1c.body, '这个方向成本太高（改）')
file = repo.get(pid)
assert.strictEqual(
  file.tree.nodes.find((n) => n.id === child.id).comments[1].body, '但收益也最大',
  'editing one comment leaves the other untouched',
)
ok('updateCommentBody edits only the targeted comment')

// 6. 画布自由气泡：带流坐标、无 nodeId
const t2 = repo.addCanvasComment(pid, 123.5, -77, '')
assert.strictEqual(t2.nodeId, undefined)
assert.deepStrictEqual(t2.position, { x: 123.5, y: -77 })
assert.strictEqual('replies' in t2, false, 'canvas bubble has no replies either')
file = repo.get(pid)
assert.strictEqual(file.comments.length, 1)
ok('addCanvasComment places free bubble on canvas')

// 7. 自由气泡：填正文
const t2b = repo.updateCommentBody(pid, t2.id, '整棵树的布局再疏一点')
assert.strictEqual(t2b.body, '整棵树的布局再疏一点')
file = repo.get(pid)
assert.strictEqual(file.comments[0].body, '整棵树的布局再疏一点')
ok('canvas bubble: body edit persisted')

// 8. 拖拽后回写坐标（updateCommentPosition 定位的是画布上的评论）
repo.updateCommentPosition(pid, t2.id, 300, 40)
file = repo.get(pid)
assert.deepStrictEqual(file.comments[0].position, { x: 300, y: 40 })
ok('updateCommentPosition persists dragged position')

// 9. 删除单条评论（节点级），另一条保留
repo.removeComment(pid, t1.id)
file = repo.get(pid)
const left = file.tree.nodes.find((n) => n.id === child.id).comments
assert.strictEqual(left.length, 1)
assert.strictEqual(left[0].body, '但收益也最大', 'only the deleted comment is gone')
ok('removeComment deletes exactly one comment')

// 10. 删除画布气泡
repo.removeComment(pid, t2.id)
assert.deepStrictEqual(repo.get(pid).comments, [])
ok('removeComment deletes canvas bubble')

// 11. 删除不存在的评论静默返回（不抛、不写盘）
assert.doesNotThrow(() => repo.removeComment(pid, 'no-such-thread'))
ok('removeComment on unknown comment is a no-op')

// 12. 未知节点拒绝加评论
assert.throws(() => repo.addNodeComment(pid, 'no-such-node', 'x'), /Node not found/)
ok('addNodeComment on unknown node rejected')

// 13. 未知评论拒绝改正文（UI 不该静默"改了个寂寞"）
assert.throws(() => repo.updateCommentBody(pid, 'no-such-thread', 'x'), /Comment thread not found/)
ok('updateCommentBody on unknown comment rejected')

// 14. 空白 body 归一化为空串（画布气泡"先放后写"的工作流依赖这一点）
const t3 = repo.addNodeComment(pid, root.id, '   ')
assert.strictEqual(t3.body, '')
const t4 = repo.addCanvasComment(pid, 0, 0, '   ')
assert.strictEqual(t4.body, '')
ok('blank body normalized to empty string')

// 15. 向后兼容：老项目文件里带 replies[] 的评论 → 读回时旧回复**并入正文**、字段删除
//     （回复机制下线了，但用户写过的字不能凭空消失）
const withReplies = JSON.parse(JSON.stringify(repo.get(pid)))
withReplies.comments = [
  {
    id: 'legacy-1',
    position: { x: 1, y: 2 },
    body: '原始想法',
    createdAt: '2026-01-01T00:00:00.000Z',
    replies: [
      { id: 'r1', body: '回复一', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'r2', body: '回复二', createdAt: '2026-01-03T00:00:00.000Z' },
    ],
  },
]
store.write(pid, withReplies)
const migrated = repo.get(pid).comments.find((c) => c.id === 'legacy-1')
assert.strictEqual(migrated.body, '原始想法\n回复：回复一\n回复：回复二', 'legacy replies merged into body')
assert.strictEqual('replies' in migrated, false, 'replies field dropped after migration')
ok('legacy replies[] migrated into body (no content lost)')

// 16. 迁移是幂等的：再读一次不再重复拼接
const again = repo.get(pid).comments.find((c) => c.id === 'legacy-1')
assert.strictEqual(again.body, '原始想法\n回复：回复一\n回复：回复二')
ok('migration is idempotent')

// 17. 迁移结果会落盘：触发一次写后，磁盘上不再有 replies 字段
repo.addCanvasComment(pid, 5, 5, '触发落盘')
const onDisk = store.read(pid).comments.find((c) => c.id === 'legacy-1')
assert.strictEqual('replies' in onDisk, false, 'replies removed from persisted file')
assert.strictEqual(onDisk.body, '原始想法\n回复：回复一\n回复：回复二')
ok('migrated comment persisted without replies')

console.log(`\nALL COMMENT TESTS PASSED (${passed} checks)`)
