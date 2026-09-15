import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { loadAsset } from './loader.js'

/** One preview owns its resources; it never borrows a live world's materials or skeleton. */
export class AssetPreview {
  constructor(container) {
    this.container = container
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#232832')
    this.scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x686060, 2.6))
    const light = new THREE.DirectionalLight(0xffeee0, 3)
    light.position.set(4, 7, 5)
    this.scene.add(light)
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.001, 10000)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.domElement.setAttribute('aria-label', '3D asset preview. Drag to orbit, scroll to zoom.')
    this.renderer.domElement.tabIndex = 0
    container.append(this.renderer.domElement)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.addEventListener('change', () => this.draw())
    this.renderer.domElement.addEventListener('keydown', (event) => {
      const offset = this.camera.position.clone().sub(this.controls.target)
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), event.key === 'ArrowLeft' ? -.2 : .2)
      else if (event.key === '+' || event.key === '=') offset.multiplyScalar(.85)
      else if (event.key === '-') offset.multiplyScalar(1.15)
      else return
      event.preventDefault()
      this.camera.position.copy(this.controls.target).add(offset)
      this.controls.update()
    })
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.token = 0
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect()
    if (!width || !height) return
    this.renderer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.draw()
  }

  async show(asset) {
    this.clear()
    const token = this.token
    const loaded = await loadAsset(asset, this.renderer)
    if (token !== this.token) { loaded.dispose(); return null }
    this.loaded = loaded
    this.scene.add(loaded.root)
    this.mixer = new THREE.AnimationMixer(loaded.root)
    const box = new THREE.Box3().setFromObject(loaded.root)
    const size = box.getSize(new THREE.Vector3()).length()
    const center = box.getCenter(new THREE.Vector3())
    this.controls.target.copy(center)
    this.camera.position.copy(center).add(new THREE.Vector3(.8, .55, 1).normalize().multiplyScalar(Math.max(size, .01) * 1.65))
    this.camera.near = Math.max(size / 10000, .00001)
    this.camera.far = Math.max(size * 100, 100)
    this.controls.minDistance = Math.max(size / 100, .0001)
    this.controls.maxDistance = Math.max(size * 10, 10)
    this.controls.update()
    this.resize()
    this.last = performance.now()
    this.tick()
    return loaded
  }

  play(name) {
    this.mixer?.stopAllAction()
    const clip = this.loaded?.clips.find((clip) => clip.name === name)
    if (clip) this.mixer.clipAction(clip).reset().play()
    else this.mixer?.update(0)
    this.draw()
  }

  tick = () => {
    if (!this.loaded) return
    const now = performance.now()
    if (!document.hidden) {
      this.mixer?.update(Math.min((now - this.last) / 1000, .05))
      this.controls.update()
      this.draw()
    }
    this.last = now
    this.frame = requestAnimationFrame(this.tick)
  }

  draw() { this.renderer.render(this.scene, this.camera) }

  clear() {
    this.token++
    cancelAnimationFrame(this.frame)
    if (this.loaded) {
      this.mixer?.stopAllAction()
      this.mixer?.uncacheRoot(this.loaded.root)
      this.scene.remove(this.loaded.root)
      this.loaded.dispose()
    }
    this.loaded = this.mixer = null
  }

  dispose() {
    this.clear()
    this.observer.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
