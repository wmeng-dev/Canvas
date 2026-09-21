// 改名后的数据目录迁移测试（不依赖 Electron）。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/data-dir.test.cjs`
//
// 背景：应用改名 → userData 父目录（应用名）与子目录（品牌名）都变，
// 不迁移用户就会以为"画布全没了"。这里锁死迁移的**不变量**。
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { migrateLegacyDataDir, LEGACY_APP_NAMES, LEGACY_SUBDIR } = require('../dist-test/core/storage/data-dir')

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

/** 每个用例一个独立临时根，避免旧目录互相串味（第 ③ 用例尤其依赖"干净"）。 */
function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-datadir-'))
}
const roots = []
const mk = (root, rel, file, content) => {
  const dir = path.join(root, rel)
  fs.mkdirSync(dir, { recursive: true })
  if (file) fs.writeFileSync(path.join(dir, file), content)
  return dir
}

// ① 找到旧目录 → 复制到新目录，且**旧目录保留**
{
  const root = freshRoot(); roots.push(root)
  const oldUserData = path.join(root, LEGACY_APP_NAMES[0])
  mk(oldUserData, path.join(LEGACY_SUBDIR, 'projects'), 'a.json', '{"project":1}')

  const newUserData = path.join(root, 'ideasprout-desktop')
  fs.mkdirSync(newUserData, { recursive: true })
  const newDir = path.join(newUserData, 'ideasprout')

  const r = migrateLegacyDataDir(newUserData, newDir)
  assert.strictEqual(r.migrated, true)
  assert.strictEqual(r.from, path.join(oldUserData, LEGACY_SUBDIR))
  assert.strictEqual(fs.readFileSync(path.join(newDir, 'projects', 'a.json'), 'utf8'), '{"project":1}')
  ok('旧目录被复制到新目录')

  // ⚠️ 不变量：**旧目录必须还在**（复制而非移动，给用户留后路）
  assert.strictEqual(fs.existsSync(path.join(oldUserData, LEGACY_SUBDIR, 'projects', 'a.json')), true)
  ok('旧目录保留不动（复制而非移动）')
}

// ② 新目录已存在 → 绝不覆盖
{
  const root = freshRoot(); roots.push(root)
  mk(root, path.join(LEGACY_APP_NAMES[1], LEGACY_SUBDIR), 'old.json', 'old')

  const newUserData = path.join(root, 'ideasprout-desktop')
  const newDir = mk(newUserData, 'ideasprout', 'new.json', 'new')

  const r = migrateLegacyDataDir(newUserData, newDir)
  assert.strictEqual(r.migrated, false)
  assert.strictEqual(r.reason, 'new-exists')
  assert.strictEqual(fs.existsSync(path.join(newDir, 'new.json')), true)
  assert.strictEqual(fs.existsSync(path.join(newDir, 'old.json')), false)
  ok('新目录已有数据时不覆盖（reason=new-exists）')
}

// ③ 干净环境（无任何旧目录）→ 安静返回，不创建空目录
{
  const root = freshRoot(); roots.push(root)
  const newUserData = path.join(root, 'ideasprout-desktop')
  fs.mkdirSync(newUserData, { recursive: true })
  const newDir = path.join(newUserData, 'ideasprout')

  const r = migrateLegacyDataDir(newUserData, newDir)
  assert.strictEqual(r.migrated, false)
  assert.strictEqual(r.reason, 'no-legacy')
  assert.strictEqual(fs.existsSync(newDir), false)
  ok('全新安装：无旧目录则不动（reason=no-legacy）')
}

for (const root of roots) fs.rmSync(root, { recursive: true, force: true })

console.log(`\nALL DATA-DIR TESTS PASSED (${passed} checks)`)
