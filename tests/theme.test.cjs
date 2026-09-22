// 画布主题（新建画布时的顶层节点标题）：提示词构造 / 模型输出清洗 / AI 生成。
// 只测 core 层（不依赖 Electron）。
//
// ⚠️ 这是 .cjs（CommonJS），**不能用顶层 await** —— 异步部分包在 main() 里。
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const {
  cleanTheme,
  buildThemePrompt,
  suggestTheme,
  THEME_MAX_LEN,
} = require('../dist-test/core/theme')
const { createServices, createProject, ensureProject, ensureThemeRoot } = require('../dist-test/core/services')
const { plaintextSecretBox } = require('../dist-test/core/settings-store')

let passed = 0
function ok(name) {
  passed++
  console.log('  ✓', name)
}

function makeSvc(fakeGenerator) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-theme-'))
  return createServices({ dataDir, secrets: plaintextSecretBox(), fakeGenerator })
}

async function main() {
  // ---------------- 1. 提示词 ----------------
  console.log('\n[1] buildThemePrompt：把"只输出一句短主题"写死进约束')
  const withHint = buildThemePrompt('  无人农场  ')
  assert.ok(withHint.includes('无人农场'), '参考方向要被带进去')
  ok('用户给的参考方向进入提示词')
  assert.ok(withHint.includes(`不超过 ${THEME_MAX_LEN} 个字`))
  ok('长度约束写进提示词（模型不看这条就会吐一整段话）')
  assert.ok(/不要引号/.test(withHint) && /不要序号/.test(withHint) && /Markdown/.test(withHint))
  ok('明确禁止引号 / 序号 / Markdown 这类包装')
  assert.ok(!buildThemePrompt().includes('参考方向'))
  ok('不给参考方向时不出现"参考方向："（换成"方向不限"）')
  assert.ok(buildThemePrompt('   ').includes('方向不限'))
  ok('只给空白等于没给')

  // ---------------- 2. 清洗模型输出 ----------------
  console.log('\n[2] cleanTheme：模型常见的"不听话"都要洗掉')
  assert.strictEqual(cleanTheme('  宠物社交  '), '宠物社交')
  ok('去掉首尾空白')
  assert.strictEqual(cleanTheme('主题：宠物社交'), '宠物社交')
  ok('去掉"主题："前缀')
  assert.strictEqual(cleanTheme('## 宠物社交'), '宠物社交')
  ok('去掉 Markdown 标题符号')
  assert.strictEqual(cleanTheme('1. 宠物社交'), '宠物社交')
  ok('去掉序号')
  assert.strictEqual(cleanTheme('- 宠物社交'), '宠物社交')
  ok('去掉列表符号')
  assert.strictEqual(cleanTheme('**宠物社交**'), '宠物社交')
  ok('去掉加粗标记')
  assert.strictEqual(cleanTheme('「宠物社交」'), '宠物社交')
  ok('去掉中文引号类符号')
  assert.strictEqual(cleanTheme('好的，以下是为您构思的主题：\n宠物社交\n\n理由：因为…'), '宠物社交')
  ok('跳过"…主题："引子行，取真正的那句')
  assert.strictEqual(cleanTheme('  第一行\n第二行  '), '第一行')
  ok('多行只取一行（换行会撑破卡片标题）')
  assert.strictEqual(cleanTheme('宠物  社交\t方向'), '宠物 社交 方向')
  ok('把连续空白折成单个空格')

  const cut = cleanTheme('一'.repeat(THEME_MAX_LEN + 10))
  assert.strictEqual(cut.length, THEME_MAX_LEN + 1, '截断后长度 = 上限 + 省略号')
  assert.ok(cut.endsWith('…'))
  ok(`超长主题截断到 ${THEME_MAX_LEN} 字并加省略号`)

  assert.strictEqual(cleanTheme(''), '')
  ok('空输入返回空串（调用方据此提示用户手写）')
  assert.strictEqual(cleanTheme('   \n\t\n  '), '')
  ok('只有空白也返回空串')
  assert.strictEqual(cleanTheme('主题：'), '')
  ok('洗完之后什么都没剩也返回空串')

  // ---------------- 3. AI 生成（占位生成器） ----------------
  console.log('\n[3] suggestTheme：借默认生成器产出主题')
  const svc = makeSvc(true)
  const theme = await suggestTheme(svc)
  assert.ok(typeof theme === 'string' && theme.length > 0)
  ok('占位生成器下也能产出主题（开发 / 探针无网可用）')
  assert.ok(/^占位主题 #\d+$/.test(theme), `实际：${theme}`)
  ok('占位器返回确定性的短主题（便于探针断言）')
  assert.strictEqual(cleanTheme(theme), theme)
  ok('生成结果本身已是干净的（调用方不必再洗一遍）')

  const theme2 = await suggestTheme(svc, '无人农场')
  assert.notStrictEqual(theme2, theme)
  ok('再次生成得到不同主题（占位器带序号，模拟"每次不一样"）')

  // ---------------- 4. 没有可用 AI 后端 ----------------
  console.log('\n[4] 没有任何 AI 后端时的报错文案')
  const bare = makeSvc(false)
  assert.strictEqual(bare.registry.list().length, 0)
  ok('未注册任何生成器时为 0 个可用后端')
  await assert.rejects(() => suggestTheme(bare), /AI 后端/)
  ok('抛的是给用户看的话，而不是内部文案 generator not found')

  // ---------------- 5. 顶层主题节点（发散的默认父节点） ----------------
  console.log('\n[5] ensureThemeRoot：画布的顶层主题节点')
  const svc5 = makeSvc(true)
  const guide = ensureProject(svc5)
  const root1 = ensureThemeRoot(svc5, guide.project.id)
  assert.strictEqual(root1.id, guide.tree.nodes[0].id)
  ok('画布已有顶层节点时直接返回它（不重复建）')

  const again = ensureThemeRoot(svc5, guide.project.id, '别的主题')
  assert.strictEqual(again.id, root1.id)
  assert.strictEqual(again.label, '创意主题')
  ok('已有顶层节点时不因传入主题而改名（不动既有数据）')

  const blank = createProject(svc5)
  assert.strictEqual(blank.tree.nodes.length, 0)
  ok('新建画布仍是空白（顶层节点留到发散时按需立起）')

  const made = ensureThemeRoot(svc5, blank.project.id, '  无人农场调度  ')
  assert.strictEqual(made.label, '无人农场调度')
  ok('空白画布按主题立出顶层节点（主题 trim 后当标题）')
  assert.strictEqual(made.prompt, '无人农场调度')
  ok('主题同时写进 prompt（发散时父上下文非空）')
  assert.strictEqual(made.parentId, null)
  ok('它是顶层节点（parentId 为 null）')

  const persisted = svc5.repo.get(blank.project.id)
  assert.strictEqual(persisted.tree.nodes.length, 1)
  assert.strictEqual(persisted.tree.nodes[0].id, made.id)
  ok('主题节点已落盘')

  const secondCall = ensureThemeRoot(svc5, blank.project.id)
  assert.strictEqual(secondCall.id, made.id)
  ok('再次调用是幂等的（不会建出第二个顶层节点）')

  const blank2 = createProject(svc5)
  assert.strictEqual(ensureThemeRoot(svc5, blank2.project.id).label, '创意主题')
  ok('不给主题时用「创意主题」默认名')

  // 老画布可能残留多个根节点（空白期留下的历史数据）
  const multi = createProject(svc5)
  svc5.repo.addNode(multi.project.id, { label: '第一个根', prompt: '', status: 'empty' })
  svc5.repo.addNode(multi.project.id, { label: '第二个根', prompt: '', status: 'empty' })
  const picked = ensureThemeRoot(svc5, multi.project.id)
  assert.strictEqual(picked.label, '第一个根')
  assert.strictEqual(svc5.repo.get(multi.project.id).tree.nodes.length, 2)
  ok('多根的历史画布：取第一个，且不替用户删数据')

  console.log(`\nTHEME_TESTS OK (${passed})`)
}

main().catch((e) => {
  console.error('THEME_TESTS FAIL:', e && e.stack ? e.stack : e)
  process.exit(1)
})
