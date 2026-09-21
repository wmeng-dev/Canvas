// 项目文件：保存 / 另存为 / 打开 / 重命名 的 Node 运行时测试（不依赖 Electron）。
// 覆盖 AppStateStore、ensureProject 记忆上次项目、仓储 importExternal/persist/exists。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/project-save.test.cjs`
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { createServices, ensureProject } = require('../dist-test/core/services')
const { AppStateStore } = require('../dist-test/core/settings-store')
const { ProjectRepository } = require('../dist-test/core/storage/repositories')

let passed = 0
function ok(name) {
  passed++
  console.log('  ✓', name)
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-ps-'))
const svc = createServices({ dataDir: base, fakeGenerator: true })

// 1. AppStateStore：默认空，写入 lastProjectId 后可回读
const appState = new AppStateStore(base)
assert.deepStrictEqual(appState.read(), {})
appState.update((s) => ({ ...s, lastProjectId: 'abc' }))
assert.strictEqual(appState.read().lastProjectId, 'abc')
ok('AppStateStore 默认空 + 持久化 lastProjectId')

// 2. ensureProject 首次运行：创建项目并把 id 记进 appState
const f1 = ensureProject(svc)
assert.ok(f1.project.id, 'project id generated')
assert.strictEqual(svc.appState.read().lastProjectId, f1.project.id, 'lastProjectId 已记录')
ok('ensureProject 创建项目并记录 lastProjectId')

// 3. 模拟"重启"：同一 dataDir 新建服务，ensureProject 应恢复上次项目（而非 list[0] 兜底）
const svc2 = createServices({ dataDir: base, fakeGenerator: true })
const f2 = ensureProject(svc2)
assert.strictEqual(f2.project.id, f1.project.id, 'resumes last project id')
ok('ensureProject 重启后恢复上次项目')

// 4. importExternal：导入外部项目文件并落库，exists 可见，读回完整树
const extFile = {
  project: {
    id: 'ext-9',
    name: '外部项目',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  tree: {
    nodes: [
      {
        id: 'n9',
        parentId: null,
        label: '外部节点',
        prompt: 'p',
        content: 'c',
        contentType: 'markdown',
        analysis: null,
        status: 'done',
        generatorId: null,
        versions: [],
        currentVersionId: null,
        position: { x: 1, y: 2 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    edges: [],
  },
}
const imported = svc.repo.importExternal(extFile)
assert.strictEqual(imported.project.id, 'ext-9')
assert.ok(svc.repo.exists('ext-9'), 'exists() true after import')
ok('importExternal 落库 + exists() 可见')
const back = svc.repo.get('ext-9')
assert.strictEqual(back.project.name, '外部项目')
assert.strictEqual(back.tree.nodes[0].position.x, 1, '完整树（含坐标）读回')
assert.strictEqual(back.tree.nodes[0].versions.length, 1, 'migrateNode 补齐 v1')
ok('imported 项目读回完整（名称/坐标/迁移）')

// 5. persist：显式重新落盘
const p = svc.repo.persist('ext-9')
assert.strictEqual(p.project.id, 'ext-9')
ok('persist 重新落盘当前项目')

// 6. importExternal 缺 id 时自动补 id（保证可后续自动保存）
const noId = { project: { name: '无 id 项目' }, tree: { nodes: [], edges: [] } }
const imp = svc.repo.importExternal(noId)
assert.ok(imp.project.id, 'auto id assigned')
ok('importExternal 缺 id 时自动补 id')

// 7. ensureProject 兜底：lastProjectId 指向已删除项目时，应回退创建/取 list[0]
svc.appState.update((s) => ({ ...s, lastProjectId: 'gone-id' }))
const f3 = ensureProject(svc)
assert.ok(f3.project.id)
assert.notStrictEqual(f3.project.id, 'gone-id', '不会返回已消失的 id')
ok('ensureProject 在 lastProjectId 失效时兜底')

console.log(`\nALL PROJECT-SAVE TESTS PASSED (${passed} checks)`)
