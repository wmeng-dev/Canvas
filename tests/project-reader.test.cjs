// 只读数据访问层（mcp-server/project-reader）单测。
// 重点不在"能读到"，而在**边界**：坏文件/非 json 文件不能拖垮列表、按名字也能定位、
// 路径穿越必须被消毒挡住、includeContent 默认不开（否则树一大就吃满调用方上下文）。
// 运行：先编译测试构建，再 `node tests/project-reader.test.cjs`
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  resolveProjectsDir,
  listProjects,
  readProjectFile,
  getTree,
  getNode,
} = require('../dist-test/core/mcp-server/project-reader')
const { sanitizeProjectId } = require('../dist-test/core/storage/store')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diverge-reader-'))
fs.mkdirSync(dir, { recursive: true })

const writeRaw = (name, text) => fs.writeFileSync(path.join(dir, name), text, 'utf-8')

const node = (id, parentId, label, prompt, extra = {}) => ({
  id,
  parentId,
  label,
  prompt,
  content: `正文-${id}`,
  contentType: 'markdown',
  analysis: { feasibility: 60, pros: ['p'], cons: ['c'], risks: ['r'] },
  status: 'done',
  generatorId: null,
  versions: [
    {
      id: `${id}-v1`,
      content: `正文-${id}`,
      contentType: 'markdown',
      title: label,
      analysis: null,
      generatorId: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  currentVersionId: `${id}-v1`,
  position: { x: 0, y: 0 },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...extra,
})

const projectFile = (id, name, updatedAt, nodes) => ({
  project: { id, name, createdAt: '2024-01-01T00:00:00.000Z', updatedAt },
  tree: { nodes, edges: nodes[1] ? [{ id: 'e1', source: nodes[0].id, target: nodes[1].id }] : [] },
})

// 甲：旧、2 个节点、1 条边
writeRaw(
  'p-a.json',
  JSON.stringify(
    projectFile('p-a', '甲项目', '2024-01-01T00:00:00.000Z', [
      node('n1', null, '根：创意主题', ''),
      node('n2', 'n1', '结果标题二', '把核心体验做减法'),
    ]),
  ),
)
// 乙：新、1 个节点 → 应排在前面
writeRaw(
  'p-b.json',
  JSON.stringify(projectFile('p-b', '乙项目', '2025-06-01T00:00:00.000Z', [node('m1', null, '独立想法', '')])),
)
// 坏文件：非法 JSON → 必须被跳过，不能让整个列表失败
writeRaw('broken.json', '{ this is not json')
// 非 json 文件 → 必须被忽略
writeRaw('notes.txt', 'ignore me')
// id 含特殊字符：文件名是消毒后的，靠"扫文件比对 project.id"兜底
writeRaw(
  'we_ird.json',
  JSON.stringify(projectFile('we/ird', '怪 id 项目', '2023-01-01T00:00:00.000Z', [node('w1', null, 'x', '')])),
)
// 文件名与 project.id **对不上**（模拟历史遗留命名）→ 只能靠兜底扫描找到
writeRaw(
  'legacy-named.json',
  JSON.stringify(projectFile('legacy-id', '遗留命名项目', '2022-01-01T00:00:00.000Z', [node('l1', null, 'y', '')])),
)

let passed = 0
const ok = (n) => {
  passed++
  console.log('  ✓', n)
}

// 1) id 消毒是单一事实源（与写入方 JsonStore 用同一个函数）
assert.strictEqual(sanitizeProjectId('we/ird'), 'we_ird')
assert.strictEqual(sanitizeProjectId('../..'), '_____')
ok('sanitizeProjectId 与写入方一致（路径分隔符被替换）')

// 2) listProjects：跳过坏文件与非 json、按 updatedAt 倒序、带 nodeCount
const list = listProjects(dir)
assert.strictEqual(list.length, 4, '损坏/非 json 文件不得计入，实得 ' + JSON.stringify(list.map((p) => p.id)))
assert.deepStrictEqual(
  list.map((p) => p.id),
  ['p-b', 'p-a', 'we/ird', 'legacy-id'],
  '应按 updatedAt 倒序',
)
assert.strictEqual(list.find((p) => p.id === 'p-a').nodeCount, 2)
assert.strictEqual(list.find((p) => p.id === 'p-a').name, '甲项目')
ok('listProjects：跳过坏文件，按更新时间倒序，带 nodeCount/name')

// 3) getTree：默认**不带正文**（防止大树的正文灌满调用方上下文）
const tree = getTree(dir, 'p-a')
assert.strictEqual(tree.nodes.length, 2)
assert.strictEqual(tree.edges.length, 1)
assert.strictEqual(tree.project.name, '甲项目')
assert.ok(!('content' in tree.nodes[0]), '默认不应返回正文')
assert.strictEqual(tree.nodes[1].label, '结果标题二', 'label 是结果标题')
assert.strictEqual(tree.nodes[1].prompt, '把核心体验做减法', 'prompt 是用户原始描述')
assert.strictEqual(tree.nodes[0].versionCount, 1)
assert.ok(tree.nodes[0].analysis && tree.nodes[0].analysis.feasibility === 60, '带可行性评估')
ok('getTree：精简节点（无正文）+ 边 + 标题/原始描述/评估区分清楚')

// 4) includeContent=true 才带正文
const treeFull = getTree(dir, 'p-a', true)
assert.strictEqual(treeFull.nodes[0].content, '正文-n1')
ok('getTree(includeContent=true)：附带当前版本正文')

// 5) 用**项目名**也能定位（调用方常常只知道名字）
assert.strictEqual(getTree(dir, '乙项目').project.id, 'p-b')
ok('getTree：projectId 传项目名也能命中')

// 6) getNode：给单个节点的全量（含历史版本）
const one = getNode(dir, 'p-a', 'n2')
assert.strictEqual(one.node.id, 'n2')
assert.strictEqual(one.node.versions.length, 1)
assert.strictEqual(one.node.versions[0].title, '结果标题二')
ok('getNode：返回单节点全量（含 versions）')

// 7) 怪 id 项目：文件名 == 消毒后的 id → 直接命中
assert.strictEqual(readProjectFile(dir, 'we/ird').project.id, 'we/ird')
//    文件名与 id 完全对不上 → 必须靠"扫文件比对 project.id"兜底命中
assert.strictEqual(fs.existsSync(path.join(dir, 'legacy-id.json')), false, '前提：按 id 直接找文件不存在')
assert.strictEqual(readProjectFile(dir, 'legacy-id').project.id, 'legacy-id')
ok('readProjectFile：id 含特殊字符 / 文件名与 id 对不上，均能定位')

// 8) 路径穿越必须被挡住（消毒 + 找不到就报错）
assert.throws(() => getTree(dir, '../../etc/passwd'), /找不到项目/)
assert.throws(() => getNode(dir, 'p-a', '不存在节点'), /找不到节点/)
assert.throws(() => readProjectFile(dir, 'broken'), /解析失败/)
ok('路径穿越 / 未知节点 / 坏文件 → 明确抛错（不返回空数据冒充成功）')

// 9) 目录不存在 → 空列表（而不是崩）
assert.deepStrictEqual(listProjects(path.join(dir, 'no-such-dir')), [])
ok('listProjects：目录不存在返回空数组')

// 10) resolveProjectsDir 优先级：显式 DIVERGE_DATA_DIR 最优先
assert.strictEqual(resolveProjectsDir({ DIVERGE_DATA_DIR: '/tmp/xyz' }), path.join('/tmp/xyz', 'projects'))
// 空环境（无 APPDATA/HOME 等）→ 没有候选目录 → null
assert.strictEqual(resolveProjectsDir({}), null)
ok('resolveProjectsDir：优先 DIVERGE_DATA_DIR；无候选时返回 null')

console.log(`\nALL PROJECT READER TESTS PASSED (${passed} checks)`)
