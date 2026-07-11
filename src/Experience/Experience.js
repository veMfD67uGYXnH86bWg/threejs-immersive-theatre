import * as THREE from 'three/webgpu'

import Debug from './utils/Debug.js'
import Sizes from './utils/Sizes.js'
import Time from './utils/Time.js'
import Camera from './Camera.js'
import Renderer from './Renderer.js'
import World from './World/World.js'
import Resources from './utils/Resources.js'
import NetworkManager from './Network/NetworkManager.js'
import AudioManager from './Audio/AudioManager.js'
import UI from './UI/UI.js'

import sources from './sources.js'

let instance = null

export default class Experience {
    constructor(_canvas) {
        if (instance) {
            return instance
        }
        instance = this

        window.experience = this

        this.canvas = _canvas

        this.debug = new Debug()
        this.sizes = new Sizes()
        this.time = new Time()
        this.scene = new THREE.Scene()

        if (this.debug.active) {
            this.axesHelper = new THREE.AxesHelper(2)
            this.axesHelper.position.set(0, 0.1, 0)
            this.scene.add(this.axesHelper)
        }

        this.resources = new Resources(sources)
        this.network = new NetworkManager()
        this.camera = new Camera()
        this.audio = new AudioManager()
        this.renderer = new Renderer()
        this.world = new World()
        this.ui = new UI()


        this.sizes.on('resize', () => {
            this.resize()
        })

        this.renderer.instance.init().then(() => {
            this.time.on('tick', () => {
                this.update()
            })
        })

        console.log('Experience loaded')
    }

    resize() {
        this.camera.resize()
        this.renderer.resize()
    }

    update() {
        this.camera.update()
        this.world.update()
        this.renderer.update()
    }

    destroy() {
        this.sizes.off('resize')
        this.time.off('tick')

        this.scene.traverse((child) => {

            if (child instanceof THREE.Mesh) {
                child.geometry.dispose()

                for (const key in child.material) {
                    const value = child.material[key]

                    if (value && typeof value.dispose === 'function') {
                        value.dispose()
                    }
                }
            }
        })

        this.camera.controls.dispose()
        this.renderer.instance.dispose()
        this.network.socket.disconnect()

        if (this.debug.active)
            this.debug.ui.destroy()
    }
}