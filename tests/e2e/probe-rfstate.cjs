// 诊断/压力探针（本地用，probe-*.cjs 已在 .gitignore）：直接读 @xyflow/react 的**内部 store**，
// 回答"新节点到底缺什么"——以及量化「新节点偶发不画连线」的失败率。
//
// 从 `.react-flow` 元素的 React fiber 往上走，找到 Context.Provider 上的 zustand store
// （`memoizedProps.value.getState`），然后 dump nodeLookup 里每个节点的
//   measured / internals.handleBounds —— 这就是 isNodeInitialized 与 getEdgePosition 的判据。
// 失败时再手动调库自己的 `st.updateNodeInternals(map, force)` 做**决定性实验**：
// 边当场补上（edges 0→1）就证明"主动重测"是正确的修法。
//
// 用法（单次）：
//   unset ELECTRON_RUN_AS_NODE && ./node_modules/electron/dist/electron.exe probe-rfstate.cjs
// 用法（量化失败率，3 并发 × N 轮；修好后应稳定 15/15 全 OK）：
//   for r in $(seq 1 5); do for i in 1 2 3; do ./node_modules/electron/dist/electron.exe \
//     probe-rfstate.cjs > /tmp/rfs_${r}_${i}.log 2>&1 & done; wait; done
//   grep -h '^RESULT:' /tmp/rfs_*.log | sort | uniq -c
//
// 输出里 `RESULT: OK` = 边在 3 秒内渲染出来；`RESULT: REPRODUCED` = 命中该 bug。
// ⚠️ 单次跑绿说明不了问题（该 bug 曾经约 15% 命中率），必须按上面的并发口径统计。
//
// 只读 + 实验，产品代码不引入任何测试钩子。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-rfs-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { bootstrap } = require(path.join(ROOT, 'dist-electron/main/app'))
bootstrap()

