import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'
import Environment from './Environment.js'
import Terrain from './Terrain.js'

export default class World {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources

        this.resources.on('ready', () => {
            this.environment = new Environment()
            this.terrain = new Terrain()
            this.characters = new Characters()
            this.chatBubbles = new ChatBubbles()
        })

        console.log('World loaded')
    }


    update() {
        if (this.environment)
            this.environment.update()

        if (this.characters)
            this.characters.update()

        if (this.chatBubbles)
            this.chatBubbles.update()
    }
}