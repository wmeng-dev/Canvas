// 主进程应用服务：把存储仓储 + 生成器注册表组装成一个可复用的服务对象。
// 纯 Node（不 import electron），便于单测；dataDir 由主进程注入（userData/diverge）。

import { JsonStore } from './storage/store'
import { ProjectRepository } from './storage/repositories'
import { GeneratorRegistry } from './generator/types'
import { DeepSeekGenerator } from './generator/direct/deepseek'
import { createFakeGenerator } from './generator/fake'
import type { ProjectFile } from '../shared/types'

export interface AppServices {
  repo: ProjectRepository
  registry: GeneratorRegistry
  defaultGeneratorId: string
  dataDir: string
}

export interface CreateServicesOptions {
  dataDir: string
  /** 提供则注册 DeepSeek 直连 */
  deepseekApiKey?: string
  /** 提供则注册本地占位生成器（无 key 环境/测试用） */
  fakeGenerator?: boolean
}

export function createServices(opts: CreateServicesOptions): AppServices {
  const repo = new ProjectRepository(new JsonStore({ baseDir: opts.dataDir }))
  const registry = new GeneratorRegistry()
  let defaultGeneratorId = ''

  if (opts.deepseekApiKey) {
    const ds = new DeepSeekGenerator({ apiKey: opts.deepseekApiKey })
    registry.register(ds)
    defaultGeneratorId = ds.id
  }
  if (opts.fakeGenerator) {
    const fake = createFakeGenerator()
    registry.register(fake)
    if (!defaultGeneratorId) defaultGeneratorId = fake.id
  }

  return { repo, registry, defaultGeneratorId, dataDir: opts.dataDir }
}

/** 返回第一个项目；没有则创建一个带根节点的项目。 */
export function ensureProject(svc: AppServices): ProjectFile {
  const list = svc.repo.list()
  if (list.length > 0) return svc.repo.get(list[0].id)

  const file = svc.repo.create('我的创意')
  svc.repo.addNode(file.project.id, {
    label: '创意主题',
    prompt: '',
    status: 'empty',
    position: { x: 0, y: 0 },
  })
  return svc.repo.get(file.project.id)
}
