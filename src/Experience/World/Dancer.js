import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

/**
 * Placeholder dancer driven by the room's synced dance state.
 *
 * While a song plays, the pose is a PURE function of `trackTime` (seconds
 * into the song), never of local frame time — that invariant is what keeps
 * every client, including late joiners, perfectly in sync. During the
 * voting phase the dancer idles.
 *
 * Swapping in the real Blender dances later:
 *   1. Load the GLB, create an AnimationMixer + one AnimationAction per clip
 *   2. Replace the motions map: play the action matching dance.songId
 *      and drive it with `mixer.setTime(trackTime % clip.duration)`
 *   3. Keep durations in shared/songs.js equal to the clip durations
 */

// Scripted placeholder motions; real ones will be keyed by songId
const motions = [
    (trackTime, figure) => {
        figure.position.x = Math.sin(trackTime * 1.25) * 1.5
        figure.position.y = Math.abs(Math.sin(trackTime * 5)) * 0.4
        figure.rotation.y = trackTime * 2
        figure.rotation.z = 0
    },
    (trackTime, figure) => {
        figure.position.x = Math.sin(trackTime * 1.5) * 1.8
        figure.position.y = Math.abs(Math.sin(trackTime * 3)) * 0.15
        figure.rotation.y = Math.sin(trackTime * 1.5) * 0.6
        figure.rotation.z = Math.sin(trackTime * 3) * 0.15
    },
]

const idleMotion = (time, figure) => {
    figure.position.x = 0
    figure.position.y = 0
    figure.rotation.y = Math.sin(time) * 0.3
    figure.rotation.z = 0
}

// Stable motion per song until real animations exist
function motionForSong(songId) {
    let hash = 0

    for (let i = 0; i < songId.length; i++)
        hash = (hash + songId.charCodeAt(i)) | 0

    return motions[Math.abs(hash) % motions.length]
}

export default class Dancer {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.network = this.experience.network

        this.setModel()

        console.log('Dancer loaded')
    }

    setModel() {
        // Anchored to the stage top; the figure moves relative to it
        this.group = new THREE.Group()
        this.group.position.set(0, 0.6, -7)

        this.figure = new THREE.Group()

        const bodyGeometry = new THREE.CapsuleGeometry(0.35, 0.7, 8, 16)
        const bodyMaterial = new THREE.MeshStandardNodeMaterial({
            color: '#e8e6f0',
            emissive: '#ff2d95',
            emissiveIntensity: 0.15,
        })
        this.body = new THREE.Mesh(bodyGeometry, bodyMaterial)
        this.body.position.y = 0.7
        this.body.castShadow = true
        this.figure.add(this.body)

        const headGeometry = new THREE.SphereGeometry(0.22, 24, 12)
        this.head = new THREE.Mesh(headGeometry, bodyMaterial)
        this.head.position.y = 1.5
        this.head.castShadow = true
        this.figure.add(this.head)

        this.group.add(this.figure)
        this.scene.add(this.group)
    }

    update() {
        const dance = this.network.dance
        const serverNow = this.network.serverClock.now()

        // The 'preparing' phase (5s between vote and song) idles for now —
        // it's the hook for a stage-transition/scenery-swap animation later
        if (!dance || dance.phase !== 'playing') {
            idleMotion(serverNow / 1000, this.figure)
            return
        }

        const trackTime = Math.max(0, (serverNow - dance.startedAt) / 1000)

        motionForSong(dance.songId)(trackTime, this.figure)
    }
}
