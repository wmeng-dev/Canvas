// 生成应用图标（build/icon.ico + build/icon.png + build/icon.icns + build/icon.svg）。
// 用 Node 纯手写 PNG/ICO/ICNS 编码，不引入图像库 —— 与项目「纯 JS 技术栈」一致，且图标可复现。
// 用法：node scripts/make-icon.cjs
//
// 图形（设计定案）：
//   深色圆角「画布」底（自上而下的渐变）+ 中心偏左一个根节点，向右呈 38° 扇形发散出三个子节点；
//   连线从根到叶逐渐变细、颜色由蓝渐变到紫；节点带同色微光。
//   语义：一个想法发散成多个方向 —— 呼应「风衍 IdeaSprout」。
//   配色取自应用自身主题（#1f6feb 蓝 / #8957e5 紫 / #0d1117 底），不是另起一套。
//
// ⚠️ SVG 与 PNG 从**同一份常量**生成（下方 GEOMETRY / COLORS）：改设计只改常量，两处不会走样。
//
// macOS（.icns）自 10.7 起支持在容器里直接放 PNG 条目（ic07~ic14），
// 因此不必实现 JP2 编码：按尺寸选对应的 PNG 类型即可。

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const OUT_DIR = path.join(__dirname, '..', 'build')
const SIZES = [16, 32, 48, 64, 128, 256]
const MAC_SIZES = [32, 64, 128, 256, 512]
const SS = 4 // 超采样倍数，用于抗锯齿

// ---------- 几何（归一化坐标，随尺寸缩放） ----------
const ROUND = 0.2237 // 圆角半径（占边长比例），接近 macOS 的 squircle
const ROOT = { x: 0.3, y: 0.5, r: 0.088 }
const FAN_DEG = 38 // 发散张角
const FAN_DIST = 0.44 // 根到子节点的距离
const KID_R = 0.058
const EDGE_W0 = 0.04 // 连线靠近根的宽度（粗）
const EDGE_W1 = 0.024 // 连线靠近叶的宽度（细）
const GLOW_ROOT_R = 0.34
const GLOW_ROOT_A = 0.42
const GLOW_KID_R = 0.19
const GLOW_KID_A = 0.34

/** 三个子节点：以根为圆心、按 ±FAN_DEG / 0° 呈扇形排开。 */
const KIDS = [-FAN_DEG, 0, FAN_DEG].map((deg) => {
  const rad = (deg * Math.PI) / 180
  return { x: ROOT.x + Math.cos(rad) * FAN_DIST, y: ROOT.y + Math.sin(rad) * FAN_DIST, r: KID_R }
})

// ---------- 颜色（与应用的深色主题一致） ----------
const BG_TOP = [0x1b, 0x23, 0x33]
const BG_BOTTOM = [0x08, 0x0b, 0x11]
const ROOT_HI = [0x8a, 0xc8, 0xff] // 节点左上角高光
const ROOT_LO = [0x1f, 0x6f, 0xeb]
const KID_HI = [0xc9, 0xa6, 0xff]
const KID_LO = [0x7c, 0x4d, 0xe0]
const EDGE_A = [0x3b, 0x82, 0xf6] // 连线：根端
const EDGE_B = [0xa3, 0x71, 0xf7] // 连线：叶端
const GLOW_ROOT_C = [0x58, 0xa6, 0xff]
const GLOW_KID_C = [0xa3, 0x71, 0xf7]

// ---------- 小工具 ----------
const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

/** 圆角矩形的有符号距离（负值在内部）。 */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

// 点到线段的距离 + 投影参数 t（0..1）。写入模块级 scratch，避免每像素分配对象。
let _sd = 0
let _t = 0
function segDistT(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - x0) * dx + (py - y0) * dy) / len2
  t = clamp01(t)
  _t = t
  _sd = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

/**
 * 渲染一张 size×size 的 RGBA 图（带超采样抗锯齿）。
 * 内部用「预乘 alpha」的浮点缓冲，便于叠加与降采样。
 * `ss` 可单独指定：512/1024 这种大尺寸再乘 4 倍超采样，内存会爆（N² × 若干 Float32 数组），
 * 所以大尺寸用更小的超采样倍数。
 */
