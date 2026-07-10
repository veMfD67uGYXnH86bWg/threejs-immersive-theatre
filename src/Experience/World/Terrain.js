import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

export default class Terrain {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources

        this.debug = this.experience.debug

        if (this.debug.active) {
            this.debugFolder = this.debug.ui.addFolder(
                {
                    title: `Terrain`,
                    expanded: true,
                })
        }

        // this.setTextures()
        this.setModel()

        console.log('Terrain loaded')
    }

    setWrapColorSpace(texture) {
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.RepeatWrapping
        texture.colorSpace = THREE.SRGBColorSpace
    }


    setTextures() {
    }

    setModel() {
        const geometry = new THREE.PlaneGeometry(20, 20)
        const material = new THREE.MeshStandardNodeMaterial({
            color: 'cornflowerblue'
        })

        this.model = new THREE.Mesh(geometry, material)
        this.model.rotation.x = -Math.PI / 2
        this.model.position.set(0, 0, 0)
        this.scene.add(this.model)

        this.model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.receiveShadow = true
            }
        })
    }
}