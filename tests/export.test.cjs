// D.1 验证：导出核心（树的整理 + Markdown 渲染 + 文件名），纯函数、不依赖 Electron/网络。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/export.test.cjs`
const assert = require('assert')

const { buildOutline, renderMarkdown, suggestedFileName } = require('../dist-test/core/export')

let passed = 0
function ok(name) {
  passed++
  console.log('  ✓', name)
}

const ts = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()

function node(id, parentId, label, extra = {}) {
  return {
    id,
    parentId,
    label,
    prompt: extra.prompt ?? `提示：${label}`,
    content: extra.content ?? `# ${label}\n\n- 要点 1\n- 要点 2`,
    contentType: extra.contentType ?? 'markdown',
    status: 'done',
    generatorId: 'fake',
    versions: extra.versions ?? [],
    currentVersionId: extra.currentVersionId ?? null,
    createdAt: extra.createdAt ?? ts(0),
    updatedAt: ts(0),
  }
}

const file = {
  project: { id: 'p1', name: '我的创意', createdAt: ts(0), updatedAt: ts(0) },
  tree: {
    nodes: [
      node('n1', null, '创意主题', { createdAt: ts(0) }),
      node('n2', 'n1', '方向 A', {
        createdAt: ts(1),
        versions: [
          { id: 'v1', content: '# A 第一版', contentType: 'markdown', generatorId: 'fake', createdAt: ts(1) },
          { id: 'v2', content: '# A 第二版', contentType: 'markdown', generatorId: 'fake', createdAt: ts(2) },
        ],
        currentVersionId: 'v2',
        content: '# A 第二版',
      }),
      node('n3', 'n1', '方向 B', { createdAt: ts(2) }),
      node('n4', 'n2', '方向 A-1', { createdAt: ts(3) }),
      // 父子关系断裂（父节点已不存在）→ 应作为异常项附在尾部，而不是排到最前
      node('n5', 'missing', '孤儿节点', { createdAt: ts(4) }),
    ],
    edges: [],
  },
}

// ---------- 1. 整棵树：深度优先、父在前、同级按时间 ----------
const tree = buildOutline(file, { scope: 'tree' }, new Date('2026-09-20T01:00:00Z'))
assert.strictEqual(tree.scope, 'tree')
assert.strictEqual(tree.projectName, '我的创意')
assert.strictEqual(tree.exportedAt, '2026-09-20T01:00:00.000Z')
assert.deepStrictEqual(
  tree.nodes.map((n) => [n.id, n.depth]),
  [
    ['n1', 0],
    ['n2', 1],
    ['n4', 2],
    ['n3', 1],
    ['n5', 0],
  ],
  'DFS 顺序 + 层级 + 孤儿垫后',
)
ok('buildOutline(tree): DFS order, depth, orphans appended last')

// 同级按 createdAt 稳定排序（把 n3 的 createdAt 提前到最早，应排到 n2 之前）
const swapped = JSON.parse(JSON.stringify(file))
swapped.tree.nodes = swapped.tree.nodes.map((n) => (n.id === 'n3' ? { ...n, createdAt: ts(0) } : n))
const swappedDoc = buildOutline(swapped, { scope: 'tree' })
assert.deepStrictEqual(
  swappedDoc.nodes.map((n) => n.id),
  ['n1', 'n3', 'n2', 'n4', 'n5'],
  'siblings sorted by createdAt',
)
ok('buildOutline(tree): siblings sorted by createdAt')

// ---------- 2. 收敛路径：根 → 选中节点 ----------
const pathDoc = buildOutline(file, { scope: 'path', nodeId: 'n4' }, new Date('2026-09-20T01:00:00Z'))
assert.strictEqual(pathDoc.scope, 'path')
assert.deepStrictEqual(
  pathDoc.nodes.map((n) => [n.id, n.depth]),
  [
    ['n1', 0],
    ['n2', 1],
    ['n4', 2],
  ],
  '链路按根→叶顺序，depth 连续',
)
ok('buildOutline(path): root→node chain with contiguous depth')

// 未知节点 → 空文档（不抛错、不静默退化成整棵树）
const unknown = buildOutline(file, { scope: 'path', nodeId: 'nope' })
assert.strictEqual(unknown.nodes.length, 0)
assert.strictEqual(unknown.scope, 'path')
ok('buildOutline(path): unknown node yields an empty document (no silent fallback)')

