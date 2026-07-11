import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'
import stringToColor from '../utils/stringToColor.js'
import songs from '../../../shared/songs.js'

const SPHERE_RADIUS = 0.35
const IDLE_TEMPO = 90 // sway BPM while no song is playing
const SWING_AMPLITUDE = 0.45 // radians

/**
 * Placeholder character: a colored sphere with a username label.
 * Will be replaced by a customizable rigged model later — keep the public
 * surface (constructor(player, seatTransform), playEmote, destroy) stable.
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
        this.setLightstick()

        console.log(`Character loaded (${this.player.username})`)
    }

    setModel() {
        this.group = new THREE.Group()
        this.group.position.copy(this.seatTransform.position)
        this.group.rotation.y = this.seatTransform.rotationY

        const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 32, 16)
        const material = new THREE.MeshStandardNodeMaterial({
            color: stringToColor(this.player.username + this.player.id),
        })

        this.body = new THREE.Mesh(geometry, material)
        this.body.position.y = SPHERE_RADIUS
        this.body.castShadow = true
        this.group.add(this.body)

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
        this.label.position.y = SPHERE_RADIUS * 2 + 0.45
        this.group.add(this.label)
    }

    // Held to the side of the sphere, tip glowing in the character's color;
    // hidden until the player toggles it (lightstick emote)
    setLightstick() {
        this.lightstickPivot = new THREE.Group()
        this.lightstickPivot.position.set(SPHERE_RADIUS + 0.08, SPHERE_RADIUS, 0)
        this.lightstickPivot.visible = this.player.lightstick === true

        const handleGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.28)
        const handleMaterial = new THREE.MeshStandardNodeMaterial({color: '#222228'})
        const handle = new THREE.Mesh(handleGeometry, handleMaterial)
        handle.position.y = 0.14
        this.lightstickPivot.add(handle)

        const tipGeometry = new THREE.SphereGeometry(0.07, 16, 8)
        const tipMaterial = new THREE.MeshStandardNodeMaterial({
            color: '#ffffff',
            emissive: stringToColor(this.player.username + this.player.id),
            emissiveIntensity: 2.5,
        })
        this.lightstickTip = new THREE.Mesh(tipGeometry, tipMaterial)
        this.lightstickTip.position.y = 0.33
        this.lightstickPivot.add(this.lightstickTip)

        this.group.add(this.lightstickPivot)
    }

    setLightstickActive(active) {
        this.lightstickPivot.visible = active
    }

    // Pure function of the synced clock and the song's tempo, so every
    // client's lightstick sea sways in unison: one full cycle per two beats
    updateLightstick() {
        if (!this.lightstickPivot.visible)
            return

        const network = this.experience.network
        const dance = network.dance

        let tempo = IDLE_TEMPO
        let time = network.serverClock.now() / 1000

        if (dance?.phase === 'playing') {
            const song = songs.find((candidate) => candidate.id === dance.songId)
            tempo = song?.tempo ?? IDLE_TEMPO
            time = Math.max(0, (network.serverClock.now() - dance.startedAt) / 1000)
        }

        const phase = time * (tempo / 60) * Math.PI
        this.lightstickPivot.rotation.z = Math.sin(phase) * SWING_AMPLITUDE
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
            this.emoteSound.position.y = SPHERE_RADIUS
            this.group.add(this.emoteSound)
        }

        if (this.emoteSound.isPlaying)
            this.emoteSound.stop()

        this.emoteSound.setBuffer(buffer)
        this.emoteSound.play()
    }

    update() {
        this.updateLightstick()

        // Will drive the AnimationMixer once characters are animated
    }

    destroy() {
        if (this.emoteSound?.isPlaying)
            this.emoteSound.stop()

        this.scene.remove(this.group)
        this.body.geometry.dispose()
        this.body.material.dispose()
        this.label.material.dispose()
        this.labelTexture.dispose()
        this.lightstickTip.geometry.dispose()
        this.lightstickTip.material.dispose()
    }
}
