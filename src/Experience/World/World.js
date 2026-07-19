import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'
import Environment from './Environment.js'
import Terrain from './Terrain.js'
import Stage from './Stage.js'
// Swap back to './Stadium.js' for the old rectangular layout
import Stadium from './StadiumBowl.js'
import Crowd from './Crowd.js'
import TheatreSeats from './TheatreSeats.js'
import PlayerManager from './PlayerManager.js'
import ChatBubbles from './ChatBubbles.js'
import Dancer from './Dancer.js'

export default class World {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources

        this.resources.on('ready', () => {
            this.environment = new Environment()
            this.terrain = new Terrain()
            this.stage = new Stage()
            this.stadium = new Stadium()
            this.crowd = new Crowd()
            this.dancer = new Dancer()
            this.theatreSeats = new TheatreSeats()
            this.playerManager = new PlayerManager()
            this.chatBubbles = new ChatBubbles()
        })

        console.log('World loaded')
    }


    update() {
        if (this.environment)
            this.environment.update()

        if (this.playerManager)
            this.playerManager.update()

        if (this.chatBubbles)
            this.chatBubbles.update()

        if (this.crowd)
            this.crowd.update()

        if (this.dancer)
            this.dancer.update()
    }
}