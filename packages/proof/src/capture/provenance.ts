import {readdir,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join} from 'node:path'

export async function rendererSources(root: string) {
  const files = ['package.json','pnpm-lock.yaml','packages/proof/package.json','packages/engine/package.json','tsconfig.json','packages/proof/src/compare/style.ts']
  async function visit(directory: string) {
    for (const item of await readdir(join(root,directory), {withFileTypes:true})) {
      const file = join(directory,item.name)
      if(item.isDirectory()) await visit(file)
      else if(item.name.endsWith('.ts')) files.push(file)
    }
  }
  await visit('packages/proof/src/capture')
  await visit('packages/engine/src')
  const sources = await Promise.all(files.sort().map(async file => ({file,sha256:createHash('sha256').update(await readFile(join(root,file))).digest('hex')})))
  return {rendererSourceHash:createHash('sha256').update(JSON.stringify(sources)).digest('hex'),rendererSources:sources}
}
