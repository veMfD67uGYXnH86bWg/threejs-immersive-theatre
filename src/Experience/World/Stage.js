import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

export default class Stage {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene

        this.setModel()

        console.log('Stage loaded')
    }

    setModel() {
        this.group = new THREE.Group()

        // Platform
        const platformGeometry = new THREE.BoxGeometry(12, 0.6, 5)
        const platformMaterial = new THREE.MeshStandardNodeMaterial({color: '#2a2a35'})
        this.platform = new THREE.Mesh(platformGeometry, platformMaterial)
        this.platform.position.set(0, 0.3, -7)
        this.platform.receiveShadow = true
        this.group.add(this.platform)

        // Back wall
        const wallGeometry = new THREE.BoxGeometry(12, 6, 0.3)
        const wallMaterial = new THREE.MeshStandardNodeMaterial({color: '#1a1a24'})
        this.backWall = new THREE.Mesh(wallGeometry, wallMaterial)
        this.backWall.position.set(0, 3, -9.35)
        this.backWall.receiveShadow = true
        this.group.add(this.backWall)

        // Neon strip along the stage front
        const stripGeometry = new THREE.BoxGeometry(12, 0.08, 0.08)
        const stripMaterial = new THREE.MeshStandardNodeMaterial({
            color: '#ff2d95',
            emissive: '#ff2d95',
            emissiveIntensity: 2,
        })
        this.strip = new THREE.Mesh(stripGeometry, stripMaterial)
        this.strip.position.set(0, 0.62, -4.52)
        this.group.add(this.strip)

        this.scene.add(this.group)

        // TODO: the dancer(s) will live here, driven by the dance playback clock
    }
}
