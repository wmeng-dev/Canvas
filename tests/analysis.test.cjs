// D.7 验证：发散评估的纯函数层与"AI 输出 → 结构化"的解析层。
// 这两层是新增的"可信边界"——模型的输出永远不可信，所有收口都在这里，所以边界值要逐个钉死。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/analysis.test.cjs`
const assert = require('assert')

const A = require('../dist-test/shared/analysis')
const { parseIdeaResponse } = require('../dist-test/core/generator/parse-idea')
const { analysisMarkdownLines, renderMarkdown } = require('../dist-test/core/export')

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

// ---------- 1. 可行性分档 ----------
assert.strictEqual(A.feasibilityBand(100).label, '高')
assert.strictEqual(A.feasibilityBand(70).label, '高', '70 是高档下界（含）')
assert.strictEqual(A.feasibilityBand(69).label, '中')
assert.strictEqual(A.feasibilityBand(40).label, '中', '40 是中档下界（含）')
assert.strictEqual(A.feasibilityBand(39).label, '低')
assert.strictEqual(A.feasibilityBand(0).label, '低')
assert.strictEqual(A.feasibilityBand(70).key, 'high')
assert.ok(/^#[0-9a-f]{6}$/i.test(A.feasibilityBand(70).color), '档位自带颜色')
assert.notStrictEqual(A.feasibilityBand(85).color, A.feasibilityBand(20).color, '档位颜色彼此不同')
ok('feasibilityBand: 70/40 boundaries + colors')

// ---------- 2. 可行性取值的容错 ----------
assert.strictEqual(A.clampFeasibility(78), 78)
assert.strictEqual(A.clampFeasibility(78.4), 78, '四舍五入到整数')
assert.strictEqual(A.clampFeasibility(150), 100, '上限夹紧')
assert.strictEqual(A.clampFeasibility(-5), 0, '下限夹紧')
assert.strictEqual(A.clampFeasibility('78%'), 78, '带 % 号的字符串')
assert.strictEqual(A.clampFeasibility('约 78 分'), 78, '夹在文字里的数字')
assert.strictEqual(A.clampFeasibility('0.78'), 78, '0~1 的小数当比例')
assert.strictEqual(A.clampFeasibility('0.78%'), 1, '显式 0.78% 不放大，只四舍五入到 1')
assert.strictEqual(A.clampFeasibility('abc'), 0, '非数字回落 0')
assert.strictEqual(A.clampFeasibility(undefined), 0)
assert.strictEqual(A.clampFeasibility(NaN), 0)
assert.strictEqual(A.clampFeasibility(Infinity), 0)
ok('clampFeasibility tolerates "%" / prose / fraction / junk')

// ---------- 3. 要点列表规范化 ----------
assert.deepStrictEqual(A.normalizeItems(['a', 'b']), ['a', 'b'])
assert.deepStrictEqual(A.normalizeItems('只有一条'), ['只有一条'], '单字符串也接受')
assert.deepStrictEqual(A.normalizeItems(['- 带项目符号', '• 另一种符号', '* 星号']),
  ['带项目符号', '另一种符号', '星号'], '剥掉列表符号')
assert.deepStrictEqual(A.normalizeItems(['  ', '', '有效']), ['有效'], '丢掉空条目')
assert.deepStrictEqual(A.normalizeItems(['a', 'b', 'c', 'd', 'e']).length, A.MAX_ANALYSIS_ITEMS, '限条数')
assert.strictEqual(A.normalizeItems(['x'.repeat(80)])[0].length, A.MAX_ITEM_LENGTH, '限长度')
assert.strictEqual(A.normalizeItems([123, null, { a: 1 }]).length, 0, '非字符串条目直接丢弃')
assert.deepStrictEqual(A.normalizeItems(undefined), [])
ok('normalizeItems: arrays / bullet stripping / caps')

// ---------- 4. 整块评估规范化 ----------
assert.strictEqual(A.normalizeAnalysis(null), null)
assert.strictEqual(A.normalizeAnalysis(undefined), null)
assert.strictEqual(A.normalizeAnalysis('不是对象'), null)
assert.strictEqual(A.normalizeAnalysis({}), null, '四维全空 → null（界面不显示空区块）')
const full = A.normalizeAnalysis({ feasibility: 62, pros: ['p'], cons: ['c'], risks: ['r'] })
assert.deepStrictEqual(full, { feasibility: 62, pros: ['p'], cons: ['c'], risks: ['r'] })
const onlyFeas = A.normalizeAnalysis({ feasibility: 30 })
assert.deepStrictEqual(onlyFeas, { feasibility: 30, pros: [], cons: [], risks: [] })
const onlyPros = A.normalizeAnalysis({ pros: ['只有优点'] })
assert.strictEqual(onlyPros.feasibility, 0, '只有要点时可行性记 0')
ok('normalizeAnalysis: null when effectively empty, normalizes otherwise')

// ---------- 5. hasAnalysis ----------
assert.strictEqual(A.hasAnalysis(null), false)
assert.strictEqual(A.hasAnalysis(undefined), false)
assert.strictEqual(A.hasAnalysis({ feasibility: 0, pros: [], cons: [], risks: [] }), false, '空评估不算"有"')
assert.strictEqual(A.hasAnalysis({ feasibility: 0, pros: ['a'], cons: [], risks: [] }), true)
assert.strictEqual(A.hasAnalysis({ feasibility: 1, pros: [], cons: [], risks: [] }), true)
ok('hasAnalysis gates empty vs non-empty')

// ---------- 6. AI 输出解析 ----------
const structured = JSON.stringify({
  title: '做减法',
  feasibility: 78,
  pros: ['成本低'],
  cons: ['差异化弱'],
  risks: ['流失重度用户'],
  content: '正文第一行\n\n- 要点',
})
const p1 = parseIdeaResponse(structured)
assert.strictEqual(p1.title, '做减法')
assert.strictEqual(p1.analysis.feasibility, 78)
assert.deepStrictEqual(p1.analysis.risks, ['流失重度用户'])
assert.strictEqual(p1.body, '正文第一行\n\n- 要点', '转义换行被还原，正文里不应有 JSON 痕迹')
ok('parse: plain json object')

const p2 = parseIdeaResponse('```json\n' + structured + '\n```')
assert.strictEqual(p2.title, '做减法', '围栏包裹')
assert.strictEqual(p2.body.includes('- 要点'), true)

const p3 = parseIdeaResponse('好的，结果如下：\n' + structured + '\n希望有帮助！')
assert.strictEqual(p3.title, '做减法', '前置寒暄 + 后置寒暄')
assert.strictEqual(p3.body, '正文第一行\n\n- 要点')

// content 里含花括号/双引号：靠括号配对而不是正则，不能被截断
const nested = JSON.stringify({ title: '嵌套', content: 'a {b} c "d" e' })
const p4 = parseIdeaResponse(nested)
assert.strictEqual(p4.title, '嵌套')
assert.strictEqual(p4.body, 'a {b} c "d" e', '字符串内的花括号不参与配对')
// 正文里出现 "}"，且外面裹着寒暄（必须走括号配对，不能被字符串里的 } 提前截断）
const rawBrace = '这是结果：{"title":"T","content":"x } y"} 请查收'
const p9 = parseIdeaResponse(rawBrace)
assert.strictEqual(p9.title, 'T')
assert.strictEqual(p9.body, 'x } y')
ok('parse: fenced / chit-chat / braces inside content')

// 不守契约：普通文本原样当正文，且**不**抛错
const p5 = parseIdeaResponse('## 普通 markdown 回复\n- 甲\n- 乙')
assert.strictEqual(p5.title, undefined)
assert.strictEqual(p5.analysis, undefined)
assert.ok(p5.body.startsWith('## 普通 markdown'))
// JSON 数组 / 无关对象都不该被误吞
assert.strictEqual(parseIdeaResponse('[1,2,3]').title, undefined)
assert.strictEqual(parseIdeaResponse('[1,2,3]').body, '[1,2,3]')
assert.strictEqual(parseIdeaResponse('{"foo":"bar"}').body, '{"foo":"bar"}', '无关 JSON 原样保留')
assert.strictEqual(parseIdeaResponse('').body, '')
ok('parse: non-contract responses pass through untouched')

// 契约命中但 content 缺失 → 不把 JSON 当正文塞进去
const p6 = parseIdeaResponse('{"title":"只有标题","feasibility":50}')
assert.strictEqual(p6.title, '只有标题')
assert.strictEqual(p6.body, '', 'content 缺失时正文留空，而不是塞回 JSON 原文')
ok('parse: structured without content leaves body empty')

// 超长标题被截断
const longTitle = '标'.repeat(80)
const p7 = parseIdeaResponse(JSON.stringify({ title: longTitle, content: 'x' }))
assert.strictEqual(p7.title.length, A.MAX_TITLE_LENGTH)
assert.ok(p7.title.endsWith('…'))
// 空白标题 → undefined（交给上层回落 deriveLabel）
assert.strictEqual(parseIdeaResponse(JSON.stringify({ title: '   ', content: 'x' })).title, undefined)
assert.strictEqual(parseIdeaResponse(JSON.stringify({ title: 123, content: 'x' })).title, undefined)
ok('parse: title length capped / blank / non-string rejected')

// body 别名的兼容
assert.strictEqual(parseIdeaResponse('{"title":"t","body":"用 body 字段"}').body, '用 body 字段')

// ---------- 7. 导出（markdown）带上评估 ----------
const lines = analysisMarkdownLines({ feasibility: 78, pros: ['甲', '乙'], cons: ['丙'], risks: [] })
assert.deepStrictEqual(lines, [
  '**可行性**：78%（高）',
  '**优点**：甲；乙',
  '**缺点**：丙',
], '风险为空时不出这一行')
assert.deepStrictEqual(analysisMarkdownLines(null), [], '无评估 → 不产生空标题')
assert.deepStrictEqual(analysisMarkdownLines({ feasibility: 0, pros: [], cons: [], risks: [] }), [])

const doc = {
  projectName: 'P', exportedAt: '2026-09-20T00:00:00.000Z', scope: 'tree',
  nodes: [
    {
      id: 'n1', label: '结果标题', prompt: '当初的输入', content: '正文', contentType: 'markdown',
      analysis: { feasibility: 78, pros: ['甲'], cons: ['乙'], risks: ['丙'] },
      depth: 0, versionNumber: 1, versionCount: 1,
    },
    {
      id: 'n2', label: '无评估节点', prompt: '', content: '正文2', contentType: 'markdown',
      analysis: null, depth: 0, versionNumber: 0, versionCount: 1,
    },
  ],
}
const md = renderMarkdown(doc)
assert.ok(md.includes('## 结果标题'), '标题用结果标题')
assert.ok(md.includes('> 提示词：当初的输入'), '原始输入仍以提示词形式保留')
assert.ok(md.includes('**可行性**：78%（高）'))
assert.ok(md.includes('**优点**：甲'))
assert.ok(md.includes('**风险**：丙'))
assert.ok(!md.includes('**可行性**：0%'), '没有评估的节点不输出评估区块')
ok('export markdown carries analysis, keeps prompt as side note')

console.log(`\nALL ANALYSIS TESTS PASSED (${passed} checks)`)
