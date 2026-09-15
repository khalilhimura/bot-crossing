export const MAX_GLB_BYTES = 50 * 1024 * 1024
export function assetError(message, status = 400) {
  return Object.assign(new Error(message), { status })
}
const supported = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_meshopt_compression',
  'EXT_materials_bump',
  'KHR_texture_basisu',
  'KHR_materials_unlit',
  'KHR_materials_clearcoat',
  'KHR_materials_sheen',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
  'KHR_materials_dispersion',
  'KHR_materials_emissive_strength',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'KHR_lights_punctual',
  'EXT_mesh_gpu_instancing',
  'EXT_texture_webp',
  'EXT_texture_avif',
])
/** Structural gate only: the browser must also parse/render before finalizing. */
export function validateGlb(bytes) {
  const fail = (message) => {
    throw assetError(message)
  }
  if (!Buffer.isBuffer(bytes) || bytes.length < 20)
    fail('Invalid or truncated GLB header')
  if (bytes.length > MAX_GLB_BYTES)
    throw assetError('GLB exceeds the 50 MiB limit', 413)
  if (
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    fail('Expected a complete glTF 2 GLB file')
  let offset = 12,
    json,
    binLength = 0,
    count = 0,
    hasBin = false
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail('Truncated GLB chunk header')
    const length = bytes.readUInt32LE(offset),
      type = bytes.readUInt32LE(offset + 4)
    offset += 8
    if (length % 4 || offset + length > bytes.length)
      fail('Invalid GLB chunk length')
    if (count === 0 && type !== 0x4e4f534a) fail('First GLB chunk must be JSON')
    if (type === 0x4e4f534a) {
      if (json) fail('Duplicate JSON chunk')
      try {
        json = JSON.parse(
          bytes.subarray(offset, offset + length).toString('utf8'),
        )
      } catch {
        fail('Invalid GLB JSON')
      }
    }
    if (type === 0x004e4942) {
      if (hasBin) fail('Duplicate binary chunk')
      hasBin = true
      binLength = length
    }
    offset += length
    count++
  }
  if (!json || json.asset?.version !== '2.0')
    fail('GLB must declare glTF version 2.0')
  if (
    json.extensionsRequired !== undefined &&
    !Array.isArray(json.extensionsRequired)
  )
    fail('Invalid required extensions')
  for (const extension of json.extensionsRequired || [])
    if (!supported.has(extension))
      fail(`Unsupported required extension: ${extension}`)
  for (const key of ['buffers', 'images', 'bufferViews', 'nodes', 'scenes'])
    if (json[key] !== undefined && !Array.isArray(json[key]))
      fail(`Invalid ${key}`)
  for (const resource of [...(json.buffers || []), ...(json.images || [])]) {
    if (!resource || typeof resource !== 'object') fail('Invalid resource')
    if (
      resource.uri !== undefined &&
      (typeof resource.uri !== 'string' ||
        !/^data:[^,]*;base64,[a-z\d+/=\s]*$/i.test(resource.uri))
    )
      fail(
        'Export a self-contained GLB: external and relative resource references are unsupported',
      )
  }
  for (const [index, buffer] of (json.buffers || []).entries()) {
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0)
      fail('Invalid buffer length')
    if (
      buffer.uri === undefined &&
      (index !== 0 ||
        !hasBin ||
        buffer.byteLength > binLength ||
        binLength - buffer.byteLength > 3)
    )
      fail('Missing or invalid embedded binary buffer')
  }
  for (const view of json.bufferViews || []) {
    const buffer = json.buffers?.[view.buffer]
    const start = view.byteOffset ?? 0
    if (
      !buffer ||
      !Number.isSafeInteger(start) ||
      start < 0 ||
      !Number.isSafeInteger(view.byteLength) ||
      view.byteLength < 0 ||
      start + view.byteLength > buffer.byteLength
    )
      fail('Invalid buffer view range')
  }
  for (const image of json.images || [])
    if (image.uri === undefined && !json.bufferViews?.[image.bufferView])
      fail('Missing embedded image buffer view')
  const nodes = json.nodes || [],
    scenes = json.scenes || []
  if (
    !scenes.length ||
    !scenes[json.scene ?? 0] ||
    !scenes[json.scene ?? 0].nodes?.length
  )
    fail('GLB needs a non-empty default scene')
  const validNode = (n) => Number.isSafeInteger(n) && n >= 0 && n < nodes.length
  for (const scene of scenes)
    if (
      !scene ||
      (scene.nodes !== undefined &&
        (!Array.isArray(scene.nodes) || scene.nodes.some((n) => !validNode(n))))
    )
      fail('Invalid scene node reference')
  for (const node of nodes)
    if (
      !node ||
      (node.children !== undefined &&
        (!Array.isArray(node.children) ||
          node.children.some((n) => !validNode(n))))
    )
      fail('Invalid child node reference')
  const visiting = new Set(),
    visited = new Set()
  function walk(n) {
    if (visiting.has(n)) fail('Cyclic scene node graph')
    if (visited.has(n)) return
    visiting.add(n)
    for (const child of nodes[n].children || []) walk(child)
    visiting.delete(n)
    visited.add(n)
  }
  for (let n = 0; n < nodes.length; n++) walk(n)
  return json
}
