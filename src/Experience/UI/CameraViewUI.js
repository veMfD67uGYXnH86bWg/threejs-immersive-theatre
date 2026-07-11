import Experience from '../Experience.js'
import cameraViews from '../cameraViews.js'

export default class CameraViewUI {
    constructor() {
        this.experience = new Experience()
        this.camera = this.experience.camera

        this.nameElement = document.getElementById('camera-view-name')
        this.nameElement.textContent = cameraViews[0].name

        document.getElementById('camera-prev').addEventListener('click', () => this.cycle(-1))
        document.getElementById('camera-next').addEventListener('click', () => this.cycle(1))

        this.setSliders()

        console.log('CameraViewUI loaded')
    }

    setSliders() {
        this.fovSlider = document.getElementById('camera-fov')
        this.zoomSlider = document.getElementById('camera-zoom')

        // Current camera state is the source of truth for initial values
        this.fovSlider.value = this.camera.instance.fov
        this.zoomSlider.value = this.camera.instance.zoom

        this.fovSlider.addEventListener('input', () => {
            this.camera.setFov(Number(this.fovSlider.value))
        })

        this.zoomSlider.addEventListener('input', () => {
            this.camera.setZoom(Number(this.zoomSlider.value))
        })
    }

    cycle(direction) {
        const view = this.camera.cycleView(direction)
        this.nameElement.textContent = view.name
    }
}
