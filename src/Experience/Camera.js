import * as THREE from 'three/webgpu'
import Experience from './Experience.js'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'

export default class Camera {
    constructor() {
        this.experience = new Experience()
        this.sizes = this.experience.sizes
        this.scene = this.experience.scene
        this.canvas = this.experience.canvas
        this.debug = this.experience.debug

        if (this.debug.active) {
            this.debugFolder = this.debug.ui.addFolder({
                title: 'Camera',
                expanded: true
            })
        }

        this.setCamera()
        this.setControls()

        console.log('Camera loaded')
    }

    setCamera() {
        this.params = {
            fov: 35,
            near: 0.1,
            far: 150,
            zoom: 1.5,
            lerpFactor: 0.08,
            isOrbit: false,
        }


        this.instance = new THREE.PerspectiveCamera(
            this.params.fov,
            this.sizes.width / this.sizes.height,
            this.params.near,
            this.params.far
        )
        this.instance.position.set(0, 8, 15)
        this.scene.add(this.instance)

    }

    updateProjection() {
        this.instance.updateProjectionMatrix()
    }

    setControls() {
        this.controls = new OrbitControls(this.instance, this.canvas)
        this.controls.enableDamping = true
        this.controls.enableRotate = true
        this.controls.enabled = true
    }

    resize() {
        this.instance.aspect = this.sizes.width / this.sizes.height
        this.instance.updateProjectionMatrix()
    }

    update() {
        this.controls.update()
    }

}