// 把"读内部 store"的代码注入页面（一次性定义 window.__rfProbe）
const INJECT = `(() => {
  window.__rfProbe = {
    store() {
      const el = document.querySelector('.react-flow');
      if (!el) return null;
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!key) return { err: 'no fiber key', keys: Object.keys(el).slice(0, 20) };
      let f = el[key], hops = 0, seen = [];
      while (f && hops < 200) {
        const p = f.memoizedProps;
        if (p && p.value && typeof p.value.getState === 'function') return p.value;
        if (p && typeof p.store === 'object' && p.store && typeof p.store.getState === 'function') return p.store;
        seen.push(f.type && (f.type.name || f.type.displayName || typeof f.type));
        f = f.return; hops++;
      }
      return { err: 'no store found', chain: seen.slice(0, 25) };
    },
    dump() {
      const s = window.__rfProbe.store();
      if (!s || typeof s.getState !== 'function') return { err: 'store unavailable', detail: s };
      const st = s.getState();
      const out = { nodes: [], edgeLookup: [] };
      if (st.nodeLookup) for (const [id, n] of st.nodeLookup) {
        out.nodes.push({
          id: id.slice(0, 8),
          measured: n.measured ? { w: n.measured.width, h: n.measured.height } : null,
          hasHandleBounds: !!n.internals.handleBounds,
          srcHandles: n.internals.handleBounds?.source?.length ?? null,
          tgtHandles: n.internals.handleBounds?.target?.length ?? null,
          hasDimensions: n.measured?.width !== undefined && n.measured?.height !== undefined,
          hasUserMeasured: !!n.internals.userNode?.measured,
        });
      }
      if (st.edgeLookup) for (const [id, e] of st.edgeLookup) out.edgeLookup.push({ id: id.slice(0, 8), source: (e.source||'').slice(0,8), target: (e.target||'').slice(0,8) });
      out.ourNodesCount = (st.nodes || []).length;
      out.ourEdgesCount = (st.edges || []).length;
      return out;
    },
  };
  return 'injected';
})()`

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(1200)
  const js = (code) => win.webContents.executeJavaScript(code)
  console.log('inject:', await js(INJECT))

  const projectsDir = path.join(dataDir, 'projects')
  const readTree = () => JSON.parse(fs.readFileSync(path.join(projectsDir, fs.readdirSync(projectsDir)[0]), 'utf8')).tree
  const waitFor = async (pred, timeoutMs = 6000) => {
    const t0 = Date.now()
    for (;;) {
      if (await pred()) return true
      if (Date.now() - t0 > timeoutMs) return false
      await sleep(100)
    }
  }
  const edgeCount = () => js('document.querySelectorAll(".react-flow__edge").length')
  const nodeCount = () => js('document.querySelectorAll(".react-flow__node").length')
  const nodeRect = (id) => js(`(() => { const el = document.querySelector('.react-flow__node[data-id="${id}"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } })()`)
  const setPrompt = (t) => js(`(() => {
    const ta = document.querySelector('[data-testid="prompt-input"]');
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(ta, ${JSON.stringify(t)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)

  let rootId = null
  await waitFor(async () => {
    rootId = await js(`(() => { const el = Array.from(document.querySelectorAll('.react-flow__node')).find(n => (n.textContent||'').includes('创意主题')); return el ? el.getAttribute('data-id') : null })()`)
    return !!rootId
  }, 8000)
  if (!rootId) { console.log('RESULT: NO_ROOT'); console.log('RFSTATE_E2E FAIL (0/1)'); return app.exit(3) }

  console.log('DUMP_AFTER_INIT ' + JSON.stringify(await js('window.__rfProbe.dump()')))

  const r = await nodeRect(rootId)
  await js(`(() => {
    const el = document.querySelector('.react-flow__node[data-id="${rootId}"]');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${Math.round(r.left + r.width / 2)}, clientY: ${Math.round(r.top + r.height / 2)} }));
  })()`)
  await sleep(200)
  await js('document.querySelector(\'[data-testid="menu-ideasprout"]\').click()')
  await sleep(200)
  await setPrompt('RF 诊断')
  await js('document.querySelector(\'[data-testid="submit-generate"]\').click()')
  await waitFor(async () => (await nodeCount()) >= 2, 8000)
  await sleep(300)

  const ok = await waitFor(async () => (await edgeCount()) === 1, 3000)
  const dump = await js('window.__rfProbe.dump()')
  console.log('DUMP_AFTER_ADD ' + JSON.stringify(dump))
  console.log('RESULT: ' + (ok ? 'OK' : 'REPRODUCED'))
  // 标准标记（verify.cjs 认 `<名>_E2E OK (n/m)`）。
  console.log('RFSTATE_E2E ' + (ok ? 'OK (1/1)' : 'FAIL (0/1)'))
  if (!ok) {
    // 决定性实验：直接调 React Flow 自己的 updateNodeInternals（force:true）强制重测，
    // 看它能不能把边救回来 —— 以此判断"重测"是不是正确的修法。
    const forced = await js(`(() => {
      const s = window.__rfProbe.store();
      if (!s || typeof s.getState !== 'function') return 'no store';
      const st = s.getState();
      const updates = new Map();
      for (const [id] of st.nodeLookup) {
        const el = st.domNode && st.domNode.querySelector('.react-flow__node[data-id="' + id + '"]');
        if (el) updates.set(id, { id, nodeElement: el, force: true });
      }
      const n = updates.size;
      st.updateNodeInternals(updates);
      return 'forced ' + n + ' nodes';
    })()`)
    console.log('FORCE: ' + forced)
    await sleep(800)
    console.log('DUMP_AFTER_FORCE ' + JSON.stringify(await js('window.__rfProbe.dump()')))
    console.log('edges_after_force=' + (await edgeCount()))

    await sleep(2000)
    console.log('DUMP_LATER ' + JSON.stringify(await js('window.__rfProbe.dump()')))
    console.log('edges_later=' + (await edgeCount()))
  }
  app.exit(ok ? 0 : 1)
}

app.on('window-all-closed', () => {})
app.whenReady().then(() => main().catch((e) => { console.error('DIAG ERROR:', (e && e.stack) || e); app.exit(2) }))
