import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

const BUBBLE_LIFETIME = 5000 // ms
const MAX_TEXT_LENGTH = 60
const BUBBLE_HEIGHT_OFFSET = 1.55 // above the seat, clears the name label

/**
 * Shows a player's chat message on a billboard above their character.
 * One bubble per player: a new message replaces the previous one.
 * Bubbles disappear after BUBBLE_LIFETIME.
 */
export default class ChatBubbles {
    constructor() {
        this.experience = new Experience()
        this.network = this.experience.network
        this.playerManager = this.experience.world.playerManager

        // player id -> { sprite, expiresAt }
        this.bubbles = new Map()

        this.setNetworkEvents()

        console.log('ChatBubbles loaded')
    }

    setNetworkEvents() {
        this.network.on('chatMessage', (message) => this.onMessage(message))
        this.network.on('playerLeft', (player) => this.removeBubble(player.id))
        this.network.on('roomLeft', () => this.clear())
    }

    onMessage({id, text}) {
        const character = this.playerManager.characters.get(id)

        if (!character)
            return

        // A new message from the same player replaces their current bubble
        this.removeBubble(id)

        if (text.length > MAX_TEXT_LENGTH)
            text = text.slice(0, MAX_TEXT_LENGTH - 1) + '…'

        const sprite = this.createSprite(text)
        sprite.position.y = BUBBLE_HEIGHT_OFFSET

        // Attached to the character's group, so it vanishes with the character
        character.group.add(sprite)

        this.bubbles.set(id, {
            sprite,
            expiresAt: Date.now() + BUBBLE_LIFETIME,
        })
    }

    createSprite(text) {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        const fontSize = 32
        const padding = 16
        context.font = `${fontSize}px sans-serif`

        canvas.width = Math.ceil(context.measureText(text).width) + padding * 2
        canvas.height = fontSize + padding * 2
        // canvas resize resets the context state
        context.font = `${fontSize}px sans-serif`

        // Rounded white background
        context.fillStyle = 'rgba(255, 255, 255, 0.9)'
        context.beginPath()
        context.roundRect(0, 0, canvas.width, canvas.height, 12)
        context.fill()

        context.fillStyle = '#000000'
        context.textBaseline = 'middle'
        context.fillText(text, padding, canvas.height / 2)

        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
        })

        const sprite = new THREE.Sprite(material)

        // Keep a constant world height, width follows the text length
        const height = 0.35
        sprite.scale.set(height * (canvas.width / canvas.height), height, 1)

        return sprite
    }

    removeBubble(id) {
        const bubble = this.bubbles.get(id)

        if (!bubble)
            return

        bubble.sprite.parent?.remove(bubble.sprite)
        bubble.sprite.material.map.dispose()
        bubble.sprite.material.dispose()
        this.bubbles.delete(id)
    }

    clear() {
        for (const id of [...this.bubbles.keys()])
            this.removeBubble(id)
    }

    update() {
        const now = Date.now()

        for (const [id, bubble] of this.bubbles) {
            if (now >= bubble.expiresAt)
                this.removeBubble(id)
        }
    }
}
