import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'
import emotes from '../../../shared/emotes.js'

const MUTE_STORAGE_KEY = 'kpop-theatre-emote-sounds-muted'

/**
 * Owns the AudioListener (attached to the camera, so positional audio pans
 * and attenuates as the camera moves) and the loaded emote sound buffers.
 * Characters create their own PositionalAudio emitters from these.
 */
export default class AudioManager {
    constructor() {
        this.experience = new Experience()
        this.camera = this.experience.camera

        this.listener = new THREE.AudioListener()
        this.camera.instance.add(this.listener)

        this.muted = localStorage.getItem(MUTE_STORAGE_KEY) === '1'
        this.buffers = new Map()

        this.loadEmoteSounds()

        console.log('AudioManager loaded')
    }

    loadEmoteSounds() {
        const loader = new THREE.AudioLoader()

        for (const emote of emotes) {
            if (!emote.sound)
                continue

            loader.load(emote.sound, (buffer) => {
                this.buffers.set(emote.id, buffer)
            })
        }
    }

    setMuted(muted) {
        this.muted = muted
        localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0')
    }

    // Browsers keep the AudioContext suspended until a user gesture —
    // call before playing anything
    resumeContext() {
        if (this.listener.context.state === 'suspended')
            this.listener.context.resume()
    }
}
