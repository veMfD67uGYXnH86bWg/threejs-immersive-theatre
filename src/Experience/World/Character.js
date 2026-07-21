import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

// The crowd pill this player occupies is about this tall (see
// Crowd.setBodies); used to float the name label above it
const BODY_HEIGHT = 0.55 + 0.28 * 2

/**
 * A seated player's overlay: a username label and positional emote audio.
 * The player's actual BODY is the crowd's own instanced pill at their seat
 * (Crowd reveals and recolours it on join), so it sways, hops on waves and
 * joins card stunts with the rest of the audience for free — this object
 * carries no mesh of its own.
 *
 * Keep the public surface (constructor(player, seatTransform), playEmote,
 * destroy) stable.
 */
export default class Character {
    constructor(player, seatTransform, {isSelf = false} = {}) {
        this.experience = new Experience()
        this.scene = this.experience.scene

        this.player = player
        this.seatTransform = seatTransform
        this.isSelf = isSelf

        this.setModel()
        this.setNameLabel()

        console.log(`Character loaded (${this.player.username})`)
    }

    setModel() {
        this.group = new THREE.Group()
        this.group.position.copy(this.seatTransform.position)
        this.group.rotation.y = this.seatTransform.rotationY

        this.scene.add(this.group)
    }

    setNameLabel() {
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 64

        const context = canvas.getContext('2d')
        context.fillStyle = 'rgba(0, 0, 0, 0.55)'
        context.beginPath()
        context.roundRect(0, 0, canvas.width, canvas.height, 16)
        context.fill()

        context.font = 'bold 30px sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillStyle = this.isSelf ? '#ffd166' : '#ffffff'
        context.fillText(this.player.username, canvas.width / 2, canvas.height / 2)

        this.labelTexture = new THREE.CanvasTexture(canvas)
        this.labelTexture.colorSpace = THREE.SRGBColorSpace

        const material = new THREE.SpriteMaterial({
            map: this.labelTexture,
            transparent: true,
        })

        this.label = new THREE.Sprite(material)
        this.label.scale.set(1.6, 0.4, 1)
        this.label.position.y = BODY_HEIGHT + 0.35
        this.group.add(this.label)
    }

    playEmote(emoteId) {
        this.playEmoteSound(emoteId)

        // Animation skeleton: once real character models with animation clips
        // are in, look up and play the matching AnimationAction here, e.g.
        //   this.animations[emoteId]?.reset().fadeIn(0.2).play()
        console.log(`[emote] ${this.player.username} plays "${emoteId}"`)
    }

    // Positional: the sound comes from this character's seat, panned and
    // attenuated relative to the camera (AudioManager owns the listener)
    playEmoteSound(emoteId) {
        const audio = this.experience.audio
        const buffer = audio.buffers.get(emoteId)

        if (!buffer || audio.muted)
            return

        audio.resumeContext()

        if (!this.emoteSound) {
            this.emoteSound = new THREE.PositionalAudio(audio.listener)
            this.emoteSound.setRefDistance(3)
            this.emoteSound.position.y = BODY_HEIGHT / 2
            this.group.add(this.emoteSound)
        }

        if (this.emoteSound.isPlaying)
            this.emoteSound.stop()

        this.emoteSound.setBuffer(buffer)
        this.emoteSound.play()
    }

    update() {
        // Will drive the AnimationMixer once characters are animated
    }

    destroy() {
        if (this.emoteSound?.isPlaying)
            this.emoteSound.stop()

        this.scene.remove(this.group)
        this.label.material.dispose()
        this.labelTexture.dispose()
    }
}
