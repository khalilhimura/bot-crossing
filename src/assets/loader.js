import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { publicURL } from './bundles.js'

/** Each call parses fresh resources: previews and instances never share GPU ownership. */
export async function loadAsset(asset, renderer) {
  const failures = []
  const manager = new THREE.LoadingManager()
  manager.onError = (url) => failures.push(url)
  const draco = new DRACOLoader(manager).setDecoderPath(publicURL('decoders/draco/'))
  const ktx2 = new KTX2Loader(manager).setTranscoderPath(publicURL('decoders/basis/'))
  try {
    if (renderer) ktx2.detectSupport(renderer)
    const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
    if (renderer) loader.setKTX2Loader(ktx2)
    const url = asset.origin === 'bundled' ? publicURL(asset.url) : asset.url
    const gltf = await loader.loadAsync(url)
    try {
      await validateTextureResources(gltf, asset.selector)
      if (failures.length) throw new Error('A GLB texture/resource could not decode. Re-export with valid embedded textures and try again.')
    } catch (error) {
      createDisposer([...new Set([...(gltf.scenes ?? []), gltf.scene])].filter(Boolean))()
      throw error
    }
    return normalizeAsset(gltf, asset.selector)
  } finally {
    draco.dispose()
    ktx2.dispose()
  }
}

/** GLTFLoader resolves failed texture loads as null. Check only selected mesh materials,
 * including recognized material extensions, so unused texture declarations need not load.
 * getDependency reuses the parser's promise and also catches KTX2 transcoder failures that
 * do not necessarily reach LoadingManager.onError.
 */
export async function validateTextureResources(gltf, selector = null) {
  const parser = gltf.parser
  if (!parser) return
  const selected = selector == null ? gltf.scene : gltf.scene.children.find(node => node.name === selector)
  if (!selected) return // normalizeAsset reports missing selectors and disposes the source.
  const indices = new Set()
  const collect = (object) => {
    if (!object || typeof object !== 'object') return
    for (const [key, value] of Object.entries(object)) {
      if (key === 'extras' || key === 'extensions') continue
      if (key.endsWith('Texture') && Number.isInteger(value?.index)) indices.add(value.index)
      else if (value && typeof value === 'object') collect(value)
    }
  }
  selected.traverse(node => {
    if (!node.isMesh) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const index = parser.associations.get(material)?.materials
      const definition = parser.json.materials?.[index]
      collect(definition)
      for (const [extension, value] of Object.entries(definition?.extensions ?? {})) {
        if (parser.plugins[extension] || parser.extensions[extension]) collect(value)
      }
    }
  })
  const textures = await Promise.all([...indices].map(index => parser.getDependency('texture', index)))
  if (textures.some(texture => !texture)) {
    throw new Error('A GLB texture/resource could not decode. Re-export with valid embedded textures and try again.')
  }
}

/** Keep the authored hierarchy and transforms intact so animation bindings still resolve. */
export function normalizeAsset(gltf, selector = null) {
  const sourceRoots = [...new Set([...(gltf.scenes ?? []), gltf.scene])].filter(Boolean)
  const disposeSource = createDisposer(sourceRoots)
  try {
    const selected = selector == null ? gltf.scene : gltf.scene.children.find(node => node.name === selector)
    if (!selected) throw new Error(`Model selector not found: ${selector}`)
    selected.updateWorldMatrix(true, true)
    const root = new THREE.Group()
    // The GLTF scene has identity transform. Reparent only after preserving its local pose.
    const centered = new THREE.Group()
    centered.add(selected)
    root.add(centered)
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(selected, true)
    if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) {
      throw new Error('This GLB has no finite, visible geometry. Export a mesh and try again.')
    }
    const bounds = { min: box.min.toArray(), max: box.max.toArray() }
    const materials = new Set()
    let meshes = 0, triangles = 0
    selected.traverse(node => {
      if (!node.isMesh) return
      meshes++
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material) materials.add(material)
      const geometry = node.geometry
      const count = geometry.index?.count ?? geometry.attributes.position?.count ?? 0
      triangles += Math.floor(count / 3) * (node.isInstancedMesh ? node.count : 1)
      node.castShadow = true
      node.receiveShadow = true
    })
    if (!meshes) throw new Error('This GLB has no mesh to display.')
    centered.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
    root.updateMatrixWorld(true)
    // Capture before detachment, including unselected bundle resources, and selected itself.
    let disposed = false
    return {
      root, clips: gltf.animations ?? [], bounds,
      stats: { meshes, materials: materials.size, triangles },
      dispose() {
        if (disposed) return
        disposed = true
        root.removeFromParent()
        // source disposer captured all resources before selected was reparented.
        disposeSource()
        root.clear()
      },
    }
  } catch (error) {
    disposeSource()
    throw error
  }
}

function createDisposer(roots) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set(), images = new Set()
  for (const root of roots) root.traverse(node => {
    if (node.geometry) geometries.add(node.geometry)
    if (node.skeleton) skeletons.add(node.skeleton)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue
      materials.add(material)
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
    }
  })
  return () => {
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    for (const texture of textures) {
      texture.dispose()
      const data = texture.source?.data
      for (const image of Array.isArray(data) ? data : [data]) if (image?.close) images.add(image)
    }
    for (const skeleton of skeletons) skeleton.dispose()
    for (const image of images) image.close()
  }
}