// ---------- 3. 版本信息 ----------
const n2 = tree.nodes.find((n) => n.id === 'n2')
assert.strictEqual(n2.versionNumber, 2)
assert.strictEqual(n2.versionCount, 2)
const n1 = tree.nodes.find((n) => n.id === 'n1')
assert.strictEqual(n1.versionNumber, 0, 'no versions → 0')
assert.strictEqual(n1.versionCount, 0)
ok('buildOutline: current version number + count exposed')

// ---------- 4. Markdown 渲染 ----------
const md = renderMarkdown(tree)
assert.ok(md.startsWith('# 我的创意'), 'title first')
assert.ok(md.includes('范围：完整发散树'), 'scope label')
assert.ok(md.includes('节点数：5'), 'node count')
// 标题层级跟 depth 走：root→##, child→###, grandchild→####
assert.ok(md.includes('## 创意主题'), 'depth0 → h2')
assert.ok(md.includes('### 方向 A'), 'depth1 → h3')
assert.ok(md.includes('#### 方向 A-1'), 'depth2 → h4')
// 提示词以引用行呈现
assert.ok(md.includes('> 提示词：提示：方向 A'), 'prompt as blockquote')
// 多版本节点附加版本说明；单版本节点不加
assert.ok(md.includes('> 版本：v2（共 2 版，历史版本未导出）'), 'version note when >1')
assert.strictEqual((md.match(/> 版本：/g) || []).length, 1, 'only n2 has the version note')
// markdown 正文原样内联（不围栏）
assert.ok(md.includes('# A 第二版'), 'markdown inline as-is')
assert.ok(!md.includes('```markdown'), 'no markdown fence for markdown content')
// 顶级节点之间用分隔线
assert.ok(md.includes('\n---\n'), 'hr between top-level sections')
ok('renderMarkdown: headings by depth, prompt quote, version note, separators')

// 文本 / HTML / SVG → 围栏代码块（保住原文、且不会被当标记执行）
const mixed = buildOutline(
  {
    project: file.project,
    tree: {
      nodes: [
        node('x1', null, '纯文本', { contentType: 'text', content: '第一行\n第二行' }),
        node('x2', null, '网页', { contentType: 'html', content: '<h1>hi</h1>' }),
        node('x3', null, '矢量', { contentType: 'svg', content: '<svg></svg>' }),
      ],
      edges: [],
    },
  },
  { scope: 'tree' },
)
const mdm = renderMarkdown(mixed)
assert.ok(mdm.includes('```text\n第一行\n第二行\n```'), 'text fenced')
assert.ok(mdm.includes('```html\n<h1>hi</h1>\n```'), 'html fenced')
assert.ok(mdm.includes('```svg\n<svg></svg>\n```'), 'svg fenced')
ok('renderMarkdown: text/html/svg go into fenced code blocks')

// 内容里本身含反引号 → 围栏自动加长，避免被提前闭合
const tricky = buildOutline(
  {
    project: file.project,
    tree: { nodes: [node('t1', null, '含反引号', { contentType: 'text', content: 'a ``` b' })], edges: [] },
  },
  { scope: 'tree' },
)
const mdt = renderMarkdown(tricky)
assert.ok(mdt.includes('````text\na ``` b\n````'), 'fence escalates when content contains backticks')
ok('renderMarkdown: fence escalates to avoid premature closing')

// 空范围：给出可读占位而不是报错
const empty = buildOutline(file, { scope: 'path', nodeId: 'nope' })
assert.ok(renderMarkdown(empty).includes('没有可导出的节点'), 'empty placeholder')
ok('renderMarkdown: empty scope yields placeholder text')

// ---------- 5. 文件名 ----------
const f1 = suggestedFileName(tree, 'markdown')
assert.strictEqual(f1, '我的创意_2026-09-20.md')
const f2 = suggestedFileName(pathDoc, 'html')
assert.strictEqual(f2, '我的创意_收敛路径_2026-09-20.html')
// 非法字符（Windows 保留字符）被替换
const dirty = { ...tree, projectName: 'a/b:c*d?e"f<g>h|i' }
assert.strictEqual(suggestedFileName(dirty, 'markdown'), 'a_b_c_d_e_f_g_h_i_2026-09-20.md')
// 名字被清空（纯空白）时回落到默认名
const blank = { ...tree, projectName: '   ' }
assert.strictEqual(suggestedFileName(blank, 'markdown'), '发散创意画布_2026-09-20.md')
ok('suggestedFileName: date stamp, scope tag, sanitized illegal chars, blank fallback')

console.log(`\nALL EXPORT TESTS PASSED (${passed} checks)`)
