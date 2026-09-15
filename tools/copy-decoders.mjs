import { copyFile, mkdir } from 'node:fs/promises'
const sources = {
  draco: ['draco/gltf', ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']],
  basis: ['basis', ['basis_transcoder.js', 'basis_transcoder.wasm']],
}
for (const [destination, [source, files]] of Object.entries(sources)) {
  const target = new URL(`../public/decoders/${destination}/`, import.meta.url)
  await mkdir(target, { recursive: true })
  for (const file of files) await copyFile(new URL(`../node_modules/three/examples/jsm/libs/${source}/${file}`, import.meta.url), new URL(file, target))
}
console.log('Local Draco and Basis decoders ready')
