import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

/**
 * First-draft stadium bowl around the existing theatre floor: a big dark
 * ground slab and three tiered stands (stage left/right + back). The crowd
 * (Crowd.js) seats its instanced people on these steps, so the layout
 * constants are shared from here.
 */

// yaw rotates the stand around the venue center; rows recede outward
export const STANDS = [
    {yaw: 0, start: 15, length: 64},             // behind the theatre seats
    {yaw: Math.PI / 2, start: 17, length: 46},   // stage right
    {yaw: -Math.PI / 2, start: 17, length: 46},  // stage left
]
export const STAND_ROWS = 14
export const STEP_HEIGHT = 0.7
export const STEP_DEPTH = 1.6

export default class Stadium {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene

        this.setGround()
        this.setStands()
        this.setAtmosphere()

        console.log('Stadium loaded')
    }

    setGround() {
        const geometry = new THREE.BoxGeometry(160, 0.2, 160)
        const material = new THREE.MeshStandardNodeMaterial({color: '#101016'})

        this.ground = new THREE.Mesh(geometry, material)
        this.ground.position.y = -0.11
        this.scene.add(this.ground)
    }

    setStands() {
        this.standsGroup = new THREE.Group()

        const material = new THREE.MeshStandardNodeMaterial({color: '#17171f'})

        for (const stand of STANDS) {
            const group = new THREE.Group()
            group.rotation.y = stand.yaw

            for (let row = 0; row < STAND_ROWS; row++) {
                // Full-height boxes so the bleachers read as solid from anywhere
                const height = (row + 1) * STEP_HEIGHT
                const geometry = new THREE.BoxGeometry(stand.length, height, STEP_DEPTH)

                const step = new THREE.Mesh(geometry, material)
                step.position.set(0, height / 2, stand.start + row * STEP_DEPTH + STEP_DEPTH / 2)
                group.add(step)
            }

            this.standsGroup.add(group)
        }

        this.scene.add(this.standsGroup)
    }

    setAtmosphere() {
        // Dark concert venue: fade the venue edges out instead of hard-cutting
        this.scene.fog = new THREE.Fog('#0f0d14', 60, 220)
        this.scene.background = new THREE.Color('#0f0d14')
    }
}
