import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

const BUBBLE_LIFETIME = 5000 // ms
const MAX_TEXT_LENGTH = 60
const BUBBLE_HEIGHT_OFFSET = 1.55 // above the seat, clears the name label
// Default on-screen bubble height as a fraction of the viewport, whatever
// the camera distance (players sit far up the stands, so world-sized bubbles
// read tiny). Live-tweakable via `this.screenHeight` / the debug panel.
const BUBBLE_SCREEN_HEIGHT = 0.08
// Margin (also a fraction of viewport height) kept between bubbles when they
// stack into lanes, so neighbours never touch
const BUBBLE_GAP = 0.02

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
        this.debug = this.experience.debug

        // player id -> { sprite, expiresAt }
        this.bubbles = new Map()
        this.worldPosition = new THREE.Vector3() // reused by layoutBubbles()
        this.projected = new THREE.Vector3()

        // On-screen bubble height as a fraction of the viewport (tweakable);
        // the font size only sets texture crispness and the width:height ratio
        this.screenHeight = BUBBLE_SCREEN_HEIGHT

        this.setNetworkEvents()
        this.setDebug()

        console.log('ChatBubbles loaded')
    }

    setDebug() {
        if (!this.debug.active)
            return

        this.debugFolder = this.debug.ui.addFolder({
            title: 'Chat Bubbles',
            expanded: false,
        })

        this.debugFolder.addBinding(this, 'screenHeight', {
            label: 'Bubble Size',
            min: 0.02,
            max: 0.25,
            step: 0.005,
        })
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

        // Size + place it (and re-stack the others) before its first render
        this.layoutBubbles()
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
            // Always draw on top: without this the stepped stand behind a
            // player (its riser sits right at bubble height) occludes the
            // bubble. depthTest off + a high renderOrder makes it an overlay,
            // like a nameplate, so it's never swallowed by the geometry.
            depthTest: false,
        })

        const sprite = new THREE.Sprite(material)
        sprite.renderOrder = 999
        // Bubble's own proportions; layoutBubbles() sets the world size each
        // frame from this and the camera distance, so the shape stays correct
        sprite.userData.aspect = canvas.width / canvas.height

        return sprite
    }

    // Sizes every bubble to a constant screen height (regardless of camera
    // distance) and lifts overlapping ones into stacked lanes so they never
    // cover each other. All of it is done in SCREEN space, so it holds at any
    // zoom — where world spacing wouldn't help, since constant-size bubbles
    // bunch up on screen as the camera pulls back.
    layoutBubbles() {
        const camera = this.experience.camera.instance
        const {width, height} = this.experience.sizes
        const tanFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)

        // Gather each bubble's on-screen box (centre x + half width, in px)
        const items = []

        for (const bubble of this.bubbles.values()) {
            const sprite = bubble.sprite
            sprite.updateWorldMatrix(true, false)
            sprite.getWorldPosition(this.worldPosition)

            const distance = this.worldPosition.distanceTo(camera.position)
            // World height that renders as screenHeight of the view
            const worldHeight = this.screenHeight * 2 * distance * tanFov / camera.zoom
            sprite.scale.set(worldHeight * sprite.userData.aspect, worldHeight, 1)

            this.projected.copy(this.worldPosition).project(camera)
            const centerX = (this.projected.x * 0.5 + 0.5) * width
            const halfWidth = (this.screenHeight * sprite.userData.aspect * height) / 2

            items.push({sprite, distance, centerX, halfWidth, worldHeight, id: sprite.id})
        }

        // Assign lanes left to right: a bubble takes the lowest lane whose
        // last bubble's right edge clears its left edge (interval colouring),
        // so non-overlapping bubbles share lane 0 and only collisions stack
        items.sort((a, b) => a.centerX - b.centerX || a.id - b.id)

        const gapPx = BUBBLE_GAP * height
        const laneRightEdges = []

        for (const item of items) {
            const left = item.centerX - item.halfWidth
            let lane = 0

            while (lane < laneRightEdges.length && laneRightEdges[lane] > left)
                lane++

            laneRightEdges[lane] = item.centerX + item.halfWidth + gapPx

            // Lift by whole bubble heights per lane, converted back to a world
            // offset at this bubble's distance so the screen gap is constant
            const liftFraction = lane * (this.screenHeight + BUBBLE_GAP)
            const worldLift = liftFraction * 2 * item.distance * tanFov / camera.zoom
            item.sprite.position.y = BUBBLE_HEIGHT_OFFSET + worldLift
        }
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

        // Hold constant on-screen size and keep bubbles unstacked as the
        // camera moves (skip the work when nothing is showing)
        if (this.bubbles.size > 0)
            this.layoutBubbles()
    }
}
