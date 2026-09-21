// 关闭画布 tab 的服务层 Node 运行时测试（不依赖 Electron）。
// 语义定案：**关闭 tab ≠ 删除数据** —— 项目文件留在磁盘，只是从 tab 条移除，随时可恢复。
// 覆盖：关闭后不在 tab 列表 / 文件仍在 / 已关闭列表 / 恢复 / 关当前画布会挪走 lastProjectId /
//       ensureProject 不会回到已关闭的画布 / 全关光时 ensureProject 新建引导画布。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/canvas-close.test.cjs`
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { JsonStore } = require('../dist-test/core/storage/store')
const { ProjectRepository } = require('../dist-test/core/storage/repositories')
const { AppStateStore } = require('../dist-test/core/settings-store')
const {
  closeProject,
  reopenProject,
  listProjectSummaries,
  listClosedSummaries,
  ensureProject,
  switchProject,
} = require('../dist-test/core/services')

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'diverge-close-'))
const repo = new ProjectRepository(new JsonStore({ baseDir: base }))
const appState = new AppStateStore(base)
const svc = { repo, appState }

// 1. 建两张画布，第二张加点内容
const a = repo.create('画布A')
const b = repo.create('画布B')
repo.addNode(b.project.id, { label: '一个想法', prompt: 'p', status: 'empty' })
const fileB = repo.get(b.project.id)
assert.strictEqual(fileB.tree.nodes.length, 1)

// 2. 初始：两张都在 tab 条上，已关闭为空
assert.deepStrictEqual(listProjectSummaries(svc).map((p) => p.id).sort(), [a.project.id, b.project.id].sort())
assert.deepStrictEqual(listClosedSummaries(svc), [])
ok('初始：两张画布都在 tab 条上，已关闭列表为空')

// 3. 关闭 A：tab 条只剩 B，A 进已关闭
switchProject(svc, a.project.id) // 先把当前切到 A
const afterClose = closeProject(svc, a.project.id)
assert.deepStrictEqual(afterClose.map((p) => p.id), [b.project.id])
assert.deepStrictEqual(listClosedSummaries(svc).map((p) => p.id), [a.project.id])
ok('closeProject：从 tab 条移除，进入已关闭列表')

// 4. ⚠️ 关键：数据没被删 —— 项目文件还在磁盘上，内容完整
assert.ok(fs.existsSync(path.join(base, 'projects', `${a.project.id}.json`)), 'A 的项目文件仍在磁盘')
assert.strictEqual(repo.get(a.project.id).project.name, '画布A')
assert.ok(repo.exists(a.project.id))
ok('关闭不删数据：项目文件仍在磁盘且内容完整')

// 5. 关掉的是当前画布时，lastProjectId 要挪到剩下的一张（否则下次打开会回到已关闭的画布）
assert.strictEqual(appState.read().lastProjectId, b.project.id)
ok('关掉当前画布：lastProjectId 自动挪到剩下的画布')

// 6. ensureProject 不会把已关闭的画布捞回来
const ensured = ensureProject(svc)
assert.strictEqual(ensured.project.id, b.project.id, 'ensureProject 跳过已关闭的 A')
ok('ensureProject：跳过已关闭的画布，回到还开着的那张')

// 7. 恢复 A：回到 tab 条、从已关闭列表移除、并成为当前画布
const reopened = reopenProject(svc, a.project.id)
assert.strictEqual(reopened.project.id, a.project.id)
assert.strictEqual(reopened.project.name, '画布A')
assert.deepStrictEqual(listClosedSummaries(svc), [])
assert.deepStrictEqual(listProjectSummaries(svc).map((p) => p.id).sort(), [a.project.id, b.project.id].sort())
assert.strictEqual(appState.read().lastProjectId, a.project.id)
// 恢复后内容还在（关闭期间没人动过它）
assert.strictEqual(repo.get(a.project.id).tree.nodes.length, 0, 'A 本来就是空的')
assert.strictEqual(repo.get(b.project.id).tree.nodes.length, 1, 'B 的内容完好')
ok('reopenProject：回到 tab 条并成为当前画布，内容完好')

// 8. 重复关闭同一张是幂等的（不会在已关闭里出现两次）
closeProject(svc, a.project.id)
closeProject(svc, a.project.id)
assert.deepStrictEqual(listClosedSummaries(svc).map((p) => p.id), [a.project.id])
ok('重复关闭同一张：已关闭列表不重复')

// 9. 关闭一张不存在的画布：不崩（列表只是少一张/不变）
const before = listProjectSummaries(svc).length
closeProject(svc, 'no-such-canvas')
assert.strictEqual(listProjectSummaries(svc).length, before)
ok('关闭不存在的画布：不抛错、tab 列表不变')

// 10. 全关光（B 也关掉）→ ensureProject 新建引导画布，保证界面里始终有一张
closeProject(svc, b.project.id)
assert.deepStrictEqual(listProjectSummaries(svc), [])
assert.strictEqual(listClosedSummaries(svc).length, 2)
const fresh = ensureProject(svc)
assert.ok(fresh.project.id, '新建出引导画布')
assert.ok(fs.existsSync(path.join(base, 'projects', `${fresh.project.id}.json`)))
ok('全部关闭后：ensureProject 新建引导画布（界面里始终有一张）')

// 11. 关掉的两张数据都还在（关闭是"隐藏"不是"删除"）
assert.strictEqual(repo.get(a.project.id).project.name, '画布A')
assert.strictEqual(repo.get(b.project.id).tree.nodes.length, 1)
ok('全部关闭后：两张画布的数据都还在磁盘上')

// 12. 已关闭列表顺序 = 关闭顺序（先关的在前）
assert.deepStrictEqual(listClosedSummaries(svc).map((p) => p.id), [a.project.id, b.project.id])
ok('已关闭列表按关闭顺序输出（先关的在前）')

// 13. appState 落盘：重新读一份 AppStateStore，已关闭列表还在（重启后仍可恢复）
const reread = new AppStateStore(base).read()
assert.deepStrictEqual(reread.closedProjectIds, [a.project.id, b.project.id])
ok('已关闭列表落盘：重启后仍能找回')

console.log(`\nALL CANVAS-CLOSE TESTS PASSED (${passed} checks)`)
