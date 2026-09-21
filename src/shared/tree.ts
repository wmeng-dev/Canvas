// 树结构的纯函数（目前用于"节点收展"的可见性计算）。
//
// ⚠️ 为什么放在 shared 而不是 renderer：
//   1. tsconfig.test.json 只把 core + shared 编译进 dist-test —— 放这里才能被 Node 单测直接覆盖，
//      不必拉起 Electron/浏览器；
//   2. 主进程与渲染端都可能用到同一套"谁该隐藏"的语义，放在一处才不会两边跑偏。

export interface VisibilityNode {
  id: string
  parentId?: string | null
  /** 收起：隐藏**后代**，自身仍可见 */
  collapsed?: boolean
  /** 归档（回收站）：隐藏**自身与后代** */
  archived?: boolean
}

type ChildrenMap = Map<string, string[]>

/** 一次遍历建好 parentId -> 子节点 id 列表，避免每个根节点重复扫全表。 */
function buildChildrenMap(nodes: VisibilityNode[]): ChildrenMap {
  const map: ChildrenMap = new Map()
  for (const n of nodes) {
    const p = n.parentId ?? null
    if (!p) continue
    const list = map.get(p)
    if (list) list.push(n.id)
    else map.set(p, [n.id])
  }
  return map
}

/**
 * 从 rootId 向下收集**全部后代** id（不含自身，含所有层级）。
 *
 * ⚠️ 必须带 visited 保护：`addEdge` 会回写 `child.parentId = source`，
 * 手动连线理论上能把父子关系连成环；成环时无保护的递归/栈遍历会死循环。
 * 这里遇到已访问过的 id 直接跳过，坏数据最多导致结果偏小，不会卡死。
 */
function walkDescendants(map: ChildrenMap, rootId: string): string[] {
  const out: string[] = []
  const visited = new Set<string>([rootId])
  const stack = [...(map.get(rootId) ?? [])]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (visited.has(id)) continue
    visited.add(id)
    out.push(id)
    const kids = map.get(id)
    if (kids) for (const k of kids) stack.push(k)
  }
  return out
}

/** 收集某节点的全部后代 id（不含自身）。 */
export function collectDescendantIds(nodes: VisibilityNode[], rootId: string): string[] {
  return walkDescendants(buildChildrenMap(nodes), rootId)
}

/**
 * 收集某节点向上到根的**全部祖先** id（不含自身）。
 *
 * 用途：从回收站"取出"时要把它被归档的祖先一并取消归档 ——
 * 只取消自己仍会被祖先的归档状态挡着看不见（表现为"点了取出但画布没反应"）。
 * 同样带 visited 保护，父子关系成环时不会死循环。
 */
export function collectAncestorIds(nodes: VisibilityNode[], nodeId: string): string[] {
  const byId = new Map<string, VisibilityNode>()
  for (const n of nodes) byId.set(n.id, n)
  const out: string[] = []
  const visited = new Set<string>([nodeId])
  let cur = byId.get(nodeId)
  while (cur) {
    const p = cur.parentId ?? null
    if (!p || visited.has(p)) break
    visited.add(p)
    out.push(p)
    cur = byId.get(p)
  }
  return out
}

/**
 * 应当在画布上隐藏的节点 id 集合（收起 + 归档两种来源）。
 *
 * 语义：
 *   - **收起**（与常见树控件一致）：节点 A 收起 ⇒ 隐藏 A 的**全部后代**，
 *     A 自身仍可见，否则就没有东西可以点着展开了；
 *     收起状态可嵌套且各自独立（"收起 A → 展开 A"后，后代里原本收起的仍保持收起）。
 *   - **归档**（回收站）：节点 A 归档 ⇒ A **自身连同后代**一起隐藏 ——
 *     进了回收站的东西不该继续占着画布。后代自身的 archived 标记不动，
 *     取出 A 时它们自然跟着回来。
 */
/**
 * 回收站列表要展示的条目 id：自身被归档、且**祖先都没被归档**的那些节点。
 *
 * 为什么只列顶层：归档 A 时并不给 A 的后代打标记（它们只是"跟着藏起来"），
 * 若直接把所有 archived 节点列出来，一条归档会拆成好几行，取出时也不知道该点哪条。
 */
export function collectArchivedTopIds(nodes: VisibilityNode[]): string[] {
  const map = buildChildrenMap(nodes)
  const shadowed = new Set<string>()
  for (const n of nodes) {
    if (!n.archived) continue
    for (const id of walkDescendants(map, n.id)) shadowed.add(id)
  }
  return nodes.filter((n) => n.archived && !shadowed.has(n.id)).map((n) => n.id)
}

/**
 * 从根到 nodeId 的**完整链路** id（含自身，顺序：根 → … → 目标）。
 *
 * 用途：选中一个节点 = 选中"从主题一路收敛到这里"的那条链，方案就是沿这条链生成的。
 * 实现上就是把 `collectAncestorIds`（由近及远）反过来；成环保护由它保证。
 */
export function collectChainIds(nodes: VisibilityNode[], nodeId: string): string[] {
  return [nodeId, ...collectAncestorIds(nodes, nodeId)].reverse()
}

export function collectHiddenIds(nodes: VisibilityNode[]): Set<string> {
  const map = buildChildrenMap(nodes)
  const hidden = new Set<string>()
  for (const n of nodes) {
    const kids = walkDescendants(map, n.id)
    if (n.collapsed) {
      for (const id of kids) hidden.add(id)
    }
    if (n.archived) {
      hidden.add(n.id)
      for (const id of kids) hidden.add(id)
    }
  }
  return hidden
}
