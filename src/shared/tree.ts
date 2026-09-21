// 树结构的纯函数（目前用于"节点收展"的可见性计算）。
//
// ⚠️ 为什么放在 shared 而不是 renderer：
//   1. tsconfig.test.json 只把 core + shared 编译进 dist-test —— 放这里才能被 Node 单测直接覆盖，
//      不必拉起 Electron/浏览器；
//   2. 主进程与渲染端都可能用到同一套"谁该隐藏"的语义，放在一处才不会两边跑偏。

export interface CollapsibleNode {
  id: string
  parentId?: string | null
  collapsed?: boolean
}

type ChildrenMap = Map<string, string[]>

/** 一次遍历建好 parentId -> 子节点 id 列表，避免每个根节点重复扫全表。 */
function buildChildrenMap(nodes: CollapsibleNode[]): ChildrenMap {
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
export function collectDescendantIds(nodes: CollapsibleNode[], rootId: string): string[] {
  return walkDescendants(buildChildrenMap(nodes), rootId)
}

/**
 * 因"祖先被收起"而应当在画布上隐藏的节点 id 集合。
 *
 * 语义（与常见树控件一致）：
 *   - 节点 A 收起 ⇒ 隐藏 A 的**全部后代**，A 自身仍然可见（否则就没有东西可以点着展开了）；
 *   - 收起状态**可嵌套且各自独立**：A、B 都收起时取并集；
 *     "收起 A → 再展开 A"后，后代里原本自己就是收起的那些仍保持收起。
 */
export function collectHiddenIds(nodes: CollapsibleNode[]): Set<string> {
  const map = buildChildrenMap(nodes)
  const hidden = new Set<string>()
  for (const n of nodes) {
    if (!n.collapsed) continue
    for (const id of walkDescendants(map, n.id)) hidden.add(id)
  }
  return hidden
}
