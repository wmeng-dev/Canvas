// 受限并发执行：用于"一次发散 N 条"时限制同时打给后端的请求数，
// 既避免瞬时打爆 API 配额，又比串行快。返回结果与输入顺序一一对应。

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const workerCount = Math.max(1, Math.min(limit, items.length))
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

/** 与 mapWithConcurrency 相同调度，但单项失败不会中断整批（返回已决结果）。 */
export async function mapWithConcurrencySettled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: string; index: number }>> {
  const results = new Array<{ ok: true; value: R } | { ok: false; error: string; index: number }>(
    items.length,
  )
  const workerCount = Math.max(1, Math.min(limit, items.length))
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = { ok: true, value: await fn(items[i], i) }
      } catch (e) {
        results[i] = { ok: false, error: (e as Error).message, index: i }
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}
