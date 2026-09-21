// C.6 验证：设置持久化 / 密钥封装 / AI 后端重建（含真实拉起示例 MCP Server 子进程）。
// 运行：先 `node node_modules/typescript/bin/tsc -p tsconfig.test.json`，再 `node tests/ai-settings.test.cjs`
const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { createServices, ensureProject } = require('../dist-test/core/services')
const {
  SettingsStore,
  sealSecret,
  openSecret,
  maskSecret,
  plaintextSecretBox,
} = require('../dist-test/core/settings-store')
const { syncAiBackends, buildSettingsView } = require('../dist-test/core/ai-backends')

let passed = 0
function ok(name) { passed++; console.log('  ✓', name) }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-ai-'))

// 可用的"假加密盒"：能证明落盘的是密文而不是明文（真实实现是 safeStorage）
const fakeBox = {
  available: true,
  encrypt: (plain) => Buffer.from(`ENC:${plain}`, 'utf-8').toString('base64'),
  decrypt: (payload) => {
    const s = Buffer.from(payload, 'base64').toString('utf-8')
    if (!s.startsWith('ENC:')) throw new Error('corrupted payload')
    return s.slice(4)
  },
}

const EXAMPLE_SERVER = path.join(__dirname, '..', 'dist-test', 'core', 'mcp-server', 'workbuddy-mcp-server.js')

