/** One source of bundle paths and attribution for the catalog and legacy renderer. */
export const BUNDLES = Object.freeze({
  base: { file: 'spacebase.glb', category: 'Buildings', source: 'https://kaylousberg.itch.io/space-base-bits' },
  forest: { file: 'forest.glb', category: 'Nature', source: 'https://kaylousberg.itch.io/kaykit-forest' },
  crew: { file: 'crew.glb', category: 'Characters', source: 'https://kaylousberg.itch.io/kaykit-character-animations' },
})

export function publicURL(path) {
  return `${import.meta.env?.BASE_URL ?? '/'}${path.replace(/^\//, '')}`
}

export function bundleURL(key) {
  if (!BUNDLES[key]) throw new Error(`Unknown bundle: ${key}`)
  return publicURL(`assets/${BUNDLES[key].file}`)
}
