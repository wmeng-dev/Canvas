// D.6 画布缩放控件（.react-flow__controls）深色主题可读性验证。
// 背景：@xyflow 默认按钮底色 #fefefe、图标色 color:inherit → 继承 body 的浅色 #e6edf3，
//       浅字压浅底 → 对比度≈1.05，「放大/缩小/fitView/锁定」四个图标几乎看不见。
// 这里用「算对比度」而不是「看有没有这个元素」来判定，避免视觉回归。
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-ctl-'))
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

// 页面内：解析 "rgb(a)" → 相对亮度；给出两色 WCAG 对比度。
const PAGE_HELPERS = `
  const parseColor = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => {
    // 前景半透明时先与背景合成，否则对比度算不准（:disabled 的 fill-opacity 就走这条）
    const a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
`

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) { check('bootstrap 建了窗口', false); return finish() }
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(1200)

  const js = (code) => win.webContents.executeJavaScript(code)

  // 1) 四个按钮都在（放大 / 缩小 / 适配 / 锁定）—— 先确认控件没被误删
  const present = await js(`(() => ({
    total: document.querySelectorAll('.react-flow__controls-button').length,
    zoomin: !!document.querySelector('.react-flow__controls-zoomin'),
    zoomout: !!document.querySelector('.react-flow__controls-zoomout'),
    fitview: !!document.querySelector('.react-flow__controls-fitview'),
    lock: !!document.querySelector('.react-flow__controls-interactive'),
  }))()`)
  info('控件按钮', present)
  check('四个控件按钮齐全（放大/缩小/fitView/锁定）',
    present.total === 4 && present.zoomin && present.zoomout && present.fitview && present.lock,
    JSON.stringify(present))

  // 2) 逐个量：图标填充色 vs 按钮底色 的对比度；按钮底色 vs 画布底色 的可见度
  const measured = await js(`(() => {
    ${PAGE_HELPERS}
    const canvasBg = parseColor(getComputedStyle(document.body).backgroundColor);
    const out = [];
    for (const cls of ['zoomin', 'zoomout', 'fitview', 'interactive']) {
      const btn = document.querySelector('.react-flow__controls-' + cls);
      if (!btn) { out.push({ cls, missing: true }); continue; }
      const bs = getComputedStyle(btn);
      const bg = parseColor(bs.backgroundColor);
      const color = parseColor(bs.color);
      const svg = btn.querySelector('svg');
      const ss = svg ? getComputedStyle(svg) : null;
      const fill = ss ? parseColor(ss.fill) : null;
      // svg 的 fill 若是 currentColor 未解析成功，退化为按钮的 color
      const effFill = fill && fill.a > 0 ? fill : color;
      const r = svg ? svg.getBoundingClientRect() : null;
      out.push({
        cls,
        btnBg: bs.backgroundColor,
        btnColor: bs.color,
        svgFill: ss ? ss.fill : null,
        borderBottom: bs.borderBottomColor,
        borderWidth: bs.borderBottomWidth,
        shadow: bs.boxShadow,
        disabled: btn.disabled,
        btnSize: [Math.round(btn.getBoundingClientRect().width), Math.round(btn.getBoundingClientRect().height)],
        iconSize: r ? [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10] : null,
        // :disabled 的 svg 是 fill-opacity .4，先与按钮底色合成再算，才叫真实观感
        iconVsBtnBg: contrast(ss && ss.fillOpacity !== '1' ? over({ ...effFill, a: effFill.a * parseFloat(ss.fillOpacity) }, bg) : over(effFill, bg), bg),
        btnBgVsCanvas: contrast(bg, canvasBg),
        panelRing: (() => {
          const panel = document.querySelector('.react-flow__controls');
          const p = panel ? getComputedStyle(panel) : null;
          return p ? p.boxShadow + ' | radius=' + p.borderTopLeftRadius : null;
        })(),
      });
    }
    return { canvasBg: getComputedStyle(document.body).backgroundColor, out };
  })()`)
  info('画布底色', measured.canvasBg)
  const canvasBgRgb = measured.canvasBg
  for (const b of measured.out) {
    info('按钮 ' + b.cls, b)
    // WCAG 1.4.11「非文本内容」要求 ≥3:1；图标是这里唯一的操作提示，按 4.5:1 严管
    check(`[${b.cls}] 图标色与按钮底色对比度 ≥ 4.5:1`, b.iconVsBtnBg >= 4.5,
      b.iconVsBtnBg.toFixed(2) + ':1  (图标 ' + b.svgFill + ' / 底 ' + b.btnBg + ')')
    // 深色 UI 里按钮底色本身就是深色面，靠"面板 1px 描边 + 按钮间分隔线"分区，
    // 所以这里只要求底色与画布不是同一个色（不许"糊进背景"）。
    check(`[${b.cls}] 按钮底色不再糊进画布（与画布异色）`, b.btnBg !== canvasBgRgb,
      'btnBg=' + b.btnBg + ' canvas=' + canvasBgRgb + ' (对比 ' + b.btnBgVsCanvas.toFixed(2) + ':1)')
  }

  // 2b) 分区手段：面板 1px 描边（深底上默认那圈 2% 黑投影等于看不见）
  const ring = measured.out[0] && measured.out[0].panelRing
  info('控件面板描边', ring)
  check('控件面板有 1px 描边（从画布上浮出）', /0px 0px 0px 1px/.test(String(ring)), String(ring))
  check('控件面板做了圆角裁切（不被直角色块破坏）', /radius=(6px|[1-9])/.test(String(ring)), String(ring))

  // 2c) 按钮之间的分隔线：前三个应有底边线，最后一个应当没有（xyflow :last-child 规则）
  const dividers = await js(`(() => {
    const btns = Array.from(document.querySelectorAll('.react-flow__controls-button'));
    return btns.map((b) => parseFloat(getComputedStyle(b).borderBottomWidth) || 0);
  })()`)
  info('各按钮底边线宽度', dividers)
  check('放大/缩小/fitView 之间有分隔线', dividers.slice(0, 3).every((w) => w > 0.5), JSON.stringify(dividers))
  check('最后一个（锁定）无多余底边线', dividers[dividers.length - 1] === 0, JSON.stringify(dividers))

  // 3) 尺寸：12px 的图标在深色小按钮里偏小，顺手确认放大了
  const zoomin = measured.out.find((b) => b.cls === 'zoomin')
  if (zoomin) {
    check('图标尺寸 ≥ 14px（默认 12px 偏小）', zoomin.iconSize && zoomin.iconSize[0] >= 14,
      JSON.stringify(zoomin.iconSize))
    check('按钮尺寸 ≥ 28px（默认 26px）', zoomin.btnSize && zoomin.btnSize[0] >= 28, JSON.stringify(zoomin.btnSize))
  }

  // 4) 缩略图（快速定位）同源问题：默认底色 #fff + 浅色遮罩，压在深色画布上是块白板。
  const mm = await js(`(() => {
    ${PAGE_HELPERS}
    const el = document.querySelector('.react-flow__minimap');
    const mask = document.querySelector('.react-flow__minimap-mask');
    const canvasBg = parseColor(getComputedStyle(document.body).backgroundColor);
    const s = el ? getComputedStyle(el) : null;
    const bg = s ? parseColor(s.backgroundColor) : null;
    return {
      exists: !!el,
      bg: s ? s.backgroundColor : null,
      maskFill: mask ? getComputedStyle(mask).fill : null,
      ring: s ? s.boxShadow : null,
      radius: s ? s.borderTopLeftRadius : null,
      bgVsCanvas: bg ? contrast(bg, canvasBg) : null,
    };
  })()`)
  info('缩略图', mm)
  check('缩略图存在', mm.exists)
  check('缩略图底色已转为深色（不再是刺眼白板）', mm.bg && mm.bg !== 'rgb(255, 255, 255)', String(mm.bg))
  check('缩略图底色与画布区分（浮在画布上）', mm.bgVsCanvas === null || mm.bgVsCanvas >= 1.05,
    mm.bgVsCanvas === null ? 'n/a' : mm.bgVsCanvas.toFixed(2) + ':1')
  check('缩略图遮罩不再是浅灰 rgba(240,240,240,.6)', mm.maskFill && mm.maskFill !== 'rgb(240, 240, 240)',
    String(mm.maskFill))
  check('缩略图有描边/圆角（不像裸 svg）',
    /0px 0px 0px 1px/.test(String(mm.ring)) && /6px|[1-9]/.test(String(mm.radius)),
    String(mm.ring) + ' | radius=' + String(mm.radius))

  // 5) 视觉兜底：把左下角控件区裁出来存档，人工可比对。
  //    ⚠️ 必须在下面强制 :hover 之前截，否则截到的是被伪类污染的"悬停态"。
  const rect = await js(`(() => {
    const p = document.querySelector('.react-flow__controls');
    const r = p.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  })()`)
  const pad = 16
  const img = await win.webContents.capturePage({
    x: Math.max(0, Math.round(rect.x - pad)),
    y: Math.max(0, Math.round(rect.y - pad)),
    width: Math.round(rect.width + pad * 2),
    height: Math.round(rect.height + pad * 2),
  })
  const shot = path.join(ROOT, 'ui-13-controls.png')
  fs.writeFileSync(shot, img.toPNG())
  console.log('  screenshot written: ' + path.basename(shot))
  check('控件区域截图已生成且非空', img.getSize().width > 20 && img.getSize().height > 20,
    JSON.stringify(img.getSize()))
  const full = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'ui-13-controls-full.png'), full.toPNG())
  console.log('  screenshot written: ui-13-controls-full.png')

  // 顺带把右下角缩略图也裁一张
  const mmRect = await js(`(() => {
    const p = document.querySelector('.react-flow__minimap');
    const r = p.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  })()`)
  const mmImg = await win.webContents.capturePage({
    x: Math.max(0, Math.round(mmRect.x - pad)),
    y: Math.max(0, Math.round(mmRect.y - pad)),
    width: Math.round(mmRect.width + pad * 2),
    height: Math.round(mmRect.height + pad * 2),
  })
  fs.writeFileSync(path.join(ROOT, 'ui-14-minimap.png'), mmImg.toPNG())
  console.log('  screenshot written: ui-14-minimap.png')

  // 6) 悬停态：用 CDP 强制 :hover，量悬停底色是否明显区别于常态
  let hover = null
  let nodeId = null
  try {
    win.webContents.debugger.attach('1.3')
    const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1 })
    ;({ nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId, selector: '.react-flow__controls-zoomout',
    }))
    await win.webContents.debugger.sendCommand('CSS.enable')
    await win.webContents.debugger.sendCommand('CSS.forcePseudoState', {
      nodeId, forcedPseudoClasses: ['hover'],
    })
    await sleep(150)
    hover = await js(`(() => {
      ${PAGE_HELPERS}
      const btn = document.querySelector('.react-flow__controls-zoomout');
      const bs = getComputedStyle(btn);
      const bg = parseColor(bs.backgroundColor);
      const svg = btn.querySelector('svg');
      const fill = parseColor(getComputedStyle(svg).fill);
      const canvasBg = parseColor(getComputedStyle(document.body).backgroundColor);
      return { bg: bs.backgroundColor, fill: getComputedStyle(svg).fill,
               iconVsBg: contrast(over(fill, bg), bg), bgVsCanvas: contrast(bg, canvasBg) };
    })()`)
    await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
    win.webContents.debugger.detach()
  } catch (e) {
    info('hover 探测跳过', String((e && e.message) || e))
  }
  if (hover) {
    const hoverShot = await win.webContents.capturePage({
      x: Math.max(0, Math.round(rect.x - pad)),
      y: Math.max(0, Math.round(rect.y - pad)),
      width: Math.round(rect.width + pad * 2),
      height: Math.round(rect.height + pad * 2),
    })
    fs.writeFileSync(path.join(ROOT, 'ui-13-controls-hover.png'), hoverShot.toPNG())
    console.log('  screenshot written: ui-13-controls-hover.png')
  }
  if (hover) {
    const base = measured.out.find((b) => b.cls === 'zoomout')
    info('悬停态 zoomout', hover)
    check('悬停态图标仍清晰 (≥4.5:1)', hover.iconVsBg >= 4.5, hover.iconVsBg.toFixed(2) + ':1')
    check('悬停态底色与常态不同（有交互反馈）', hover.bg !== base.btnBg,
      'hover=' + hover.bg + ' 常态=' + base.btnBg)
  }

  finish()
}

let done = false
function finish() {
  if (done) return
  done = true
  const passed = results.filter(Boolean).length
  console.log('\nCHROME_E2E ' + (passed === results.length ? 'OK' : 'FAIL') + ' (' + passed + '/' + results.length + ')')
  app.exit(passed === results.length ? 0 : 1)
}

app.on('window-all-closed', () => {})
app.whenReady().then(() =>
  main().catch((e) => { console.error('PROBE ERROR:', (e && e.stack) || e); finish() }),
)
