// 多画布（tab 条）：列出 / 新建空白画布 / 切换 / 记住上次画布。
// 只测 core 层（不依赖 Electron）。
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { JsonStore } = require('../dist-test/core/storage/store')
const { ProjectRepository } = require('../dist-test/core/storage/repositories')
const { AppStateStore, plaintextSecretBox } = require('../dist-test/core/settings-store')
const {
  createServices,
  ensureProject,
  listProjectSummaries,
  createProject,
  switchProject,
} = require('../dist-test/core/services')

let passed = 0
function ok(name) {
  passed++
  console.log('  ✓', name)
}

function makeSvc() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-canvases-'))
  const svc = createServices({ dataDir: baseDir, secrets: plaintextSecretBox(), fakeGenerator: true })
  return svc
}

// ---------------- 1. 首次进入 ----------------
console.log('\n[1] 首次进入：自动建一个带根节点的画布')
const svc = makeSvc()
const first = ensureProject(svc)
assert.strictEqual(first.tree.nodes.length, 1)
assert.strictEqual(first.tree.nodes[0].label, '创意主题')
ok('空库 ⇒ 建「我的创意」+ 一个根节点「创意主题」')
assert.strictEqual(svc.appState.read().lastProjectId, first.project.id)
ok('记住 lastProjectId')

// ---------------- 2. 列表 ----------------
console.log('\n[2] 列出画布（tab 条）')
let list = listProjectSummaries(svc)
assert.strictEqual(list.length, 1)
assert.strictEqual(list[0].id, first.project.id)
assert.strictEqual(list[0].name, '我的创意')
assert.strictEqual(list[0].nodeCount, 1)
ok('摘要含 id / name / nodeCount')

// ---------------- 3. 新建空白画布 ----------------
console.log('\n[3] 新建画布 = 空白页（不建默认节点）')
const second = createProject(svc)
assert.strictEqual(second.tree.nodes.length, 0, '新建画布必须是空的')
ok('新建画布一个节点都没有')
assert.strictEqual(second.tree.edges.length, 0)
ok('也没有边')
assert.ok(second.project.name && second.project.name.length > 0)
ok('有默认名字（未命名画布）')
assert.notStrictEqual(second.project.id, first.project.id)
ok('是一个独立的新项目')
assert.strictEqual(svc.appState.read().lastProjectId, second.project.id)
ok('新建后 lastProjectId 指向新画布（下次打开回来还是它）')

// 指定名字
const named = createProject(svc, '  温室数字孪生  ')
assert.strictEqual(named.project.name, '温室数字孪生')
ok('传入名字时按名字建（并 trim）')
const blankName = createProject(svc, '   ')
assert.ok(blankName.project.name.length > 0)
ok('传空白名字时回落到默认名')

// 列表按最近更新倒序
list = listProjectSummaries(svc)
assert.strictEqual(list.length, 4)
assert.strictEqual(list[0].id, blankName.project.id)
ok('列表按最近更新倒序（刚建的排最前）')
assert.strictEqual(list.find((p) => p.id === first.project.id).nodeCount, 1)
ok('老画布的节点数仍正确')

// ---------------- 4. 切换 ----------------
console.log('\n[4] 切画布')
const back = switchProject(svc, first.project.id)
assert.strictEqual(back.project.id, first.project.id)
assert.strictEqual(back.tree.nodes.length, 1)
ok('切回老画布：内容完整（节点还在）')
assert.strictEqual(svc.appState.read().lastProjectId, first.project.id)
ok('切换后 lastProjectId 跟着变')

// 切到不存在的 id 必须报错（不能静默给个空画布）
assert.throws(() => switchProject(svc, '不存在的画布'), /not found/i)
ok('切到不存在的画布会抛错')

// ---------------- 5. 重启恢复 ----------------
console.log('\n[5] 重启：回到上次那张画布')
const dataDir = svc.dataDir
const svc2 = createServices({ dataDir, secrets: plaintextSecretBox(), fakeGenerator: true })
const resumed = ensureProject(svc2)
assert.strictEqual(resumed.project.id, first.project.id)
ok('新起服务 ⇒ ensureProject 回到 lastProjectId（tab 状态保持）')
const resumedList = listProjectSummaries(svc2)
assert.strictEqual(resumedList.length, 4)
ok('所有画布都还在（4 张）')

// 空白画布重新装载后依然是空的（不能被 migrate 塞节点）
const reBlank = switchProject(svc2, second.project.id)
assert.strictEqual(reBlank.tree.nodes.length, 0)
ok('空白画布重新打开后仍是空白（migrate 不会凭空加节点）')

// ---------------- 6. 独立互不干扰 ----------------
console.log('\n[6] 各画布互不干扰')
const before = svc2.repo.get(named.project.id).tree.nodes.length
svc2.repo.addNode(first.project.id, { label: '只在第一张画布上', prompt: '', status: 'empty' })
assert.strictEqual(svc2.repo.get(named.project.id).tree.nodes.length, before)
ok('在 A 画布加节点，不影响 B 画布')
assert.strictEqual(svc2.repo.get(first.project.id).tree.nodes.length, 2)
ok('A 画布自己的节点加上了')

console.log(`\nCANVASES_TESTS OK (${passed})`)