function render(size, ss = SS) {
  const N = size * ss
  const total = N * N
  const a = new Float32Array(total)
  const r = new Float32Array(total)
  const g = new Float32Array(total)
  const b = new Float32Array(total)

  /** src-over 合成单个像素。 */
  const over = (i, cov, cr, cg, cb) => {
    if (cov <= 0) return
    const sa = cov < 1 ? cov : 1
    const na = sa + a[i] * (1 - sa)
    r[i] = cr * sa + r[i] * (1 - sa)
    g[i] = cg * sa + g[i] * (1 - sa)
    b[i] = cb * sa + b[i] * (1 - sa)
    a[i] = na
  }

  const S = (v) => v * N // 归一化 → 像素
  const hw = N / 2
  const rad = ROUND * N
  const rx = S(ROOT.x)
  const ry = S(ROOT.y)
  const rr = ROOT.r * N

  // 预计算根/子节点中心距离场（发光与节点本体共用，避免重复开方）
  const dRoot = new Float32Array(total)
  const dKids = KIDS.map(() => new Float32Array(total))
  const kidPx = KIDS.map((k) => ({ x: S(k.x), y: S(k.y), r: k.r * N }))
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      dRoot[i] = Math.hypot(x - rx, y - ry)
      for (let k = 0; k < kidPx.length; k++) {
        dKids[k][i] = Math.hypot(x - kidPx[k].x, y - kidPx[k].y)
      }
    }
  }

  // 1) 画布底：全出血圆角矩形 + 自上而下渐变
  for (let y = 0; y < N; y++) {
    const t = N > 1 ? y / (N - 1) : 0
    const cr = lerp(BG_TOP[0], BG_BOTTOM[0], t)
    const cg = lerp(BG_TOP[1], BG_BOTTOM[1], t)
    const cb = lerp(BG_TOP[2], BG_BOTTOM[2], t)
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      over(i, clamp01(0.5 - sdRoundRect(x, y, hw, hw, hw, hw, rad)), cr, cg, cb)
    }
  }

  // 2) 微光：让节点在深色底上"发光"，也让 16px 下不至于糊成一团
  const glow = (distArr, radius, strength, col) => {
    const R = radius * N
    for (let i = 0; i < total; i++) {
      const f = 1 - distArr[i] / R
      if (f <= 0) continue
      over(i, f * f * strength, col[0], col[1], col[2])
    }
  }
  glow(dRoot, GLOW_ROOT_R, GLOW_ROOT_A, GLOW_ROOT_C)
  for (let k = 0; k < dKids.length; k++) glow(dKids[k], GLOW_KID_R, GLOW_KID_A, GLOW_KID_C)

  // 3) 连线：由粗到细 + 由蓝到紫
  for (const kid of kidPx) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x
        segDistT(x, y, rx, ry, kid.x, kid.y)
        const w = lerp(EDGE_W0, EDGE_W1, _t) * N
        const cov = clamp01(0.5 - (_sd - w / 2))
        if (cov <= 0) continue
        over(i, cov, lerp(EDGE_A[0], EDGE_B[0], _t), lerp(EDGE_A[1], EDGE_B[1], _t), lerp(EDGE_A[2], EDGE_B[2], _t))
      }
    }
  }

  // 4) 节点本体：左上高光 → 右下主色的斜向渐变
  const node = (cx, cy, cr2, distArr, hi, lo) => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x
        const cov = clamp01(0.5 - (distArr[i] - cr2))
        if (cov <= 0) continue
        // 沿左上→右下方向做线性渐变（按半径归一化，边缘用 1.4 倍避免过曝）
        const t = clamp01(0.5 + ((x - cx) / cr2) * 0.36 + ((y - cy) / cr2) * 0.36)
        over(i, cov, lerp(hi[0], lo[0], t), lerp(hi[1], lo[1], t), lerp(hi[2], lo[2], t))
      }
    }
  }
  node(rx, ry, rr, dRoot, ROOT_HI, ROOT_LO)
  for (let k = 0; k < kidPx.length; k++) node(kidPx[k].x, kidPx[k].y, kidPx[k].r, dKids[k], KID_HI, KID_LO)

  // 降采样 SS×SS 并反预乘
  const out = Buffer.alloc(size * size * 4)
  const cells = ss * ss
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sa = 0
      let sr = 0
      let sg = 0
      let sb = 0
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const i = (y * ss + dy) * N + (x * ss + dx)
          sa += a[i]
          sr += r[i]
          sg += g[i]
          sb += b[i]
        }
      }
      sa /= cells
      sr /= cells
      sg /= cells
      sb /= cells
      const o = (y * size + x) * 4
      out[o] = sa > 0 ? Math.round(Math.min(255, sr / sa)) : 0
      out[o + 1] = sa > 0 ? Math.round(Math.min(255, sg / sa)) : 0
      out[o + 2] = sa > 0 ? Math.round(Math.min(255, sb / sa)) : 0
      out[o + 3] = Math.round(Math.min(255, sa * 255))
    }
  }
  return out
}

