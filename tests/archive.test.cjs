// 想法回收站（归档 / 取出）：纯函数规则 + 仓储持久化 + 老文件兼容。
// 编译：tsc -p tsconfig.test.json（dist-test 含 core + shared）
const path = require('path')
const fs = require('fs')
const os = require('os')

const { collectHiddenIds, collectArchivedTopIds, collectAncestorIds, collectDescendantIds } = require(
  '../dist-test/shared/tree',
)
const { ProjectRepository } = require('../dist-test/core/storage/repositories')
const { JsonStore } = require('../dist-test/core/storage/store')

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✓', name)
  } else {
    fail++
    console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra))
  }
}

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-archive-'))
  return d
}

/** 造一份内存里的项目（含父子结构），返回仓储与节点 id */
function makeRepo() {
  const dir = tmpDir()
  const repo = new ProjectRepository(new JsonStore({ baseDir: dir }))
  const file = repo.create('归档测试')
  const pid = file.project.id
  const root = repo.addNode(pid, { label: '根', prompt: '', status: 'empty', position: { x: 0, y: 0 } })
  const a = repo.addNode(pid, { label: 'A', prompt: '', status: 'empty', parentId: root.id, position: { x: 1, y: 0 } })
  const b = repo.addNode(pid, { label: 'B', prompt: '', status: 'empty', parentId: a.id, position: { x: 2, y: 0 } })
  return { dir, repo, pid, ids: { root: root.id, a: a.id, b: b.id } }
}

const vis = (repo, pid) =>
  repo.get(pid).tree.nodes.map((n) => ({ id: n.id, parentId: n.parentId, collapsed: n.collapsed, archived: n.archived }))

async function main() {
  console.log('\n[A] 可见性纯函数：归档 = 自身 + 后代隐藏')
  const tree = [
    { id: 'r', parentId: null },
    { id: 'a', parentId: 'r' },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'r' },
  ]
  check(
    '归档 a ⇒ a 与后代 b 隐藏；r / c 仍可见',
    JSON.stringify([...collectHiddenIds(tree.map((n) => ({ ...n, archived: n.id === 'a' })))].sort()) ===
      JSON.stringify(['a', 'b']),
    [...collectHiddenIds(tree.map((n) => ({ ...n, archived: n.id === 'a' })))],
  )
  check(
    '归档 r ⇒ 整棵树隐藏（自身也隐藏，与"收起"不同）',
    [...collectHiddenIds(tree.map((n) => ({ ...n, archived: n.id === 'r' })))].sort().join(',') === 'a,b,c,r',
  )
  check(
    '收起 r 与归档 r 的区别：收起时 r 自身仍可见',
    ![...collectHiddenIds(tree.map((n) => ({ ...n, collapsed: n.id === 'r' })))].includes('r'),
  )
  check(
    '环保护：父子成环不死循环（返回集合且能算出结果）',
    collectHiddenIds([
      { id: 'x', parentId: 'y', archived: true },
      { id: 'y', parentId: 'x' },
    ]) instanceof Set,
  )

  console.log('\n[B] 回收站列表只列"顶层"归档项')
  const t2 = [
    { id: 'r', parentId: null, archived: true },
    { id: 'a', parentId: 'r', archived: true },
    { id: 'b', parentId: 'a', archived: false },
    { id: 'c', parentId: null, archived: false },
    { id: 'd', parentId: null, archived: true },
  ]
  check('r、a 都归档 ⇒ 只列 r（a 是 r 的后代，跟着走）', collectArchivedTopIds(t2).sort().join(',') === 'd,r', collectArchivedTopIds(t2))
  check('祖先链收集：b 的祖先是 a、r（由近到远）', collectAncestorIds(t2, 'b').join(',') === 'a,r', collectAncestorIds(t2, 'b'))
  check('后代收集：r 的后代含 a、b', collectDescendantIds(t2, 'r').sort().join(',') === 'a,b')
  check('环保护：祖先链成环不死循环', collectAncestorIds([{ id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }], 'x').length <= 1)

  console.log('\n[C] 仓储：归档 / 取出 / 落盘 / 重读')
  const { repo, pid, ids } = makeRepo()
  repo.setNodesArchived(pid, [ids.a], true)
  let nodes = vis(repo, pid)
  check('归档 A：A 落盘为 archived=true', nodes.find((n) => n.id === ids.a).archived === true)
  check('归档 A 不连带标记后代 B（后代只是跟着隐藏）', nodes.find((n) => n.id === ids.b).archived === false)
  check(
    '画布可见性：A 与 B 都隐藏，根仍可见',
    [...collectHiddenIds(nodes)].sort().join(',') === [ids.a, ids.b].sort().join(','),
  )

  // 取出：只取消自己
  repo.setNodesArchived(pid, [ids.a], false)
  check('取出 A：A 恢复 archived=false', vis(repo, pid).find((n) => n.id === ids.a).archived === false)

  // 归档祖先 → 取出后代必须连带祖先
  repo.setNodesArchived(pid, [ids.root], true)
  repo.setNodesArchived(pid, [ids.a], true)
  check(
    '根与 A 都归档时，B 仍不可见（祖先链上还有归档项）',
    collectHiddenIds(vis(repo, pid)).has(ids.b),
  )
  const ancestors = collectAncestorIds(vis(repo, pid), ids.b).filter(
    (id) => vis(repo, pid).find((n) => n.id === id).archived,
  )
  repo.setNodesArchived(pid, [ids.b, ...ancestors], false)
  nodes = vis(repo, pid)
  check('取出 B 连带祖先 ⇒ 根/A/B 全部取消归档', nodes.every((n) => !n.archived))
  check('取出后画布上没有任何隐藏节点', collectHiddenIds(nodes).size === 0)

  console.log('\n[D] 批量与健壮性')
  check('未知 id 静默跳过，不抛错', repo.setNodesArchived(pid, ['不存在的id'], true).length === 0)
  check('空数组不改动任何节点', repo.setNodesArchived(pid, [], true).length === 0)
  const before = JSON.stringify(vis(repo, pid))
  repo.setNodesArchived(pid, [ids.a, ids.b], true)
  check('一次批量归档多个', vis(repo, pid).filter((n) => n.archived).length === 2)
  repo.setNodesArchived(pid, [ids.a, ids.b], false)
  check('批量取出还原', JSON.stringify(vis(repo, pid)) === before)

  console.log('\n[E] 老项目文件兼容：没有 archived 字段')
  const dir2 = tmpDir()
  const repo2 = new ProjectRepository(new JsonStore({ baseDir: dir2 }))
  const f2 = repo2.create('老文件')
  const n2 = repo2.addNode(f2.project.id, { label: '旧节点', prompt: '', status: 'empty', position: { x: 0, y: 0 } })
  const rawPath = path.join(dir2, 'projects', `${f2.project.id}.json`)
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
  delete raw.tree.nodes[0].archived
  fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2))
  const back = repo2.get(f2.project.id)
  check('缺 archived 字段 ⇒ 读回时补为 false（不归档）', back.tree.nodes[0].archived === false)
  check('补齐后不出现在回收站列表里', collectArchivedTopIds(vis(repo2, f2.project.id)).length === 0)
  check('补齐后节点在画布上可见', !collectHiddenIds(vis(repo2, f2.project.id)).has(n2.id))

  console.log(`\nARCHIVE_TESTS ${fail === 0 ? 'OK' : 'FAIL'} (${pass}/${pass + fail})`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
