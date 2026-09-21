// 节点卡片自定义颜色：调色板校验 + 仓储持久化 + 老文件兼容。
// 编译：tsc -p tsconfig.test.json（dist-test 含 core + shared）
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { CARD_COLORS, isValidCardColor, resolveCardBg, resolveCardBorder } = require('../dist-test/shared/colors')
const { JsonStore } = require('../dist-test/core/storage/store')
const { ProjectRepository } = require('../dist-test/core/storage/repositories')

let passed = 0
function ok(name) {
  passed++
  console.log('  ✓', name)
}

// ---------------- 1. 调色板 ----------------
console.log('\n[1] 调色板与校验')
assert.ok(CARD_COLORS.length >= 6, '调色板至少要 6 个色（含默认）')
ok('调色板非空（含默认色）')
assert.strictEqual(CARD_COLORS[0].id, 'default')
ok('第一个是默认色')

assert.strictEqual(isValidCardColor(null), true)
assert.strictEqual(isValidCardColor(undefined), true)
ok('null / undefined 合法（= 默认色）')

const green = CARD_COLORS.find((c) => c.id === 'green')
assert.strictEqual(isValidCardColor(green.bg), true)
ok('调色板内的色值合法')

assert.strictEqual(isValidCardColor('#000000'), false)
assert.strictEqual(isValidCardColor('red'), false)
assert.strictEqual(isValidCardColor(123), false)
ok('调色板外的色值 / 非字符串一律拒绝')

assert.strictEqual(resolveCardBg(null), CARD_COLORS[0].bg)
assert.strictEqual(resolveCardBg(green.bg), green.bg)
assert.strictEqual(resolveCardBg('#123456'), CARD_COLORS[0].bg)
ok('解析背景色：非法值退回默认白（坏数据不该让卡片变黑块）')

assert.strictEqual(resolveCardBorder(null), CARD_COLORS[0].border)
assert.strictEqual(resolveCardBorder(green.bg), green.border)
assert.strictEqual(resolveCardBorder('nonsense'), CARD_COLORS[0].border)
ok('解析边框色：与背景同色系，非法值退回默认')

// 所有色都要能解析出非空的 bg/border，否则会出现"选了色但看不出来"
for (const c of CARD_COLORS) {
  assert.ok(/^#[0-9a-f]{6}$/i.test(c.bg), `bg 非法: ${c.bg}`)
  assert.ok(/^#[0-9a-f]{6}$/i.test(c.border), `border 非法: ${c.border}`)
}
ok('每个色的 bg / border 都是合法 6 位十六进制')

// ---------------- 2. 仓储 ----------------
console.log('\n[2] 仓储：改色 / 落盘 / 重读')
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-color-'))
const repo = new ProjectRepository(new JsonStore({ baseDir: base }))
const file = repo.create('配色测试')
const pid = file.project.id
const root = repo.addNode(pid, { label: '根主题', prompt: '', status: 'empty' })
const child = repo.addNode(pid, { label: '子方向', prompt: '', status: 'empty', parentId: root.id })

assert.strictEqual(repo.get(pid).tree.nodes[0].color, null)
ok('新建节点默认无颜色（null）')

const blue = CARD_COLORS.find((c) => c.id === 'blue')
repo.setNodeColor(pid, child.id, blue.bg)
let nodes = repo.get(pid).tree.nodes
assert.strictEqual(nodes.find((n) => n.id === child.id).color, blue.bg)
ok('改色落盘')
assert.strictEqual(nodes.find((n) => n.id === root.id).color, null)
ok('改色只影响目标节点（逐节点独立，不影响父子）')

// 换色 + 恢复默认
const yellow = CARD_COLORS.find((c) => c.id === 'yellow')
repo.setNodeColor(pid, child.id, yellow.bg)
assert.strictEqual(repo.get(pid).tree.nodes.find((n) => n.id === child.id).color, yellow.bg)
ok('二次改色覆盖旧色')
repo.setNodeColor(pid, child.id, null)
assert.strictEqual(repo.get(pid).tree.nodes.find((n) => n.id === child.id).color, null)
ok('传 null 恢复默认色')

// 非法值必须抛错（静默存下来会让渲染端退回默认色，用户以为"改色没生效"）
assert.throws(() => repo.setNodeColor(pid, child.id, '#000000'), /Unknown card color/)
assert.throws(() => repo.setNodeColor(pid, child.id, 'not-a-color'), /Unknown card color/)
ok('非法色值抛错而不是静默落盘')
assert.throws(() => repo.setNodeColor(pid, '不存在的节点', blue.bg), /Node not found/)
ok('未知节点 id 抛错')

// 改色不该动内容/版本等其它字段
const before = repo.get(pid).tree.nodes.find((n) => n.id === child.id)
repo.setNodeColor(pid, child.id, green.bg)
const after = repo.get(pid).tree.nodes.find((n) => n.id === child.id)
assert.strictEqual(after.label, before.label)
assert.strictEqual(after.content, before.content)
assert.strictEqual(after.collapsed, before.collapsed)
assert.strictEqual(after.archived, before.archived)
ok('改色不触碰内容 / 收展 / 归档等其它字段')

// ---------------- 3. 老项目文件兼容 ----------------
console.log('\n[3] 老项目文件兼容')
const base2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-color-old-'))
const repo2 = new ProjectRepository(new JsonStore({ baseDir: base2 }))
const f2 = repo2.create('老文件')
const n2 = repo2.addNode(f2.project.id, { label: '旧节点', prompt: '', status: 'empty' })
const rawPath = path.join(base2, 'projects', `${f2.project.id}.json`)
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
delete raw.tree.nodes[0].color
fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2))
assert.strictEqual(repo2.get(f2.project.id).tree.nodes[0].color, null)
ok('缺 color 字段 ⇒ 读回时补为 null（默认白）')

// 脏数据：存了一个调色板里没有的色值
const raw2 = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
raw2.tree.nodes[0].color = '#000000'
fs.writeFileSync(rawPath, JSON.stringify(raw2, null, 2))
assert.strictEqual(repo2.get(f2.project.id).tree.nodes[0].color, null)
ok('存了非法色值 ⇒ 读回时被清洗成默认色（不会渲染成黑块）')
assert.ok(n2.id)
ok('（该节点的 id 未受影响）')

console.log(`\nCARD_COLOR_TESTS OK (${passed})`)