// ---------- SVG（矢量母版，供 README / 网页使用；与 PNG 同源常量） ----------
function buildSvg(size = 256) {
  const S = (v) => +(v * size).toFixed(3)
  const rx = S(ROOT.x)
  const ry = S(ROOT.y)
  const rr = S(ROOT.r)

  const defs = [
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${hex(BG_TOP)}"/><stop offset="1" stop-color="${hex(BG_BOTTOM)}"/></linearGradient>`,
    `<radialGradient id="root" cx="0.32" cy="0.3" r="0.78">` +
      `<stop offset="0" stop-color="${hex(ROOT_HI)}"/><stop offset="1" stop-color="${hex(ROOT_LO)}"/></radialGradient>`,
    `<radialGradient id="kid" cx="0.32" cy="0.3" r="0.78">` +
      `<stop offset="0" stop-color="${hex(KID_HI)}"/><stop offset="1" stop-color="${hex(KID_LO)}"/></radialGradient>`,
  ]

  const parts = [
    `<rect width="${size}" height="${size}" rx="${S(ROUND)}" ry="${S(ROUND)}" fill="url(#bg)"/>`,
  ]

  KIDS.forEach((kid, k) => {
    const kx = S(kid.x)
    const ky = S(kid.y)
    // 连线做成梯形：根端宽 EDGE_W0、叶端宽 EDGE_W1
    const dx = kx - rx
    const dy = ky - ry
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const w0 = (EDGE_W0 * size) / 2
    const w1 = (EDGE_W1 * size) / 2
    const pts = [
      `${(rx + nx * w0).toFixed(3)},${(ry + ny * w0).toFixed(3)}`,
      `${(kx + nx * w1).toFixed(3)},${(ky + ny * w1).toFixed(3)}`,
      `${(kx - nx * w1).toFixed(3)},${(ky - ny * w1).toFixed(3)}`,
      `${(rx - nx * w0).toFixed(3)},${(ry - ny * w0).toFixed(3)}`,
    ].join(' ')
    defs.push(
      `<linearGradient id="e${k}" gradientUnits="userSpaceOnUse" x1="${rx.toFixed(3)}" y1="${ry.toFixed(3)}" x2="${kx.toFixed(3)}" y2="${ky.toFixed(3)}">` +
        `<stop offset="0" stop-color="${hex(EDGE_A)}"/><stop offset="1" stop-color="${hex(EDGE_B)}"/></linearGradient>`
    )
    parts.push(`<polygon points="${pts}" fill="url(#e${k})"/>`)
  })

  parts.push(`<circle cx="${rx}" cy="${ry}" r="${rr}" fill="url(#root)"/>`)
  for (const kid of KIDS) {
    parts.push(`<circle cx="${S(kid.x)}" cy="${S(kid.y)}" r="${S(kid.r)}" fill="url(#kid)"/>`)
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="风衍 IdeaSprout">\n` +
    `  <defs>\n    ${defs.join('\n    ')}\n  </defs>\n  ${parts.join('\n  ')}\n</svg>\n`
  )
}

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- ICO 编码（每个条目内嵌 PNG，Vista+ 支持） ----------
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  for (const img of images) {
    const e = Buffer.alloc(16)
    e[0] = img.size >= 256 ? 0 : img.size // 0 表示 256
    e[1] = img.size >= 256 ? 0 : img.size
    e[2] = 0 // palette
    e[3] = 0 // reserved
    e.writeUInt16LE(1, 4) // color planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(img.png.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += img.png.length
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

// ---------- ICNS 编码（macOS）：容器头 + 若干「类型 + 长度 + PNG」条目 ----------
/** 尺寸 → ICNS 的 PNG 条目类型（ic11/ic12 是 @2x 的小图，ic07~ic10 是大图） */
const ICNS_PNG_TYPE = { 32: 'ic11', 64: 'ic12', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' }

function encodeIcns(images) {
  const entries = images.map(({ size, png }) => {
    const type = Buffer.from(ICNS_PNG_TYPE[size], 'ascii')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(png.length + 8, 0) // 长度含自身的 8 字节头
    return Buffer.concat([type, len, png])
  })
  const body = Buffer.concat(entries)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// ---------- 主流程 ----------
fs.mkdirSync(OUT_DIR, { recursive: true })

const images = SIZES.map((size) => ({ size, png: encodePng(render(size), size) }))
const ico = encodeIco(images)
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico)

// 附带一张 256 的 PNG，方便非 Windows 平台/README 使用
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), images[images.length - 1].png)

// 矢量母版：与 PNG 同源常量，避免两处设计走样
fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), buildSvg(256))

// macOS 图标：32~512 的 PNG 条目（512 用 2 倍超采样，避免 2048² × 若干缓冲把内存吃满）
const macImages = MAC_SIZES.map((size) => ({
  size,
  png: encodePng(render(size, size >= 512 ? 2 : SS), size),
}))
const icns = encodeIcns(macImages)
fs.writeFileSync(path.join(OUT_DIR, 'icon.icns'), icns)

console.log(`icon.ico written (${SIZES.join(', ')} px, ${ico.length} bytes)`)
console.log('icon.png written (256 px)')
console.log('icon.svg written (256 px vector)')
console.log(`icon.icns written (${MAC_SIZES.join(', ')} px, ${icns.length} bytes)`)
