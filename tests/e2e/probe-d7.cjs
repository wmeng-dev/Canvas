// D.7 验证：节点卡片显示"发散结果标题 + 可行性 + 优点/缺点/风险"，原始输入退为次要信息；
// 以及标题/评估随版本变化、翻案能整版回退。
//
// 重点断言两件容易静默出错的事：
//   1. 卡片标题**不是**用户输入的那句话（这是本次需求的核心）；
//   2. 换成自定义节点后 <Handle> 仍在、连线仍渲染 —— 漏掉 Handle 时边会集体消失，
//      但界面看起来"只是没连线"，很容易被忽略。
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-d7-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail !== undefined ? '  → ' + detail : ''))
}
const info = (name, val) => console.log('  · ' + name + ' = ' + JSON.stringify(val))

const { bootstrap } = require(path.join(ROOT, 'dist-electron/main/app'))
bootstrap()

const PROMPT = '把核心体验做减法，只保留一条主线'
// D.9：编辑描述用
const EDIT_PROMPT = '编辑后：只做一件事，砍掉所有分支'
const SAVED_PROMPT = '手动保存的描述（不生成）'

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) { check('bootstrap 建了窗口', false); return finish() }
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(1200)
  const js = (code) => win.webContents.executeJavaScript(code)

  const projectsDir = path.join(dataDir, 'projects')
  const readTree = () => {
    const files = fs.readdirSync(projectsDir)
    return JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf8')).tree
  }
  const nodeByPrompt = (p) => readTree().nodes.find((n) => n.prompt === p)
  const waitFor = async (pred, timeoutMs = 6000) => {
    const t0 = Date.now()
    for (;;) {
      if (await pred()) return true
      if (Date.now() - t0 > timeoutMs) return false
      await sleep(100)
    }
  }
  /** 卡片内部元素（限定在某个节点内查询） */
  const inNode = (id, code) =>
    js(`(() => { const root = document.querySelector('.react-flow__node[data-id="${id}"]'); if (!root) return null; ${code} })()`)

  // ---------- 1. 从根节点发散一个子节点 ----------
  // 先等种子工程落库 + 画布真正渲染出节点，再取坐标；否则 rootId 取不到/元素为 null 会抛。
  if (!(await waitFor(() => {
    try { return fs.existsSync(projectsDir) && fs.readdirSync(projectsDir).length > 0 } catch { return false }
  }, 6000))) { check('种子工程已落库', false); return finish() }
  const rootId = readTree().nodes[0].id
  if (!(await waitFor(async () => (await js('document.querySelectorAll(".react-flow__node").length')) >= 1, 8000))) {
    check('画布渲染出根节点', false); return finish()
  }
  const rootRect = await js(`(() => {
    const el = document.querySelector('.react-flow__node[data-id="${rootId}"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`)
  if (!rootRect) { check('根节点元素可定位', false); return finish() }
  check('画布渲染出根节点', true, JSON.stringify({ rootId, rootRect }))
  await js(`(() => {
    const el = document.querySelector('.react-flow__node[data-id="${rootId}"]');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: ${Math.round(rootRect.left + rootRect.width / 2)}, clientY: ${Math.round(rootRect.top + rootRect.height / 2)} }));
  })()`)
  await sleep(250)
  await js('document.querySelector(\'[data-testid="menu-ideasprout"]\').click()')
  await sleep(250)
  await js(`(() => {
    const el = document.querySelector('[data-testid="prompt-input"]');
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(PROMPT)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await js('document.querySelector(\'[data-testid="submit-generate"]\').click()')
  await waitFor(async () => (await js('document.querySelectorAll(".react-flow__node").length')) === 2)

  const child = nodeByPrompt(PROMPT)
  if (!child) { check('生成了子节点', false); return finish() }
  check('生成了子节点并落库', true, 'label=' + child.label)
  info('磁盘上的子节点', { label: child.label, prompt: child.prompt, feasibility: child.analysis?.feasibility })

  // ---------- 2. 卡片标题 = 结果标题，不是输入 ----------
  // 用 textContent 而不是 innerText 取标题：innerText 依赖布局，
  // 节点刚插入、还没排版完的那一瞬间会返回空串 —— 那是探针时序抖动，不是渲染 bug。
  const readTitle = (id) => inNode(id, 'const t = root.querySelector(\'[data-testid="idea-title"]\'); return t ? t.textContent : null')
  await waitFor(async () => !!(await readTitle(child.id)), 8000)
  const titleText = (await readTitle(child.id)) || ''
  info('卡片标题', titleText)
  info('卡片标题', titleText)
  check('卡片用了自定义节点组件', await inNode(child.id, 'return root.querySelector(\'[data-testid="idea-node"]\') !== null'))
  check('卡片标题就是"发散结果标题"（与落库的 label 一致）', titleText === child.label, JSON.stringify(titleText))
  check('卡片标题不是用户输入的那句话', titleText !== PROMPT, JSON.stringify({ titleText, PROMPT }))
  check('结果标题带得出标题的形状（不是 prompt 派生标签）', /^发散方案 #\d+：/.test(titleText), JSON.stringify(titleText))

  // ---------- 3. 可行性概率（百分比 + 高/中/低色条） ----------
  // ⚠️ 用 textContent 而非 innerText：innerText 依赖布局，节点刚插入、尚未排版的那一帧
  //    会返回空串（本机实测：同一轮里"可行性"读到 ""，而紧随其后的优缺点风险已正常，
  //    即"第一次读太早"）。属性值（data-feasibility/data-band）不受影响，所以只有文本断言会假失败。
  const readFeas = () => inNode(child.id, `return (() => {
    const el = root.querySelector('[data-testid="idea-feasibility"]');
    if (!el) return null;
    return { text: (el.textContent || '').replace(/\\n/g, ' '), value: el.getAttribute('data-feasibility'), band: el.getAttribute('data-band') };
  })()`)
  let feas = null
  await waitFor(async () => !!(feas = await readFeas()) && feas.text.length > 0, 6000)
  info('卡片上的可行性', feas)
  check('卡片显示可行性概率', !!feas && feas.text.includes(`${child.analysis.feasibility}%`), JSON.stringify(feas && feas.text))
  check('可行性数值与落库一致', !!feas && Number(feas.value) === child.analysis.feasibility, JSON.stringify(feas && feas.value))
  check('可行性带高/中/低档位', !!feas && ['high', 'mid', 'low'].includes(feas.band) &&
    /[高中低]/.test(feas.text), JSON.stringify(feas && feas.band))

  // ---------- 4. 优点 / 缺点 / 风险 ----------
  for (const [key, label] of [['pros', '优点'], ['cons', '缺点'], ['risks', '风险']]) {
    const readRow = () => inNode(child.id, `return (() => {
      const el = root.querySelector('[data-testid="idea-${key}"]');
      return el ? { text: (el.textContent || '').replace(/\\n/g, ' '), count: Number(el.getAttribute('data-count')) } : null;
    })()`)
    let row = null
    await waitFor(async () => !!(row = await readRow()) && row.text.length > 0, 6000)
    info('卡片上的 ' + label, row)
    check(`卡片显示「${label}」且条数与落库一致`,
      !!row && row.count === child.analysis[key].length, JSON.stringify(row))
    check(`「${label}」首条内容可见`, !!row && row.text.includes(child.analysis[key][0]), JSON.stringify(row && row.text))
    // 改版后卡片展示**全部**条目（对比用），不再"只显示首条 + 等N条"：
    // 这条同时断言"旧截断行为已不再成立"（末条也可见）。
    const lastItem = child.analysis[key][child.analysis[key].length - 1]
    check(`「${label}」末条内容也可见（不再只显示首条）`, !!row && row.text.includes(lastItem), JSON.stringify(row && row.text))
  }
  check('卡片标记了"有评估"',
    (await inNode(child.id, 'return root.querySelector(\'[data-testid="idea-node"]\').getAttribute("data-has-analysis")')) === '1')

  // ---------- 5. 原始描述退为次要信息（悬停可见） ----------
  const tip = await inNode(child.id, 'return root.querySelector(\'[data-testid="idea-node"]\').getAttribute("title")')
  check('卡片的悬停提示里能看到原始描述', typeof tip === 'string' && tip.includes(PROMPT), JSON.stringify(tip))

  // ---------- 6. Handle / 连线没被自定义节点弄丢 ----------
  const handles = await inNode(child.id, `return {
    total: root.querySelectorAll('.react-flow__handle').length,
    target: root.querySelectorAll('.react-flow__handle-left, .react-flow__handle-top').length,
    source: root.querySelectorAll('.react-flow__handle-right, .react-flow__handle-bottom').length,
  }`)
  info('卡片上的 Handle', handles)
  check('卡片保留了 target + source 两个 Handle', handles.total === 2 && handles.target === 1 && handles.source === 1,
    JSON.stringify(handles))
  // ⚠️ 边是异步渲染的，谓词必须就是断言值本身（waitFor(===1)），超时才失败并 dump 现场。
  //    **不要在这里做任何"补救"**：D.6 记录的那个偶发竞态（store/磁盘/handle 都在，但 React Flow
  //    那一帧没把边画出来）已在 CreativeTree 的兜底重测里修掉（见该文件注释）。
  //    所以本断言必须如实反映结果 —— 一旦不渲染就是 bug 复发，不能靠点击节点把边"救"回来
  //    再判成功，否则这条断言就永远绿、失去报警能力。
  const edgeCount = () => js('document.querySelectorAll(".react-flow__edge").length')
  const edgesOk = await waitFor(async () => (await edgeCount()) === 1, 8000)
  if (!edgesOk) {
    // ---- 失败现场取证：只取证、不改判（该 bug 曾经只在约 15% 轮次出现，现场信息要一次抓全）----
    const snap = await js(`(() => {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
      const hs = (n) => Array.from(n.querySelectorAll('.react-flow__handle')).map((h) => {
        const r = h.getBoundingClientRect(); return h.className.replace('react-flow__handle ','') + ':' + Math.round(r.width) + 'x' + Math.round(r.height);
      });
      const svg = document.querySelector('.react-flow__edges');
      const vp = document.querySelector('.react-flow__viewport');
      return {
        nodes: nodes.map((n) => ({ id: (n.getAttribute('data-id')||'').slice(0,8), hs: hs(n),
          rect: (() => { const r = n.getBoundingClientRect(); return Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height) })() })),
        edgeEls: document.querySelectorAll('.react-flow__edge').length,
        edgeSvgChildren: svg ? svg.children.length : -1,
        viewport: vp ? (vp.getAttribute('style')||'').replace(/\\s+/g,' ') : null,
      };
    })()`)
    console.log('  DUMP ' + JSON.stringify(snap))
  }
  const edges = await edgeCount()
  check('连线仍然渲染出来（Handle 没漏）', edgesOk, 'edges=' + edges + (edgesOk ? '' : ' (dump 见上方 DUMP 行)'))

  // ---------- 7. 预览面板：完整版评估 + 原始描述 ----------
  await js(`(() => {
    const el = document.querySelector('.react-flow__node[data-id="${child.id}"]');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  })()`)
  await sleep(400)
  const panel = await js(`(() => {
    const p = document.querySelector('[data-testid="preview-analysis"]');
    const prompt = document.querySelector('[data-testid="preview-prompt"]');
    const heading = document.querySelector('aside').innerText.split('\\n')[1] || '';
    return {
      heading,
      hasAnalysis: !!p,
      feasibility: p ? p.getAttribute('data-feasibility') : null,
      pct: p ? (p.querySelector('[data-testid="preview-feasibility"]') || {}).innerText : null,
      counts: ['pros', 'cons', 'risks'].map((k) => {
        const el = p && p.querySelector('[data-testid="preview-' + k + '"]');
        return el ? Number(el.getAttribute('data-count')) : -1;
      }),
      promptText: prompt ? prompt.innerText : null,
    };
  })()`)
  info('预览面板', panel)
  check('预览面板标题也是结果标题', panel.heading.includes(child.label.slice(0, 8)), JSON.stringify(panel.heading))
  check('预览面板有完整版评估区块', panel.hasAnalysis && panel.pct === `${child.analysis.feasibility}%`,
    JSON.stringify({ hasAnalysis: panel.hasAnalysis, pct: panel.pct }))
  check('预览面板三组要点条数与落库一致',
    JSON.stringify(panel.counts) === JSON.stringify([child.analysis.pros, child.analysis.cons, child.analysis.risks].map((a) => a.length)),
    JSON.stringify(panel.counts))
  check('预览面板把原始描述作为次要信息显示',
    typeof panel.promptText === 'string' && panel.promptText.includes(PROMPT), JSON.stringify(panel.promptText))

  // ---------- 8. D.9「重新生成」= 先进编辑态（编辑描述），再选生成/不生成 ----------
  // 关键回归点：点「重新生成」**不再直接产出结果**，而是把描述变成输入框；
  // 不校验这一点的话，"直接生成"的老行为会静默通过（因为最终版本数一样）。
  await js('document.querySelector(\'[data-testid="regenerate-node"]\').click()')
  await sleep(300)
  const entered = await js(`(() => {
    const box = document.querySelector('[data-testid="preview-prompt"]');
    const ta = document.querySelector('[data-testid="prompt-editor"]');
    return {
      editingAttr: box ? box.getAttribute('data-editing') : null,
      hasEditor: !!ta,
      editorValue: ta ? ta.value : null,
      hasEnterBtn: !!document.querySelector('[data-testid="regenerate-node"]'),
      hasConfirm: !!document.querySelector('[data-testid="confirm-regenerate"]'),
      hasSave: !!document.querySelector('[data-testid="save-prompt"]'),
      hasCancel: !!document.querySelector('[data-testid="cancel-edit"]'),
    };
  })()`)
  info('点「重新生成」后', entered)
  check('点「重新生成」只进入编辑态，不直接生成',
    entered.editingAttr === '1' && entered.hasEditor && !entered.hasEnterBtn, JSON.stringify(entered))
  check('编辑态草稿预填当前描述', entered.editorValue === PROMPT, JSON.stringify(entered.editorValue))
  check('编辑态提供「重新生成 / 保存（不生成）/ 取消」三个动作',
    entered.hasConfirm && entered.hasSave && entered.hasCancel, JSON.stringify(entered))
  const versionsWhileEditing = readTree().nodes.find((x) => x.id === child.id).versions.length
  check('只进编辑态不产生新版本', versionsWhileEditing === 1, 'versions=' + versionsWhileEditing)

  // 8b.「取消」→ 丢弃改动回到只读，不落库
  await js('document.querySelector(\'[data-testid="cancel-edit"]\').click()')
  await sleep(250)
  const afterCancel = await js(`(() => ({
    editing: document.querySelector('[data-testid="preview-prompt"]').getAttribute('data-editing'),
    editor: !!document.querySelector('[data-testid="prompt-editor"]'),
    back: !!document.querySelector('[data-testid="regenerate-node"]'),
  }))()`)
  const afterCancelNode = readTree().nodes.find((x) => x.id === child.id)
  check('「取消」回到只读展示', afterCancel.editing === '0' && !afterCancel.editor && afterCancel.back,
    JSON.stringify(afterCancel))
  check('「取消」不改描述、不加版本',
    afterCancelNode.prompt === PROMPT && afterCancelNode.versions.length === 1,
    JSON.stringify({ prompt: afterCancelNode.prompt, versions: afterCancelNode.versions.length }))

  // 8c. 编辑描述后「重新生成」→ 新描述随新版本一起落库，内容按新描述生成
  const setEditor = (text) => js(`(() => {
    const ta = document.querySelector('[data-testid="prompt-editor"]');
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await js('document.querySelector(\'[data-testid="regenerate-node"]\').click()')
  await sleep(250)
  await setEditor(EDIT_PROMPT)
  await js('document.querySelector(\'[data-testid="confirm-regenerate"]\').click()')
  await waitFor(async () => {
    const n = readTree().nodes.find((x) => x.id === child.id)
    return n && n.versions.length === 2
  }, 8000)
  await sleep(300)
  const v2 = readTree().nodes.find((x) => x.id === child.id)
  await waitFor(async () => (await readTitle(child.id)) === v2.label, 6000)
  const title2 = (await readTitle(child.id)) || ''
  info('编辑描述后重新生成', { label: v2.label, prompt: v2.prompt, versions: v2.versions.length, feasibility: v2.analysis?.feasibility })
  check('编辑描述后重新生成 → 追加 v2', v2.versions.length === 2)
  check('新描述落到节点上（编辑生效）', v2.prompt === EDIT_PROMPT, JSON.stringify(v2.prompt))
  check('新版本记录了编辑后的描述', v2.versions[1].prompt === EDIT_PROMPT, JSON.stringify(v2.versions[1].prompt))
  check('内容确实是拿新描述生成的', typeof v2.content === 'string' && v2.content.includes(EDIT_PROMPT))
  check('v1 的描述原样保留', v2.versions[0].prompt === PROMPT, JSON.stringify(v2.versions[0].prompt))
  check('重新生成后节点标题跟着换版', title2 === v2.label && v2.label !== child.label,
    JSON.stringify({ before: child.label, after: v2.label }))
  check('重新生成后可行性也跟着换版', v2.analysis.feasibility !== child.analysis.feasibility,
    JSON.stringify({ before: child.analysis.feasibility, after: v2.analysis.feasibility }))
  check('v1 的标题与评估完整保留（没被覆盖）',
    v2.versions[0].title === child.label &&
      v2.versions[0].analysis.feasibility === child.analysis.feasibility,
    JSON.stringify({ v1Title: v2.versions[0].title, v1Feas: v2.versions[0].analysis.feasibility }))
  check('生成成功后自动退出编辑态',
    !(await js('!!document.querySelector(\'[data-testid=\"prompt-editor\"]\')')))

  // ---------- 9. 翻案回 v1 → 标题 / 评估 / 描述整版一起回退 ----------
  await js('document.querySelector(\'[data-testid="version-revert"][data-version="1"]\').click()')
  await waitFor(async () => {
    const n = readTree().nodes.find((x) => x.id === child.id)
    return n && n.currentVersionId === n.versions[0].id
  }, 6000)
  await sleep(300)
  const back = readTree().nodes.find((x) => x.id === child.id)
  await waitFor(async () => (await readTitle(child.id)) === child.label, 6000)
  const titleBack = (await readTitle(child.id)) || ''
  const feasBack = await inNode(child.id, 'return Number(root.querySelector(\'[data-testid="idea-feasibility"]\').getAttribute("data-feasibility"))')
  const promptBack = await js(`(() => {
    const el = document.querySelector('[data-testid="preview-prompt"]');
    return el ? (el.textContent || '') : null;
  })()`)
  info('翻案回 v1 后', { label: back.label, prompt: back.prompt, feasibility: back.analysis?.feasibility, titleBack, feasBack })
  check('翻案后标题回退到 v1 的标题', titleBack === child.label && back.label === child.label,
    JSON.stringify({ expected: child.label, card: titleBack, disk: back.label }))
  check('翻案后可行性同步回退（不出现"正文 v1、评估 v2"错位）',
    feasBack === child.analysis.feasibility, JSON.stringify({ expected: child.analysis.feasibility, card: feasBack }))
  check('翻案后描述也回退到 v1 的描述（不出现"内容 v1、描述 v2"错位）',
    back.prompt === PROMPT && typeof promptBack === 'string' && promptBack.includes(PROMPT),
    JSON.stringify({ disk: back.prompt, panel: promptBack }))
  check('版本一个都没少', back.versions.length === 2, 'versions=' + back.versions.length)

  // ---------- 10. D.9「保存（不生成）」→ 只改描述，不加版本、内容不变 ----------
  const contentBeforeSave = back.content
  await js('document.querySelector(\'[data-testid="regenerate-node"]\').click()')
  await sleep(250)
  await setEditor(SAVED_PROMPT)
  await js('document.querySelector(\'[data-testid="save-prompt"]\').click()')
  await waitFor(async () => readTree().nodes.find((x) => x.id === child.id).prompt === SAVED_PROMPT, 6000)
  await sleep(250)
  const savedNode = readTree().nodes.find((x) => x.id === child.id)
  info('保存（不生成）后', { prompt: savedNode.prompt, versions: savedNode.versions.length, contentType: savedNode.contentType })
  check('「保存（不生成）」只改描述', savedNode.prompt === SAVED_PROMPT, JSON.stringify(savedNode.prompt))
  check('「保存（不生成）」不追加版本', savedNode.versions.length === 2, 'versions=' + savedNode.versions.length)
  check('「保存（不生成）」内容与类型都不变',
    savedNode.content === contentBeforeSave && savedNode.contentType === back.contentType)
  check('保存成功后退出编辑态',
    !(await js('!!document.querySelector(\'[data-testid=\"prompt-editor"]\')')))

  // ---------- 11. 右键菜单的「重新生成」也进编辑态（两处入口共用同一状态） ----------
  const childRect = await inNode(child.id, 'const r = root.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }')
  await js(`(() => {
    const el = document.querySelector('.react-flow__node[data-id="${child.id}"]');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: ${Math.round(childRect.left + childRect.width / 2)}, clientY: ${Math.round(childRect.top + childRect.height / 2)} }));
  })()`)
  await sleep(250)
  const menuLabel = await js('document.querySelector(\'[data-testid="menu-regenerate"]\').innerText')
  await js('document.querySelector(\'[data-testid="menu-regenerate"]\').click()')
  await sleep(300)
  const menuEntered = await js(`(() => ({
    menuOpen: !!document.querySelector('[data-testid="node-context-menu"]'),
    editing: document.querySelector('[data-testid="preview-prompt"]').getAttribute('data-editing'),
    editor: !!document.querySelector('[data-testid="prompt-editor"]'),
  }))()`)
  info('右键菜单进编辑态', { menuLabel, ...menuEntered })
  check('右键菜单文案表明是"编辑描述"而非直接生成', /编辑描述/.test(menuLabel || ''), JSON.stringify(menuLabel))
  check('右键菜单的「重新生成」也进编辑态（并关掉菜单）',
    menuEntered.editing === '1' && menuEntered.editor && !menuEntered.menuOpen, JSON.stringify(menuEntered))
  // 收尾：取消编辑，避免影响截图
  await js('document.querySelector(\'[data-testid="cancel-edit"]\').click()')
  await sleep(200)

  // ---------- 12. 截图留档 ----------
  const rect = await inNode(child.id, 'const r = root.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }')
  const pad = 14
  const img = await win.webContents.capturePage({
    x: Math.max(0, Math.round(rect.x - pad)),
    y: Math.max(0, Math.round(rect.y - pad)),
    width: Math.round(rect.width + pad * 2),
    height: Math.round(rect.height + pad * 2),
  })
  fs.writeFileSync(path.join(ROOT, 'ui-15-idea-node.png'), img.toPNG())
  console.log('  screenshot written: ui-15-idea-node.png')
  const full = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'ui-15-idea-node-full.png'), full.toPNG())
  console.log('  screenshot written: ui-15-idea-node-full.png')
  check('卡片截图已生成且尺寸合理', img.getSize().width > 100 && img.getSize().height > 60, JSON.stringify(img.getSize()))

  finish()
}

let done = false
function finish() {
  if (done) return
  done = true
  const passed = results.filter(Boolean).length
  // 零断言 = 探针在跑起来之前就挂了，绝不能算绿（否则误报为 OK 0/0）。
  const allGreen = results.length > 0 && passed === results.length
  console.log('\nCHROME_E2E ' + (allGreen ? 'OK' : 'FAIL') + ' (' + passed + '/' + results.length + ')')
  app.exit(allGreen ? 0 : 1)
}

app.on('window-all-closed', () => {})
app.whenReady().then(() =>
  main().catch((e) => { console.error('PROBE ERROR:', (e && e.stack) || e); finish() }),
)
