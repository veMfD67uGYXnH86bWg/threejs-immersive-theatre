import Experience from "../Experience.js";

export default class StageLights {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources

        this.setLights()

        console.log('StageLights loaded')
    }

    setLights() {

    }
}