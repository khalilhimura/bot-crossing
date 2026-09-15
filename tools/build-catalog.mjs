import { NodeIO } from '@gltf-transform/core'
import { getBounds, getGLPrimitiveCount } from '@gltf-transform/functions'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { BUNDLES } from '../src/assets/bundles.js'

export async function generateCatalog() {
  const catalog = []
  const io = new NodeIO()
  for (const [key, bundle] of Object.entries(BUNDLES)) {
    const file = new URL(`../public/assets/${bundle.file}`, import.meta.url)
    const bytes = await readFile(file)
    const doc = await io.readBinary(bytes)
    const scene = doc.getRoot().getDefaultScene()
    if (!scene) throw new Error(`Missing default scene: ${bundle.file}`)
    const selections = key === 'crew' ? [scene] : scene.listChildren()
    const names = new Set()
    for (const node of selections) {
      const selector = key === 'crew' ? null : node.getName()
      if (selector !== null && (!selector || names.has(selector))) throw new Error(`Ambiguous selector in ${bundle.file}: ${selector}`)
      names.add(selector)
      let meshes = 0, triangles = 0
      const materials = new Set()
      node.traverse(n => {
        const mesh = n.getMesh()
        if (!mesh) return
        for (const primitive of mesh.listPrimitives()) {
          meshes++
          if (primitive.getMaterial()) materials.add(primitive.getMaterial())
          if ([4, 5, 6].includes(primitive.getMode())) triangles += getGLPrimitiveCount(primitive)
        }
      })
      catalog.push({
        id: key === 'crew' ? 'bundled:crew' : `bundled:${key}:${selector}`,
        name: selector?.replaceAll('_', ' ') ?? 'KayKit Crew',
        category: bundle.category, origin: 'bundled', url: `/assets/${bundle.file}`,
        selector, hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength,
        source: bundle.source, creator: 'Kay Lousberg', license: 'CC0 1.0',
        animations: doc.getRoot().listAnimations().map(a => a.getName()),
        stats: { meshes, materials: materials.size, triangles }, bounds: getBounds(node), status: 'ready',
      })
    }
  }
  return catalog
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const catalog = await generateCatalog()
  await writeFile(new URL('../public/assets/catalog.json', import.meta.url), `${JSON.stringify(catalog, null, 2)}\n`)
  console.log(`Asset catalog: ${catalog.length} bundled models`)
}
