// 缩略图（MiniMap）「快速定位」验证探针。
// 起因：@xyflow/react v12 的 <MiniMap> 把 pannable/zoomable 默认写死成 false，缩略图变成死的。
// 断言：尺寸正确、画出节点、真实鼠标【拖拽能平移】、【单击能定位】、【拖拽结束不会被补发的 click 再跳一次】。
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-mm-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 轮询等待（React Flow 量尺寸是 ResizeObserver 异步的，固定 sleep 会偶发太早）。 */
async function waitFor(pred, timeoutMs = 8000) {
  const t0 = Date.now()
  for (;;) {
    if (await pred()) return Date.now() - t0
    if (Date.now() - t0 > timeoutMs) return -1
    await sleep(100)
  }
}
const results = []
const check = (name, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail !== undefined ? '  → ' + detail : ''))
}
const info = (name, val) => console.log('  · ' + name + ' = ' + JSON.stringify(val))

const { bootstrap } = require(path.join(ROOT, 'dist-electron/main/app'))
bootstrap()

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) { check('bootstrap 建了窗口', false); return finish() }
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(1000)

  const js = (code) => win.webContents.executeJavaScript(code)
  const send = (type, x, y, clickCount = 0, deltaY) =>
    win.webContents.sendInputEvent(
      deltaY === undefined
        ? { type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount }
        : { type, x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY },
    )

  // ---- 造点内容，让缩略图有东西可画 ----
  await js(`document.querySelector('[data-testid="new-idea"]').click()`)
  await sleep(250)
  await js(`(() => {
    const sel = document.querySelector('[data-testid="count-select"]');
    if (sel) { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(sel,'3');
               sel.dispatchEvent(new Event('change',{bubbles:true})); }
    const ta = document.querySelector('[data-testid="prompt-input"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta, '缩略图定位验证：铺开三条方向');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await js(`document.querySelector('[data-testid="submit-generate"]').click()`)
  await sleep(900)

  // 等画布"真正就绪"：React Flow 必须先用 ResizeObserver 量到节点尺寸，
  // 才会算出 boundingRect（缩略图才有节点可画）并让 fitView 生效。
  const readyMs = await waitFor(async () => {
    const mm = await js('document.querySelectorAll(".react-flow__minimap-node").length')
    const tf = await js("(() => { const v = document.querySelector('.react-flow__viewport'); return v ? getComputedStyle(v).transform : ''; })()")
    return mm > 0 && tf && tf !== 'matrix(1, 0, 0, 1, 0, 0)'
  }, 10000)
  info('画布就绪耗时(ms)', readyMs)
  check('画布能在超时内就绪（缩略图有节点 + fitView 生效）', readyMs >= 0, readyMs < 0 ? '超时未就绪' : `${readyMs}ms`)

  const flowNodes = await js('document.querySelectorAll(".react-flow__node").length')
  info('画布节点数', flowNodes)

  // ---- 1. 几何 / 可见性 / 遮挡 ----
  const geo = await js(`(() => {
    const el = document.querySelector('.react-flow__minimap');
    const flow = document.querySelector('.react-flow').getBoundingClientRect();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x:r.x, y:r.y, w:r.width, h:r.height, display:cs.display, visibility:cs.visibility,
             opacity:cs.opacity, flowTop:flow.top, flowLeft:flow.left, flowW:flow.width, flowH:flow.height,
             right:Math.round(r.right), bottom:Math.round(r.bottom),
             flowRight:Math.round(flow.left+flow.width), flowBottom:Math.round(flow.top+flow.height) };
  })()`)
  info('minimap 几何', geo)
  check('minimap 有非零尺寸且可见', !!geo && geo.w > 0 && geo.h > 0 && geo.display !== 'none' && geo.visibility !== 'hidden' && geo.opacity !== '0',
    geo ? `${geo.w}x${geo.h}` : 'missing')
  // 注意：要和容器的【右下角坐标】比，不是和宽高比（上一版探针就在这里写错了）
  check('minimap 贴在画布容器右下角内', !!geo && geo.right <= geo.flowRight + 2 && geo.bottom <= geo.flowBottom + 2,
    geo ? `right=${geo.right}/${geo.flowRight} bottom=${geo.bottom}/${geo.flowBottom}` : '')

  const cx = geo.x + geo.w / 2
  const cy = geo.y + geo.h / 2
  const topEl = await js(`(() => { const e = document.elementFromPoint(${Math.round(cx)}, ${Math.round(cy)});
    return e ? (e.getAttribute && e.getAttribute('class')) || e.tagName : null; })()`)
  check('minimap 中心未被遮挡', typeof topEl === 'string' && String(topEl).includes('minimap'), String(topEl))

  const mmNodes = await js('document.querySelectorAll(".react-flow__minimap-node").length')
  check('缩略图确实画出了节点', mmNodes > 0, `${mmNodes}/${flowNodes}`)

  // ---- 工具：读视口 transform / 换算"当前流坐标中心" ----
  const mat = async () =>
    js(`(() => { const v = document.querySelector('.react-flow__viewport');
      return v ? getComputedStyle(v).transform : null; })()`)
  const centerOf = async () => {
    const [a, , , d, e, f] = String(await mat()).match(/-?[\d.]+/g).map(Number)
    const [fw, fh] = await js(`(() => { const r = document.querySelector('.react-flow').getBoundingClientRect(); return [r.width, r.height]; })()`)
    return { x: (fw / 2 - e) / a, y: (fh / 2 - f) / d, scale: a }
  }
  /** 缩略图局部比例坐标 (0~1) → 该点的客户端坐标；同时按 viewBox 算出它对应的流坐标 */
  const mmPoint = async (rx, ry) => {
    const r = await js(`(() => { const s = document.querySelector('.react-flow__minimap-svg'); const b = s.getBoundingClientRect();
      const vb = (s.getAttribute('viewBox')||'').split(/[\\s,]+/).map(Number);
      return { left:b.left, top:b.top, w:b.width, h:b.height, vb }; })()`)
    return {
      clientX: r.left + r.w * rx,
      clientY: r.top + r.h * ry,
      flowX: r.vb[0] + r.vb[2] * rx,
      flowY: r.vb[1] + r.vb[3] * ry,
    }
  }

  // ---- 2. 真实鼠标【拖拽】缩略图 → 视口应平移 ----
  const t0 = await mat()
  const p0 = await mmPoint(0.5, 0.5)
  send('mouseMove', p0.clientX, p0.clientY)
  send('mouseDown', p0.clientX, p0.clientY, 1)
  for (let i = 1; i <= 8; i++) {
    send('mouseMove', p0.clientX - (i * 60) / 8, p0.clientY - (i * 40) / 8)
    await sleep(30)
  }
  const tDuring = await mat()
  check('拖拽缩略图 → 视口发生平移', t0 !== tDuring, `${String(t0).slice(0, 34)} -> ${String(tDuring).slice(0, 34)}`)

  // ---- 3. 拖拽结束不应再被"补发的 click"强制跳一次 ----
  send('mouseUp', p0.clientX - 60, p0.clientY - 40, 1)
  await sleep(400)
  const tAfter = await mat()
  check('拖拽结束后没有额外跳转（click 被正确抑制）', tDuring === tAfter,
    `${String(tDuring).slice(0, 34)} -> ${String(tAfter).slice(0, 34)}`)

  // ---- 4. 纯【单击】缩略图 → 视口中心应移到该处（方向性断言） ----
  const tl = await mmPoint(0.15, 0.15)
  send('mouseMove', tl.clientX, tl.clientY)
  send('mouseDown', tl.clientX, tl.clientY, 1)
  send('mouseUp', tl.clientX, tl.clientY, 1)
  await sleep(500)
  const c1 = await centerOf()
  info('点左上后视口中心(流坐标)', c1)

  const br = await mmPoint(0.85, 0.85)
  send('mouseMove', br.clientX, br.clientY)
  send('mouseDown', br.clientX, br.clientY, 1)
  send('mouseUp', br.clientX, br.clientY, 1)
  await sleep(500)
  const c2 = await centerOf()
  info('点右下后视口中心(流坐标)', c2)

  check('单击缩略图能定位：中心随点击点方向移动（右下 → x,y 都变大）',
    c2.x > c1.x + 1 && c2.y > c1.y + 1,
    `(${Math.round(c1.x)},${Math.round(c1.y)}) -> (${Math.round(c2.x)},${Math.round(c2.y)})`)
  check('定位精度：落点与点击处流坐标接近（< 40px）',
    Math.abs(c2.x - br.flowX) < 40 && Math.abs(c2.y - br.flowY) < 40,
    `落点(${Math.round(c2.x)},${Math.round(c2.y)}) vs 目标(${Math.round(br.flowX)},${Math.round(br.flowY)})`)

  // ---- 5. 滚轮缩放（zoomable） ----
  const before = (await centerOf()).scale
  const mid = await mmPoint(0.5, 0.5)
  send('mouseMove', mid.clientX, mid.clientY)
  for (let i = 0; i < 3; i++) { send('mouseWheel', mid.clientX, mid.clientY, 0, -120); await sleep(60) }
  await sleep(400)
  const after = (await centerOf()).scale
  check('滚轮在缩略图上可缩放（zoomable）', Math.abs(after - before) > 1e-6, `scale ${before.toFixed(4)} -> ${after.toFixed(4)}`)

  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'ui-11-minimap.png'), img.toPNG())
  console.log('  screenshot written: ui-11-minimap.png')
  finish()
}

let done = false
function finish() {
  if (done) return
  done = true
  const passed = results.filter(Boolean).length
  console.log('\nMINIMAP_E2E ' + (passed === results.length ? 'OK' : 'FAIL') + ' (' + passed + '/' + results.length + ')')
  app.exit(passed === results.length ? 0 : 1)
}

app.on('window-all-closed', () => {})
app.whenReady().then(() =>
  main().catch((e) => { console.error('PROBE ERROR:', (e && e.stack) || e); finish() }),
)
