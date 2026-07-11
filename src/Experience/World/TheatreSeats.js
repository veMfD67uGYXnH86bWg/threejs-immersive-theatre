import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

const SEAT_COUNT = 10
const SEATS_PER_ROW = 5
const SEAT_SPACING = 2.2
const ROW_SPACING = 2.2
const FIRST_ROW_Z = 1.5
const RISER_HEIGHT = 0.4

export default class TheatreSeats {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene

        this.seatTransforms = []

        this.setModel()

        console.log('TheatreSeats loaded')
    }

    setModel() {
        this.group = new THREE.Group()

        const baseGeometry = new THREE.BoxGeometry(0.9, 0.5, 0.9)
        const backrestGeometry = new THREE.BoxGeometry(0.9, 0.8, 0.18)
        const seatMaterial = new THREE.MeshStandardNodeMaterial({color: '#8b1e3f'})

        for (let seatIndex = 0; seatIndex < SEAT_COUNT; seatIndex++) {
            const row = Math.floor(seatIndex / SEATS_PER_ROW)
            const column = seatIndex % SEATS_PER_ROW

            const x = (column - (SEATS_PER_ROW - 1) / 2) * SEAT_SPACING
            const y = row * RISER_HEIGHT
            const z = FIRST_ROW_Z + row * ROW_SPACING

            const base = new THREE.Mesh(baseGeometry, seatMaterial)
            base.position.set(x, y + 0.25, z)
            base.castShadow = true
            base.receiveShadow = true
            this.group.add(base)

            const backrest = new THREE.Mesh(backrestGeometry, seatMaterial)
            backrest.position.set(x, y + 0.9, z + 0.36)
            backrest.castShadow = true
            backrest.receiveShadow = true
            this.group.add(backrest)

            // Characters sit on top of the base, facing the stage (-z)
            this.seatTransforms.push({
                position: new THREE.Vector3(x, y + 0.5, z),
                rotationY: Math.PI,
            })
        }

        // Riser under the back row
        const riserGeometry = new THREE.BoxGeometry(SEATS_PER_ROW * SEAT_SPACING + 1, RISER_HEIGHT, ROW_SPACING)
        const riserMaterial = new THREE.MeshStandardNodeMaterial({color: '#3a3a45'})
        this.riser = new THREE.Mesh(riserGeometry, riserMaterial)
        this.riser.position.set(0, RISER_HEIGHT / 2, FIRST_ROW_Z + ROW_SPACING)
        this.riser.receiveShadow = true
        this.group.add(this.riser)

        this.scene.add(this.group)
    }

    getSeatTransform(seatIndex) {
        return this.seatTransforms[seatIndex] ?? this.seatTransforms[0]
    }
}
