// 生成应用图标（build/icon.ico + build/icon.icns）。
// 用 Node 纯手写 PNG/ICO/ICNS 编码，不引入图像库 —— 与项目「纯 JS 技术栈」一致，且图标可复现。
// 用法：node scripts/make-icon.cjs
//
// 图形：深色圆角底 + 一个中心节点向两个子节点发散（呼应"发散创意画布"）。
//
// macOS（.icns）自 10.7 起支持在容器里直接放 PNG 条目（ic07~ic14），
// 因此不必实现 JP2 编码：按尺寸选对应的 PNG 类型即可。

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const OUT_DIR = path.join(__dirname, '..', 'build')
const SIZES = [16, 32, 48, 64, 128, 256]
const SS = 4 // 超采样倍数，用于抗锯齿

// ---------- 颜色（与应用的深色主题一致） ----------
const C_BG = [0x0d, 0x11, 0x17]
const C_BORDER = [0x30, 0x36, 0x3d]
const C_EDGE = [0x58, 0xa6, 0xff]
const C_ROOT = [0x1f, 0x6f, 0xeb]
const C_CHILD = [0x89, 0x57, 0xe5]

// ---------- 几何（归一化坐标，随尺寸缩放） ----------
const ROUND = 0.23 // 圆角半径（占边长比例）
const INSET = 0.012
const ROOT = { x: 0.3, y: 0.5, r: 0.085 }
const KIDS = [
  { x: 0.705, y: 0.285, r: 0.07 },
  { x: 0.705, y: 0.715, r: 0.07 },
]
const EDGE_W = 0.022

/** 圆角矩形的有符号距离（负值在内部）。 */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

/** 点到线段的距离。 */
function sdSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - x0) * dx + (py - y0) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

/**
 * 渲染一张 size×size 的 RGBA 图（带超采样抗锯齿）。
 * 内部用「预乘 alpha」的浮点缓冲，便于叠加与降采样。
 * `ss` 可单独指定：512/1024 这种大尺寸再乘 4 倍超采样，内存会爆（N² × 7 个 Float32 数组），
 * 所以大尺寸用更小的超采样倍数。
 */
function render(size, ss = SS) {
  const N = size * SS
  const a = new Float32Array(N * N)
  const r = new Float32Array(N * N)
  const g = new Float32Array(N * N)
  const b = new Float32Array(N * N)

  // src-over 合成一个形状（cov 为该像素的覆盖度 0..1）
  const paint = (cov, col) => {
    if (cov <= 0) return
    for (let i = 0; i < a.length; i++) {
      const c = cov[i]
      if (c <= 0) continue
      const sa = Math.min(1, c)
      const na = sa + a[i] * (1 - sa)
      r[i] = col[0] * sa + r[i] * (1 - sa)
      g[i] = col[1] * sa + g[i] * (1 - sa)
      b[i] = col[2] * sa + b[i] * (1 - sa)
      a[i] = na
    }
  }

  // 覆盖度缓冲：由有符号距离生成 1px 宽的边缘过渡
  const covFrom = (sd) => {
    const cov = new Float32Array(N * N)
    for (let i = 0; i < sd.length; i++) cov[i] = Math.max(0, Math.min(1, 0.5 - sd[i]))
    return cov
  }

  // 预计算各基本形的距离场（归一化坐标 → 像素）
  const px = (nx) => nx * N
  const sdBg = new Float32Array(N * N)
  const sdBgIn = new Float32Array(N * N)
  const sdEdge1 = new Float32Array(N * N)
  const sdEdge2 = new Float32Array(N * N)
  const sdRoot = new Float32Array(N * N)
  const sdKid1 = new Float32Array(N * N)
  const sdKid2 = new Float32Array(N * N)

  const hw = N / 2
  const rad = ROUND * N
  const inPad = INSET * N

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      sdBg[i] = sdRoundRect(x, y, hw, hw, hw, hw, rad)
      sdBgIn[i] = sdRoundRect(x, y, hw, hw, hw - inPad, hw - inPad, Math.max(1, rad - inPad))
      sdEdge1[i] = sdSegment(x, y, px(ROOT.x), px(ROOT.y), px(KIDS[0].x), px(KIDS[0].y)) - (EDGE_W * N) / 2
      sdEdge2[i] = sdSegment(x, y, px(ROOT.x), px(ROOT.y), px(KIDS[1].x), px(KIDS[1].y)) - (EDGE_W * N) / 2
      sdRoot[i] = Math.hypot(x - px(ROOT.x), y - px(ROOT.y)) - ROOT.r * N
      sdKid1[i] = Math.hypot(x - px(KIDS[0].x), y - px(KIDS[0].y)) - KIDS[0].r * N
      sdKid2[i] = Math.hypot(x - px(KIDS[1].x), y - px(KIDS[1].y)) - KIDS[1].r * N
    }
  }

  // 依次绘制：底 → 底色 → 连线 → 节点
  paint(covFrom(sdBg), C_BORDER)
  paint(covFrom(sdBgIn), C_BG)
  paint(covFrom(sdEdge1), C_EDGE)
  paint(covFrom(sdEdge2), C_EDGE)
  paint(covFrom(sdRoot), C_ROOT)
  paint(covFrom(sdKid1), C_CHILD)
  paint(covFrom(sdKid2), C_CHILD)

  // 降采样 SS×SS 并反预乘
  const out = Buffer.alloc(size * size * 4)
  const cells = SS * SS
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sa = 0
      let sr = 0
      let sg = 0
      let sb = 0
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = (y * SS + dy) * N + (x * SS + dx)
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
      const al = sa
      out[o] = al > 0 ? Math.round(Math.min(255, sr / al)) : 0
      out[o + 1] = al > 0 ? Math.round(Math.min(255, sg / al)) : 0
      out[o + 2] = al > 0 ? Math.round(Math.min(255, sb / al)) : 0
      out[o + 3] = Math.round(Math.min(255, al * 255))
    }
  }
  return out
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

// macOS 图标：32~512 的 PNG 条目（512 用 2 倍超采样，避免 2048² × 7 个缓冲把内存吃满）
const MAC_SIZES = [32, 64, 128, 256, 512]
const macImages = MAC_SIZES.map((size) => ({
  size,
  png: encodePng(render(size, size >= 512 ? 2 : SS), size),
}))
const icns = encodeIcns(macImages)
fs.writeFileSync(path.join(OUT_DIR, 'icon.icns'), icns)

console.log(`icon.ico written (${SIZES.join(', ')} px, ${ico.length} bytes)`)
console.log('icon.png written (256 px)')
console.log(`icon.icns written (${MAC_SIZES.join(', ')} px, ${icns.length} bytes)`)