;(async () => {
  // ---------- 1. SettingsStore 基础 ----------
  const store = new SettingsStore(base)
  const empty = store.read()
  assert.deepStrictEqual(empty.mcpServers, [])
  assert.strictEqual(empty.deepseek, undefined)
  ok('empty settings when no file')

  store.write({ deepseek: undefined, mcpServers: [{ id: 'a', name: 'A', command: 'x', args: [], env: {}, enabled: true }] })
  assert.strictEqual(store.read().mcpServers.length, 1)
  assert.ok(fs.existsSync(store.path), 'settings.json written')
  ok('write + read roundtrip')

  fs.writeFileSync(store.path, '{ this is not json', 'utf-8')
  assert.deepStrictEqual(store.read().mcpServers, [], 'corrupt file degrades to empty, does not throw')
  ok('corrupted settings file degrades gracefully')

  // ---------- 2. 密钥封装 ----------
  const sealed = sealSecret(fakeBox, 'sk-secret-1234567890')
  assert.strictEqual(sealed.protection, 'safeStorage')
  assert.ok(sealed.encrypted, 'encrypted payload present')
  assert.strictEqual(sealed.plain, undefined, 'no plaintext field when encryption is available')
  assert.ok(!sealed.encrypted.includes('sk-secret'), 'ciphertext does not contain the key')
  assert.strictEqual(openSecret(fakeBox, sealed), 'sk-secret-1234567890')
  ok('sealSecret encrypts when a real box is available (roundtrip ok)')

  const plainSealed = sealSecret(plaintextSecretBox(), 'sk-plain-abc')
  assert.strictEqual(plainSealed.protection, 'plaintext')
  assert.strictEqual(plainSealed.plain, 'sk-plain-abc')
  assert.strictEqual(plainSealed.encrypted, undefined)
  assert.strictEqual(openSecret(plaintextSecretBox(), plainSealed), 'sk-plain-abc')
  ok('plaintextSecretBox degrades explicitly (flagged as plaintext)')

  assert.strictEqual(openSecret(fakeBox, { encrypted: 'bm90LWVuYw==', protection: 'safeStorage' }), null)
  assert.strictEqual(openSecret(fakeBox, undefined), null)
  ok('openSecret returns null instead of throwing on undecryptable payload')

  assert.strictEqual(maskSecret('sk-secret-1234567890'), 'sk-s…7890')
  assert.strictEqual(maskSecret('short'), '••••')
  ok('maskSecret never reveals the full key')

  // ---------- 3. DeepSeek 配置 → 注册表 ----------
  fs.rmSync(store.path, { force: true })
  const svc = createServices({ dataDir: base, secrets: fakeBox, fakeGenerator: true })
  svc.settings.write({ deepseek: sealSecret(fakeBox, 'sk-live-key-abcdef'), mcpServers: [] })
  await syncAiBackends(svc)

  assert.ok(svc.registry.get('deepseek-direct'), 'deepseek generator registered after sync')
  assert.strictEqual(svc.defaultGeneratorId, 'deepseek-direct', 'deepseek wins as default')
  ok('saving a DeepSeek key registers the direct generator as default')

  let view = buildSettingsView(svc)
  assert.strictEqual(view.deepseek.configured, true)
  assert.strictEqual(view.deepseek.protection, 'safeStorage')
  assert.strictEqual(view.deepseek.masked, 'sk-l…cdef')
  assert.ok(!JSON.stringify(view).includes('sk-live-key-abcdef'), 'view never leaks the raw key')
  ok('settings view exposes mask + protection but never the raw key')

  // 磁盘上也不应有明文
  const onDisk = fs.readFileSync(svc.settings.path, 'utf-8')
  assert.ok(!onDisk.includes('sk-live-key-abcdef'), 'raw key never written to disk when encrypted')
  assert.ok(onDisk.includes('encrypted'), 'disk stores the encrypted form')
  ok('disk contains ciphertext only (raw key absent)')

  // 清除 key → 后端消失
  svc.settings.write({ deepseek: undefined, mcpServers: [] })
  await syncAiBackends(svc)
  assert.strictEqual(svc.registry.get('deepseek-direct'), undefined)
  assert.strictEqual(svc.defaultGeneratorId, 'fake', 'falls back to local placeholder')
  assert.strictEqual(buildSettingsView(svc).deepseek.configured, false)
  ok('clearing the key removes the backend and falls back to the placeholder')

  // ---------- 4. MCP Server：真实拉起子进程 ----------
  svc.settings.write({
    deepseek: undefined,
    mcpServers: [
      {
        id: 'demo',
        name: '本地示例 Server',
        command: process.execPath,
        args: [EXAMPLE_SERVER],
        env: { IDEASPROUT_MCP_FAKE: '1' },
        enabled: true,
      },
    ],
  })
  const statuses = await syncAiBackends(svc)
  assert.strictEqual(statuses.length, 1)
  assert.strictEqual(statuses[0].state, 'connected', `expected connected, got ${statuses[0].state}: ${statuses[0].error}`)
  // 示例 server 暴露 4 个 tool：1 个生成 + 3 个只读（list_projects/get_tree/get_node）
  assert.deepStrictEqual(
    [...statuses[0].tools].sort(),
    ['generate', 'get_node', 'get_tree', 'list_projects'],
    'discovered tools: ' + statuses[0].tools.join(','),
  )
  assert.ok(svc.mcp.isConnected('demo'), 'manager holds the connection')
  const mcpGen = svc.registry.get('mcp:demo:generate')
  assert.ok(mcpGen, 'adapter registered for the generate tool')
  assert.strictEqual(mcpGen.kind, 'mcp')
  // 只读 tool 不得被当成"生成后端"：它们读数据、入参契约与 generate 完全不同，
  // 混进生成器下拉只会在被选中时报错。靠 annotations.readOnlyHint 排除。
  for (const n of ['list_projects', 'get_tree', 'get_node']) {
    assert.strictEqual(
      svc.registry.get('mcp:demo:' + n),
      undefined,
      `read-only tool "${n}" must NOT be registered as a generator`,
    )
  }
  assert.deepStrictEqual(
    svc.registry.list().filter((g) => g.kind === 'mcp').map((g) => g.id),
    ['mcp:demo:generate'],
    'only the generate tool becomes an MCP backend',
  )
  assert.strictEqual(svc.defaultGeneratorId, 'mcp:demo:generate', 'MCP becomes default when no DeepSeek')
  ok('enabling an MCP server spawns it, lists tools, registers only the generator tool')

  view = buildSettingsView(svc)
  assert.strictEqual(view.mcpServers[0].status.state, 'connected')
  // 恰好 2 = 本地占位 + 1 个 MCP 生成器（3 个只读 tool 不计入）
  assert.strictEqual(view.generatorCount, 2, 'placeholder + generate (read-only tools excluded)')
  ok('settings view reports per-server status + tool count (read-only excluded)')

  // 真的能用这个 MCP 后端生成
  const project = ensureProject(svc)
  const gen = require('../dist-test/core/generate-node').generateNode
  const res = await gen(svc, {
    projectId: project.project.id,
    parentNodeId: project.tree.nodes[0].id,
    prompt: '通过 MCP 生成',
    generatorId: 'mcp:demo:generate',
  })
  assert.ok(res.items[0].node.content.includes('通过 MCP 生成'), 'content came back over MCP stdio')
  ok('end-to-end: generate through the MCP-backed generator')

  // ---------- 5. 停用 → 断开并注销 ----------
  svc.settings.update((s) => ({ ...s, mcpServers: s.mcpServers.map((m) => ({ ...m, enabled: false })) }))
  await syncAiBackends(svc)
  assert.strictEqual(svc.mcp.isConnected('demo'), false, 'connection closed on disable')
  assert.strictEqual(svc.registry.get('mcp:demo:generate'), undefined, 'adapter removed from registry')
  assert.strictEqual(buildSettingsView(svc).mcpServers[0].status.state, 'disabled')
  assert.strictEqual(svc.defaultGeneratorId, 'fake', 'default falls back again')
  ok('disabling a server disconnects it and unregisters its adapters')

  // ---------- 6. 连接失败：只标记该 server，不拖垮全局 ----------
  svc.settings.update((s) => ({
    ...s,
    mcpServers: [
      { ...s.mcpServers[0], enabled: true, id: 'broken', command: path.join(base, 'no-such-binary.exe') },
    ],
  }))
  await syncAiBackends(svc)
  const brokenStatus = buildSettingsView(svc).mcpServers[0].status
  assert.strictEqual(brokenStatus.state, 'error')
  assert.ok(brokenStatus.error && brokenStatus.error.length > 0, 'error message surfaced')
  assert.ok(svc.registry.get('fake'), 'app STILL has a usable generator (placeholder)')
  ok('a failing server is reported as error without breaking other backends')

  // ---------- 7. 删除 ----------
  svc.settings.update((s) => ({ ...s, mcpServers: [] }))
  await syncAiBackends(svc)
  assert.strictEqual(buildSettingsView(svc).mcpServers.length, 0)
  ok('removing a server clears it from settings + view')

  await svc.mcp.disconnectAll()
  console.log(`\nALL AI-SETTINGS TESTS PASSED (${passed} checks)`)
})().catch((e) => {
  console.error('\nTEST FAILED:', e)
  process.exit(1)
})
