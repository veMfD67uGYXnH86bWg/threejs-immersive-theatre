import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

export default class Environment {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources
        this.debug = this.experience.debug

        if (this.debug.active) {
            this.debugFolder = this.debug.ui.addFolder(
                {
                    title: 'Environment',
                    expanded: true,
                })
        }

        this.setSunLight()
        this.setAmbientLight()
        this.setEnvironmentMap()

        console.log('Environment loaded')
    }

    setSunLight() {
        this.sunLight = new THREE.DirectionalLight('#ffffff', 4.0)
        this.sunLight.castShadow = true
        this.sunLight.shadow.camera.near = 0.1
        this.sunLight.shadow.camera.far = 30
        this.sunLight.shadow.mapSize.set(1024, 1024)
        this.sunLight.shadow.normalBias = 0.05
        this.scene.add(this.sunLight)

        this.shadowHelper = new THREE.CameraHelper(this.sunLight.shadow.camera)
        this.scene.add(this.shadowHelper)
        this.shadowHelper.visible = false
        this.sunLight.shadow.camera.top = 10
        this.sunLight.shadow.camera.bottom = -7.2
        this.sunLight.shadow.camera.left = -11
        this.sunLight.shadow.camera.right = 18
    }

    setAmbientLight() {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0)
        this.scene.add(this.ambientLight)
    }

    setEnvironmentMap() {
        this.environmentMap = {}
        this.environmentMap.intensity = 0.4
        this.environmentMap.texture = this.resources.items.environmentMapTexture
        this.environmentMap.texture.colorSpace = THREE.SRGBColorSpace

        this.scene.environment = this.environmentMap.texture

        this.environmentMap.updateMaterials = () => {
            this.scene.traverse((child) => {
                if (child instanceof THREE.Mesh &&
                    (child.material instanceof THREE.MeshStandardMaterial ||
                        child.material instanceof THREE.MeshStandardNodeMaterial)) {
                    child.material.envMap = this.environmentMap.texture
                    child.material.envMapIntensity = this.environmentMap.intensity
                    child.material.needsUpdate = true
                }
            })
        }
        this.environmentMap.updateMaterials()

        if (this.debug.active) {
            this.envMapFolder = this.debugFolder.addFolder({title: 'Environment Map'})
            this.envMapFolder.addBinding(this.environmentMap, 'intensity', {
                label: 'Intensity',
                min: 0,
                max: 4,
                step: 0.001,
            }).on('change', () => this.environmentMap.updateMaterials())
        }
    }

    update() {
    }
}