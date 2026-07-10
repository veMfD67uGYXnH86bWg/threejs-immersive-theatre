import * as THREE from 'three/webgpu'
import Stats from 'stats-gl'
import Experience from './Experience.js'

const toneMappingOptions = {
    None: THREE.NoToneMapping,
    Linear: THREE.LinearToneMapping,
    Reinhard: THREE.ReinhardToneMapping,
    Cineon: THREE.CineonToneMapping,
    ACESFilmic: THREE.ACESFilmicToneMapping,
    AgX: THREE.AgXToneMapping,
    Neutral: THREE.NeutralToneMapping
}

export default class Renderer {
    constructor() {
        this.experience = new Experience()
        this.canvas = this.experience.canvas
        this.sizes = this.experience.sizes
        this.scene = this.experience.scene
        this.camera = this.experience.camera
        this.debug = this.experience.debug
        this.params = {
            exposure: 1.75
        }

        if (this.debug.active) {
            this.rendererFolder = this.debug.ui.addFolder({
                title: 'Renderer',
                expanded: true
            })
        }

        this.setInstance()

        console.log('Renderer loaded')
    }

    setInstance() {
        this.instance = new THREE.WebGPURenderer({
            canvas: this.canvas,
            antialias: true
        })

        this.instance.toneMapping = THREE.CineonToneMapping
        this.instance.toneMappingExposure = this.params.exposure

        this.instance.setClearColor('#211d20')
        this.instance.setSize(this.sizes.width, this.sizes.height)
        this.instance.setPixelRatio(this.sizes.pixelRatio)

        this.instance.shadowMap.enabled = true
        this.instance.shadowMap.type = THREE.PCFSoftShadowMap

        if (this.debug.active) {
            this.stats = new Stats({trackGPU: true})
            document.body.appendChild(this.stats.dom)
            this.stats.init(this.instance)
        }

        if (this.debug.active) {
            this.rendererFolder.addBlade({
                view: 'list',
                label: 'Tone Mapping',
                options: [
                    {text: 'None', value: toneMappingOptions.None},
                    {text: 'Linear', value: toneMappingOptions.Linear},
                    {text: 'Reinhard', value: toneMappingOptions.Reinhard},
                    {text: 'Cineon', value: toneMappingOptions.Cineon},
                    {text: 'ACESFilmic', value: toneMappingOptions.ACESFilmic},
                    {text: 'AgX', value: toneMappingOptions.AgX},
                    {text: 'Neutral', value: toneMappingOptions.Neutral},
                ],
                value: toneMappingOptions.Cineon,
            }).on('change', (e) => {
                this.instance.toneMapping = e.value
            })
            this.rendererFolder.addBinding(this.params, 'exposure', {
                label: 'Exposure',
                min: 0,
                max: 5,
                step: 0.05,
            }).on('change', (e) => {
                this.instance.toneMappingExposure = e.value
            })
        }
    }

    resize() {
        this.instance.setSize(this.sizes.width, this.sizes.height)
        this.instance.setPixelRatio(this.sizes.pixelRatio)
    }

    update() {
        this.instance.render(this.scene, this.camera.instance)
        // this.renderPipeline.render()
        if (this.debug.active) {
            this.instance.resolveTimestampsAsync()
            this.stats.update()
        }

    }
}