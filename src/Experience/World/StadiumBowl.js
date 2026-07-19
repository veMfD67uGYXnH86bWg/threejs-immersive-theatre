import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

/**
 * Mitered stadium bowl — replaces Stadium.js (kept for reference; swap the
 * imports in World.js and Crowd.js to go back).
 *
 * Instead of three overlapping rectangles, every stand is a trapezoid whose
 * rows grow by exactly STEP_DEPTH per growing side per row. Because row N
 * sits at the same height in every stand, the stands meet along flush 45°
 * diagonal seams at the corners — nothing overlaps, nobody gets eaten.
 * With START_DISTANCE = BASE_LENGTH / 2 the seams close exactly.
 *
 * Geometry and crowd slots are generated from the same helpers in this one
 * file, so the architecture and the people can never disagree.
 */

export const ROWS = 28
export const STEP_HEIGHT = 0.7
export const STEP_DEPTH = 1.6
const PERSON_SPACING = 0.95
const START_DISTANCE = 16 // center -> front of row 0
const BASE_LENGTH = 32 // row 0 length; = 2 * START_DISTANCE for flush seams
const STAGE_CENTER = {x: 0, z: -7}

// growNeg/growPos: which local ends widen toward a corner (the back stand
// grows both ways, each side stand only toward its shared corner).
// extend: extra cells on the growing ends — exactly one stand at each
// corner must claim the diagonal cell of the seam, or a checkerboard of
// holes appears. The back stand claims both corners; giving the side
// stands extend: 1 instead (and the back 0) is the equivalent variant.
// swayMode: lightstick sway — even = side to side (world X), odd = front
// to back (world Z); modes >= 2 swing mirrored (half-period offset).
// 0: side | 1: front-back | 2: side mirrored | 3: front-back mirrored
const STANDS = [
    {yaw: 0, growNeg: 1, growPos: 1, extend: 1, swayMode: 3},             // behind the theatre seats
    {yaw: Math.PI / 2, growNeg: 1, growPos: 0, extend: 0, swayMode: 0},   // stage right
    {yaw: -Math.PI / 2, growNeg: 0, growPos: 1, extend: 0, swayMode: 2},  // stage left
]

// Local span of a stand's row: [negEnd, posEnd] along the stand's X axis
function rowSpan(stand, row) {
    const growth = (row + stand.extend) * STEP_DEPTH

    return {
        negEnd: -BASE_LENGTH / 2 - stand.growNeg * growth,
        posEnd: BASE_LENGTH / 2 + stand.growPos * growth,
    }
}

// One slot per person, every field Crowd.js expects. Deterministic jitter
// so every client builds the identical crowd.
export function buildCrowdSlots() {
    const slots = []

    let seed = 1
    const random = () => {
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647
    }

    for (const stand of STANDS) {
        const cos = Math.cos(stand.yaw)
        const sin = Math.sin(stand.yaw)

        for (let row = 0; row < ROWS; row++) {
            const {negEnd, posEnd} = rowSpan(stand, row)
            const span = posEnd - negEnd
            const count = Math.floor(span / PERSON_SPACING)
            const margin = (span - count * PERSON_SPACING) / 2 + PERSON_SPACING / 2

            const localZ = START_DISTANCE + row * STEP_DEPTH + STEP_DEPTH * 0.6
            const y = (row + 1) * STEP_HEIGHT

            for (let i = 0; i < count; i++) {
                const baseLocalX = negEnd + margin + i * PERSON_SPACING
                const jitterLocalX = (random() - 0.5) * 0.35

                // Rotate the stand-local position by the stand's yaw. Base
                // (grid-perfect) and jitter kept separate so the crowd's
                // scatter can be dialed live in the debug panel — one stick
                // per pixel reads sharper on the image display when tight.
                const x = cos * baseLocalX + sin * localZ
                const z = -sin * baseLocalX + cos * localZ
                const jitterVec = new THREE.Vector3(cos * jitterLocalX, 0, -sin * jitterLocalX)
                const position = new THREE.Vector3(x, y, z).add(jitterVec)

                slots.push({
                    position,
                    positionBase: new THREE.Vector3(x, y, z),
                    jitterVec,
                    facing: Math.atan2(STAGE_CENTER.x - x, STAGE_CENTER.z - z),
                    scale: 0.85 + random() * 0.25,
                    distance: Math.hypot(x - STAGE_CENTER.x, z - STAGE_CENTER.z),
                    angle: Math.atan2(x - STAGE_CENTER.x, z - STAGE_CENTER.z),
                    // Grid coords centered on the row — the crowd display
                    // maps one person to one image pixel
                    col: i - (count - 1) / 2,
                    row: row - (ROWS - 1) / 2,
                    swayMode: stand.swayMode,
                })
            }
        }
    }

    return slots
}

export default class StadiumBowl {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene

        this.setGround()
        this.setStands()
        this.setAtmosphere()

        console.log('StadiumBowl loaded')
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

            for (let row = 0; row < ROWS; row++) {
                const {negEnd, posEnd} = rowSpan(stand, row)

                // Full-height boxes so the bleachers read as solid; each
                // row's length follows the miter, so corners meet cleanly
                const height = (row + 1) * STEP_HEIGHT
                const geometry = new THREE.BoxGeometry(posEnd - negEnd, height, STEP_DEPTH)

                const step = new THREE.Mesh(geometry, material)
                step.position.set(
                    (negEnd + posEnd) / 2,
                    height / 2,
                    START_DISTANCE + row * STEP_DEPTH + STEP_DEPTH / 2,
                )
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
