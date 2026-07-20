import * as THREE from 'three/webgpu'
import Experience from './Experience.js'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import cameraViews from './cameraViews.js'

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
                expanded: false
            })
        }

        this.viewIndex = 0

        this.setCamera()
        this.setControls()

        console.log('Camera loaded')
    }

    // Steps through cameraViews.js, skipping views that can't resolve right
    // now (e.g. 'My seat' while not in a room). Returns the applied view.
    cycleView(direction) {
        const count = cameraViews.length

        for (let step = 1; step <= count; step++) {
            const index = (((this.viewIndex + direction * step) % count) + count) % count
            const view = cameraViews[index]

            if (this.applyView(view)) {
                this.viewIndex = index
                return view
            }
        }

        return cameraViews[this.viewIndex]
    }

    applyView(view) {
        const transform = this.resolveViewTransform(view)

        if (!transform)
            return false

        this.instance.position.set(...transform.position)
        this.controls.target.set(...transform.target)
        this.controls.update()

        return true
    }

    resolveViewTransform(view) {
        if (!view.seat)
            return {position: view.position, target: view.target}

        // Eye level above the player's own seat, looking at the stage
        const network = this.experience.network
        const theatreSeats = this.experience.world?.theatreSeats
        const player = network.players.get(network.selfId)

        if (!player || !theatreSeats)
            return null

        const seatPosition = theatreSeats.getSeatTransform(player.seatIndex).position

        return {
            position: [seatPosition.x, seatPosition.y + 1.05, seatPosition.z],
            target: [0, 1.5, -7],
        }
    }

    setCamera() {
        this.params = {
            fov: 35,
            near: 0.1,
            far: 400,
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

    setFov(fov) {
        this.params.fov = fov
        this.instance.fov = fov
        this.instance.updateProjectionMatrix()
    }

    setZoom(zoom) {
        this.params.zoom = zoom
        this.instance.zoom = zoom
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
