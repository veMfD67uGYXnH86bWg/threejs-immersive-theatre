import * as THREE from 'three/webgpu'
import {
    abs,
    attribute,
    clamp,
    color,
    cos,
    exp,
    float,
    hash,
    hue,
    instanceIndex,
    max,
    mix,
    PI,
    positionLocal,
    saturation,
    select,
    sin,
    step,
    texture,
    TWO_PI,
    uniform,
    uniformArray,
    varying,
    vec2,
    vec3
} from 'three/tsl'
import Experience from '../Experience.js'
import songs from '../../../shared/songs.js'
import {STANDS, STAND_ROWS, STEP_HEIGHT, STEP_DEPTH} from './Stadium.js'
import {buildCrowdSlots} from './StadiumBowl.js'
import CrowdChoreographer from './CrowdChoreographer.js'

const PERSON_SPACING = 0.95
const IDLE_TEMPO = 90
const WAVE_SPEED = 22 // units/s, wave front radius growth from the stage
const WAVE_WIDTH = 6
// Color-only radial waves have no motion to catch the eye, so they travel
// slower and wider — otherwise the tint crosses the stands in a ~1.5s blink
const COLOR_WAVE_SPEED_FACTOR = 0.5
const COLOR_WAVE_WIDTH_FACTOR = 1.8
const WAVE_LIFT = 1.15
const WAVE_DURATION = 6 // s, enough for the front to cross the whole venue
// One full lap over the wave's lifetime: the front returns to its start
// angle exactly as the fade-out completes. Negative = clockwise (seen from
// above); negate to flip direction.
const SWEEP_SPEED = -(Math.PI * 2) / WAVE_DURATION
const SWEEP_WIDTH = 0.40 // radians
// Where the sweep front is born: π = behind the stage (no stands there), so
// it enters the venue from the edge instead of popping mid-crowd
const SWEEP_START_ANGLE = Math.PI
const STAGE_CENTER = {x: 0, z: -7}
// Seconds to crossfade the crowd between the idle stick colors and a
// playing song's member palette
const PALETTE_FADE = 2.5

// Hand position in the stick's pre-instance space (capsule 0.05/0.35
// translated to (0.3, 1.25, 0) -> base sits at y = 1.25 - 0.225). Baked per
// instance as a world-space attribute so stick scaling anchors correctly —
// positionLocal is already instance-transformed in the node pipeline.
const STICK_ANCHOR = {x: 0.3, y: 1.025, z: 0}

// Sway is a rotation about the "elbow": a pivot this far below the hand
// anchor, swinging ±SWAY_ANGLE (so 60° total by default)
const ELBOW_OFFSET = 0.25
const SWAY_ANGLE = Math.PI / 6

// Three independent axes: motion pattern (radial/sweep) x move x tint.
// The emote picks deterministically from the server timestamp
// (at % WAVE_TYPES.length), so every client renders the same wave without
// any extra protocol.
const WAVE_TYPES = [
    {name: 'Radial lift', pattern: 0, move: true, tint: false},
    {name: 'Sweep lift', pattern: 1, move: true, tint: false},
    {name: 'Radial color', pattern: 0, move: false, tint: true},
    {name: 'Sweep color', pattern: 1, move: false, tint: true},
    {name: 'Radial combo', pattern: 0, move: true, tint: true},
    {name: 'Sweep combo', pattern: 1, move: true, tint: true},
    // Card-stunt sweep: the venue blacks out and the loaded image rides the
    // sweep front around the stands. Needs an image, so it's excluded from
    // the random emote pick — trigger via startImageWave() or the debug panel
    {name: 'Image sweep', pattern: 1, move: false, tint: false, image: true},
]

// The emote's deterministic pick only draws from the imageless types
const RANDOM_WAVE_COUNT = WAVE_TYPES.filter((type) => !type.image).length

// The shader loops over this many potential wave copies (repeats), each
// offset by the wave interval — overlapping fronts sum together. This also
// caps the simultaneous fronts: a looping sweep needs lapTime/interval of
// them alive to circle without gaps (e.g. a 9s lap at 0.4s spacing = ~23),
// so keep it generous. Unrolled at material-build time; the pulse is a
// cheap vertex-stage computation, so a high count is affordable.
const MAX_REPEATS = 32

// The image sweep can carry this many simultaneous fronts, evenly spaced
// around the venue, each with its own image from the set. Unrolled at
// material-build time — one texture sample AND one texture binding per
// copy, so this eats into WebGPU's per-stage sampled-texture budget (16 by
// default; the static display uses one more).
const MAX_IMAGE_COPIES = 8

// Uniform arrays are fixed-size: room for this many member colors per song
const MAX_PALETTE = 12

// Tinting waves fade through a color sequence as the pulse rises and falls.
// The sequence comes from the playing song's `colors` (shared/songs.js);
// without one, it's derived from this fallback color as
// [color +30 lightness, color, color +30 lightness].
const WAVE_COLOR_FALLBACK = '#00a24c'
const MAX_WAVE_COLORS = 8

// Built-in "card stunt" test image: a pixel heart shown until a real image
// is loaded ('.' = transparent, anything else = filled)
const DEFAULT_IMAGE = [
    '.##.##.',
    '#######',
    '#######',
    '.#####.',
    '..###..',
    '...#...',
]
const DEFAULT_IMAGE_COLOR = '#ff2d95'

// The image sweep's default pictures — Resources item names (sources.js);
// arbitrary paths under public/ also work as a fallback. Replace via
// startImageWave(at, [names]) or loadImageSet()
const DEFAULT_IMAGE_SET = ['aespa1', 'karina2']

/**
 * The fake audience filling the stadium stands: two InstancedMeshes (bodies
 * and glowing lightsticks) — a handful of draw calls no matter the headcount.
 *
 * All motion runs on the GPU (TSL): the beat sway and the crowd wave are
 * pure functions of two uniforms fed from the synced room clock, so every
 * client sees the identical crowd at the identical moment. The wave emote
 * (🌊) sweeps a pulse radially outward from the stage: sticks lift and
 * brighten, bodies hop, as the front passes their baked distance-to-stage.
 */
export default class Crowd {
    constructor() {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.network = this.experience.network
        this.debug = this.experience.debug

        this.uSwayPhase = uniform(0)
        this.uWaveTime = uniform(-1) // seconds since wave start, -1 = inactive
        this.uWavePattern = uniform(0) // 0 = radial, 1 = sweep
        this.uWaveMove = uniform(1) // 1 = the wave lifts sticks / hops bodies
        this.uWaveTint = uniform(0) // 1 = the wave tints through the wave color sequence
        this.uWaveRepeats = uniform(1) // 1..MAX_REPEATS copies of the wave
        this.uWaveInterval = uniform(1.2) // seconds between wave copies
        this.uWaveLoop = uniform(0) // 1 = endless train: a new front every interval
        this.uWaveJitter = uniform(0.2) // s of per-person reaction spread — humans aren't synced
        this.uWaveLift = uniform(WAVE_LIFT) // how high sticks rise at the wave's peak
        this.uWaveAmp = uniform(1) // master wave intensity — choreography eases cues in/out with it
        this.uWaveSpeed = uniform(WAVE_SPEED) // units/s, radial front speed (choreography can drive it)
        this.uWaveWidth = uniform(WAVE_WIDTH) // units, radial front thickness
        this.uWaveColorMode = uniform(0) // 0 = glow-gradient through the colors, 1 = one
        this.uSweepSpeed = uniform(SWEEP_SPEED) // rad/s of regular sweeps (negative = clockwise)
        this.uSweepStart = uniform(SWEEP_START_ANGLE) // radians, where sweep fronts are born
        this.uSweepWidth = uniform(SWEEP_WIDTH) // radians, angular thickness of the sweep front
        this.uStickLength = uniform(1.65) // Y-scale multiplier of the lightstick
        this.uStickWidth = uniform(1.65) // X/Z-scale multiplier of the lightstick
        this.uSwaySpread = uniform(0.9) // radians of per-person phase offset
        this.uStickTilt = uniform(Math.PI / 18) // ± fixed per-person off-plane tilt
        this.waveStartedAt = null

        // Lightstick look, tweakable at runtime (see setDebug); variations
        // are per-person spreads around the base color
        this.uStickColor = uniform(new THREE.Color('#ff2d95'))
        this.uHueVariation = uniform(0.35) // fraction of the full color wheel
        this.uSatVariation = uniform(0.25)
        this.uLightVariation = uniform(0.35)
        // Tinting waves fade through this sequence (see syncWaveColors)
        this.uWaveColors = uniformArray(Array.from({length: MAX_WAVE_COLORS}, () => new THREE.Color(WAVE_COLOR_FALLBACK)))
        this.uWaveColorCount = uniform(1)
        this.waveColorFallback = new THREE.Color(WAVE_COLOR_FALLBACK)
        this.syncWaveColors()

        // Member colors of the playing song, distributed across the crowd
        // (uPaletteCount 0 = no palette -> fallback HSL coloring)
        this.uPalette = uniformArray(Array.from({length: MAX_PALETTE}, () => new THREE.Color('#ffffff')))
        this.uPaletteCount = uniform(0)
        // Fallback -> member-palette crossfade: eased toward paletteMixTarget
        // every frame, so song start/end recolors the crowd gradually
        this.uPaletteMix = uniform(0)
        this.paletteMixTarget = 0
        this.paletteFade = PALETTE_FADE // s, tweakable in the debug panel

        // Crowd display ("card stunt"): sticks adopt the color of "their"
        // pixel, one lightstick per pixel, image centered per stand
        this.uImageMix = uniform(0) // 0 = off, 1 = image fully shown
        this.uImageSolo = uniform(0) // 1 = raw pixel colors, waves/beat bypassed
        this.uImageCenterOnly = uniform(0) // 1 = static display only on the center (back) stand
        this.uImageBlackout = uniform(0) // 1 = sticks not showing an image pixel go black
        this.uImageFlash = uniform(1) // flicker brightness: dims the solo image toward black
        this.uImageWrap = uniform(0) // 1 = one image wrapped around the bowl instead of per-stand copies
        this.uImageWaveBlackout = uniform(1) // image sweep: 1 = venue blacks out, 0 = crowd stays lit
        this.uImageWave = uniform(0) // 1 = blackout + the image rides the sweep front
        this.uImageSweepSpeed = uniform(SWEEP_SPEED) // rad/s of the image sweep (negative = clockwise)
        this.uImageLapTime = uniform(WAVE_DURATION) // s per image lap; kept in sync with the speed
        this.uImageCopies = uniform(1) // 1..MAX_IMAGE_COPIES simultaneous image fronts
        // Per-copy image dimensions (the set's images may differ in size)
        this.uImageSizes = uniformArray(Array.from({length: MAX_IMAGE_COPIES}, () => new THREE.Vector2(1, 1)))
        this.uImageSize = uniform(new THREE.Vector2(1, 1))
        this.imageTexture = this.createDefaultImageTexture()
        this.customImageLoaded = false

        // Mitered bowl layout; use this.buildSlots() instead to go back to
        // the rectangular Stadium.js layout
        this.resources = this.experience.resources

        this.slots = buildCrowdSlots()
        this.setBodies()
        this.setLightsticks()
        this.setNetworkEvents()
        this.setDebug()

        // Snapshots the uniforms above as its release-state, so it comes
        // after everything that sets defaults
        this.choreographer = new CrowdChoreographer(this)

        console.log(`Crowd loaded (${this.slots.length} people)`)
    }

    setDebug() {
        if (!this.debug.active)
            return

        this.debugFolder = this.debug.ui.addFolder({
            title: 'Crowd',
            expanded: true,
        })

        this.waveFolder = this.debugFolder.addFolder({
            title: 'Wave',
            expanded: true,
        })
        this.stickFolder = this.debugFolder.addFolder({
            title: 'Lightsticks',
            expanded: true,
        })
        this.imageFolder = this.debugFolder.addFolder({
            title: 'Image',
            expanded: true,
        })

        this.debugParams = {
            waveType: 5,
            loopWave: false,
            lightstickColor: '#ff2d95',
            waveColor: WAVE_COLOR_FALLBACK,
            crowdJitter: 1,
        }

        // Placement scatter: 1 = full natural jitter, 0 = a perfect grid
        // (sharpest image display, one stick per pixel)
        this.debugFolder.addBinding(this.debugParams, 'crowdJitter', {
            label: 'Placement Offset',
            min: 0,
            max: 1,
            step: 0.01,
            index: 0,
        }).on('change', (event) => {
            this.setJitter(event.value)
        })

        this.waveFolder.addBlade({
            view: 'list',
            label: 'Wave Type',
            options: WAVE_TYPES.map((type, index) => ({text: type.name, value: index})),
            value: 5,
        }).on('change', (event) => {
            this.debugParams.waveType = event.value

            // While looping, switch the running train's type live
            if (this.debugParams.loopWave)
                this.applyType(event.value)
        })

        // Local preview only — doesn't broadcast to the room
        this.waveFolder.addButton({title: 'Trigger wave'}).on('click', () => {
            this.startWave(this.network.serverClock.now(), this.debugParams.waveType)
        })

        // Endless wave train: a new front every interval until toggled off
        const loopButton = this.waveFolder.addButton({title: 'Loop Wave: OFF'})
        loopButton.on('click', () => {
            this.debugParams.loopWave = !this.debugParams.loopWave
            loopButton.title = this.debugParams.loopWave ? 'Loop Wave: ON' : 'Loop wave: OFF'
            this.uWaveLoop.value = this.debugParams.loopWave ? 1 : 0

            if (this.debugParams.loopWave)
                this.startWave(this.network.serverClock.now(), this.debugParams.waveType)
        })

        this.waveFolder.addBinding(this.uWaveRepeats, 'value', {
            label: 'Wave Repeats',
            min: 1,
            max: MAX_REPEATS,
            step: 1,
        })

        this.waveFolder.addBinding(this.uWaveInterval, 'value', {
            // label: 'Wave Interval (s)',
            label: 'Waves every X (s)',
            min: 0.2,
            max: 4,
            step: 0.05,
        })

        this.waveFolder.addBinding(this.uWaveJitter, 'value', {
            label: 'Reaction Offset (s)',
            min: 0,
            max: 0.5,
            step: 0.01,
        })

        this.waveFolder.addBinding(this.uWaveLift, 'value', {
            label: 'Wave Height',
            min: 0,
            max: 2.5,
            step: 0.05,
        })

        // Radial front speed; cue param `speed`. Fronts must satisfy
        // speed * interval * MAX_REPEATS >= ~50 to cross the venue in loop
        // mode
        this.waveFolder.addBinding(this.uWaveSpeed, 'value', {
            label: 'Radial Speed (u/s)',
            min: 2,
            max: 40,
            step: 0.5,
        })

        // Radial front thickness; cue param `width` on radial waves
        // (color-only waves render it 1.8x wider)
        this.waveFolder.addBinding(this.uWaveWidth, 'value', {
            label: 'Radial Width (u)',
            min: 1,
            max: 20,
            step: 0.5,
        })

        // Wave color distribution; cue param `colorMode`
        this.waveFolder.addBlade({
            view: 'list',
            label: 'Color Mode',
            options: [
                {text: 'Gradient (by intensity)', value: 0},
                {text: 'Per wave', value: 1},
            ],
            value: 0,
        }).on('change', (event) => {
            this.uWaveColorMode.value = event.value
        })

        // Regular-sweep travel time; cue param `lapTime` (the image sweep
        // has its own lap slider in the image folder)
        // Seconds for a sweep front to travel a full turn around the venue
        this.debugParams.sweepLapTime = WAVE_DURATION
        this.waveFolder.addBinding(this.debugParams, 'sweepLapTime', {
            label: 'Sweep Lap (s)',
            min: 2,
            max: 24,
            step: 0.5,
        }).on('change', (event) => {
            // ±2π / lap-time; negative = clockwise, the default direction
            this.uSweepSpeed.value = -(Math.PI * 2) / event.value
        })

        this.stickFolder.addBinding(this.uStickLength, 'value', {
            label: 'Stick Length (Y)',
            min: 0.3,
            max: 3,
            step: 0.05,
        })

        this.stickFolder.addBinding(this.uStickWidth, 'value', {
            label: 'Stick Width (XZ)',
            min: 0.3,
            max: 3,
            step: 0.05,
        })

        this.stickFolder.addBinding(this.uSwaySpread, 'value', {
            label: 'Sway Offset Spread',
            min: 0,
            max: Math.PI,
            step: 0.01,
        })

        // Shown in degrees, stored in radians
        this.debugParams.stickTiltDeg = 10
        this.stickFolder.addBinding(this.debugParams, 'stickTiltDeg', {
            label: 'Y Rotation (tilt)',
            min: 0,
            max: 25,
            step: 0.5,
        }).on('change', (event) => {
            this.uStickTilt.value = event.value * (Math.PI / 180)
        })

        // Shown in degrees, stored in radians
        this.debugParams.sweepStartDeg = SWEEP_START_ANGLE * (180 / Math.PI)
        // this.waveFolder.addBinding(this.debugParams, 'sweepStartDeg', {
        //     label: 'Sweep Start (°)',
        //     min: 0,
        //     max: 360,
        //     step: 1,
        // }).on('change', (event) => {
        //     this.uSweepStart.value = event.value * (Math.PI / 180)
        // })

        this.debugParams.sweepWidthDeg = SWEEP_WIDTH * (180 / Math.PI)
        this.waveFolder.addBinding(this.debugParams, 'sweepWidthDeg', {
            label: 'Sweep Width (°)',
            min: 5,
            max: 90,
            step: 0.5,
        }).on('change', (event) => {
            this.uSweepWidth.value = event.value * (Math.PI / 180)
        })

        // Image sweep speed as seconds per full lap; speed uniform derives
        // from it (negative = clockwise)
        this.debugParams.imageLapTime = WAVE_DURATION
        this.imageFolder.addBinding(this.debugParams, 'imageLapTime', {
            label: 'Image lap (s)',
            min: 2,
            max: 24,
            step: 0.5,
        }).on('change', (event) => {
            this.uImageLapTime.value = event.value
            this.uImageSweepSpeed.value = -(Math.PI * 2) / event.value
        })

        // Simultaneous image fronts, evenly spaced around the venue
        this.debugParams.imageCopies = 1
        this.imageFolder.addBinding(this.debugParams, 'imageCopies', {
            label: 'Images per Wave',
            min: 1,
            max: MAX_IMAGE_COPIES,
            step: 1,
        }).on('change', (event) => {
            this.uImageCopies.value = event.value
        })

        this.imageFolder.addBinding(this.uImageMix, 'value', {
            label: 'Image Blend',
            min: 0,
            max: 1,
            step: 0.01,
        })

        // Resource name (e.g. karina1) or path under public/ — empty =
        // built-in heart
        this.debugParams.imageUrl = ''
        this.imageFolder.addBinding(this.debugParams, 'imageUrl', {
            label: 'Image Name',
        }).on('change', (event) => {
            const url = event.value.trim()

            if (url)
                this.loadImage(url)
        })

        // Solo mode: the image IS the lightsticks, waves/beat bypassed.
        // First activation auto-loads an aespa picture if the built-in
        // heart is still up.
        const imageButton = this.imageFolder.addButton({title: 'Image sticks: OFF'})
        imageButton.on('click', () => {
            const active = this.uImageSolo.value !== 1
            this.uImageSolo.value = active ? 1 : 0
            imageButton.title = active ? 'Image sticks: ON' : 'Image sticks: OFF'

            if (active && !this.customImageLoaded) {
                this.debugParams.imageUrl = DEFAULT_IMAGE_SET[0]
                this.loadImage(this.debugParams.imageUrl)
                this.debug.ui.refresh()
            }
        })

        this.stickFolder.addBinding(this.debugParams, 'lightstickColor', {
            label: 'Stick Color',
            index: 0,
        }).on('change', (event) => {
            this.uStickColor.value.set(event.value)
        })

        // Fallback wave color, used when the playing song has no `colors`
        this.waveFolder.addBinding(this.debugParams, 'waveColor', {
            label: 'Wave Color',
        }).on('change', (event) => {
            this.waveColorFallback.set(event.value)
            this.syncWaveColors()
        })

        // Second color: the wave sequence becomes [color, color 2] — makes
        // Color Mode differences visible without editing the timeline.
        // Defaults to the lighter shade the single-color expansion used.
        {
            const hsl = {}
            this.waveColorFallback.getHSL(hsl)
            const lighter = new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + 0.3))
            this.debugParams.waveColor2 = `#${lighter.getHexString()}`
            this.waveColorFallback2 = lighter
            this.syncWaveColors()
        }

        this.waveFolder.addBinding(this.debugParams, 'waveColor2', {
            label: 'Wave Color 2',
        }).on('change', (event) => {
            this.waveColorFallback2.set(event.value)
            this.syncWaveColors()
        })

        // Current panel values as a paste-ready choreography cue
        this.waveFolder.addButton({title: 'Copy cue JSON'}).on('click', () => {
            this.copyCueToClipboard()
        })

        // Idle colors <-> song member palette crossfade duration
        this.stickFolder.addBinding(this, 'paletteFade', {
            label: 'Palette fade (s)',
            min: 0,
            max: 10,
            step: 0.1,
        })

        this.stickFolder.addBinding(this.uHueVariation, 'value', {
            label: 'Hue Variation',
            min: 0,
            max: 1,
            step: 0.01,
        })

        this.stickFolder.addBinding(this.uSatVariation, 'value', {
            label: 'Sat Variation',
            min: 0,
            max: 1,
            step: 0.01,
        })

        this.stickFolder.addBinding(this.uLightVariation, 'value', {
            label: 'Light Variation',
            min: 0,
            max: 1,
            step: 0.01,
        })
    }

    // LEGACY rectangular layout — pairs with Stadium.js. Kept so the old
    // stadium remains one import swap away; StadiumBowl.buildCrowdSlots()
    // is the active generator.
    buildSlots() {
        const slots = []

        let seed = 1
        const random = () => {
            seed = (seed * 16807) % 2147483647
            return seed / 2147483647
        }

        for (const stand of STANDS) {
            const cos = Math.cos(stand.yaw)
            const sin = Math.sin(stand.yaw)
            const perRow = Math.floor(stand.length / PERSON_SPACING)

            for (let row = 0; row < STAND_ROWS; row++) {
                const localZ = stand.start + row * STEP_DEPTH + STEP_DEPTH * 0.6
                const y = (row + 1) * STEP_HEIGHT

                for (let i = 0; i < perRow; i++) {
                    const localX = -stand.length / 2 + (i + 0.5) * PERSON_SPACING + (random() - 0.5) * 0.35

                    // Rotate the stand-local position by the stand's yaw
                    const x = cos * localX + sin * localZ
                    const z = -sin * localX + cos * localZ

                    slots.push({
                        position: new THREE.Vector3(x, y, z),
                        facing: Math.atan2(STAGE_CENTER.x - x, STAGE_CENTER.z - z),
                        scale: 0.85 + random() * 0.25,
                        distance: Math.hypot(x - STAGE_CENTER.x, z - STAGE_CENTER.z),
                        angle: Math.atan2(x - STAGE_CENTER.x, z - STAGE_CENTER.z),
                        // Grid coords centered on the stand — the crowd
                        // display maps one person to one image pixel
                        col: i - (perRow - 1) / 2,
                        row: row - (STAND_ROWS - 1) / 2,
                    })
                }
            }
        }

        return slots
    }

    fillInstances(mesh) {
        const dummy = new THREE.Object3D()

        this.slots.forEach((slot, index) => {
            dummy.position.copy(slot.position)
            dummy.rotation.y = slot.facing
            dummy.scale.setScalar(slot.scale)
            dummy.updateMatrix()
            mesh.setMatrixAt(index, dummy.matrix)
        })

        mesh.instanceMatrix.needsUpdate = true
        mesh.frustumCulled = false
    }

    // Packed per-instance data. WebGPU allows only 8 vertex buffers per
    // pipeline and every attribute costs one, so scalars are bundled:
    //   crowdWave:   vec4(distance to stage, azimuth, sway mode, unused)
    //   crowdGrid:   vec2(col, row) for the image display
    //   crowdAnchor: vec3 world-space hand position (stick scale/pivot)
    setInstanceAttributes(geometry) {
        const wave = new Float32Array(this.slots.length * 4)
        const grid = new Float32Array(this.slots.length * 2)
        const anchors = new Float32Array(this.slots.length * 3)

        this.slots.forEach((slot, index) => {
            wave[index * 4] = slot.distance
            wave[index * 4 + 1] = slot.angle
            wave[index * 4 + 2] = slot.swayMode ?? 0

            grid[index * 2] = slot.col
            grid[index * 2 + 1] = slot.row

            this.writeAnchor(anchors, index)
        })

        geometry.setAttribute('crowdWave', new THREE.InstancedBufferAttribute(wave, 4))
        geometry.setAttribute('crowdGrid', new THREE.InstancedBufferAttribute(grid, 2))
        this.anchorAttribute = new THREE.InstancedBufferAttribute(anchors, 3)
        geometry.setAttribute('crowdAnchor', this.anchorAttribute)
    }

    // World-space hand position: the stick anchor pushed through this
    // instance's rotation, scale and (possibly re-jittered) position
    writeAnchor(anchors, index) {
        const slot = this.slots[index]
        const cos = Math.cos(slot.facing)
        const sin = Math.sin(slot.facing)
        const ax = STICK_ANCHOR.x * slot.scale
        anchors[index * 3] = slot.position.x + cos * ax
        anchors[index * 3 + 1] = slot.position.y + STICK_ANCHOR.y * slot.scale
        anchors[index * 3 + 2] = slot.position.z - sin * ax
    }

    // Re-scale the per-person placement jitter live (1 = full scatter as
    // built, 0 = a perfect grid). Rewrites body matrices and stick anchors.
    setJitter(scale) {
        this.slots.forEach((slot) => {
            if (!slot.positionBase || !slot.jitterVec)
                return
            slot.position.copy(slot.positionBase).addScaledVector(slot.jitterVec, scale)
        })

        if (this.bodies)
            this.fillInstances(this.bodies)

        if (this.anchorAttribute) {
            const anchors = this.anchorAttribute.array
            for (let index = 0; index < this.slots.length; index++)
                this.writeAnchor(anchors, index)
            this.anchorAttribute.needsUpdate = true
        }
    }

    // Tiny CanvasTexture of the built-in pixel heart, nearest-filtered so
    // one person = one crisp pixel
    createDefaultImageTexture() {
        const canvas = document.createElement('canvas')
        canvas.width = DEFAULT_IMAGE[0].length
        canvas.height = DEFAULT_IMAGE.length

        const context = canvas.getContext('2d')
        context.fillStyle = DEFAULT_IMAGE_COLOR

        DEFAULT_IMAGE.forEach((rowPixels, y) => {
            for (let x = 0; x < rowPixels.length; x++) {
                if (rowPixels[x] !== '.')
                    context.fillRect(x, y, 1, 1)
            }
        })

        const canvasTexture = new THREE.CanvasTexture(canvas)
        this.configureImageTexture(canvasTexture)
        this.uImageSize.value.set(canvas.width, canvas.height)

        return canvasTexture
    }

    configureImageTexture(imageTexture) {
        imageTexture.magFilter = THREE.NearestFilter
        imageTexture.minFilter = THREE.NearestFilter
        imageTexture.generateMipmaps = false
        imageTexture.colorSpace = THREE.SRGBColorSpace
        // Resources items may already sit on the GPU with default filters
        imageTexture.needsUpdate = true
    }

    // Resolve a crowd image: a preloaded Resources item by name (sources.js,
    // e.g. 'aespa1') first, else a path under public/ loaded on the fly
    resolveImage(nameOrUrl, onReady) {
        const preloaded = this.resources.items[nameOrUrl]

        if (preloaded) {
            this.configureImageTexture(preloaded)
            onReady(preloaded)
            return
        }

        new THREE.TextureLoader().load(nameOrUrl, (loaded) => {
            this.configureImageTexture(loaded)
            onReady(loaded)
        }, undefined, () => {
            console.warn(`Crowd image not found (resource name or path): ${nameOrUrl}`)
        })
    }

    // Re-requesting the currently shown image is a no-op (choreography cues
    // re-assert their image every frame)
    loadImage(nameOrUrl) {
        if (nameOrUrl === this.imageKey)
            return

        this.imageKey = nameOrUrl
        this.resolveImage(nameOrUrl, (imageTexture) => {
            this.applyImage(imageTexture)
            this.customImageLoaded = true
        })
    }

    // Point every image sample node at this texture
    applyImage(imageTexture) {
        this.uImageSize.value.set(imageTexture.image.width, imageTexture.image.height)
        for (const node of this.imageTextureNodes)
            node.value = imageTexture
    }

    // Gather the image sweep's set: the simultaneous fronts each carry one
    // of these, front i showing image i % set length (see syncImageCopies).
    // Resources items resolve instantly; path fallbacks slot in as they load.
    // Re-requesting the current set is a no-op, so callers (like the
    // choreographer) can call this every frame.
    loadImageSet(namesOrUrls) {
        const setKey = namesOrUrls.join('|')

        if (setKey === this.imageSetKey)
            return

        this.imageSetKey = setKey
        this.imageSet = new Array(namesOrUrls.length).fill(null)

        namesOrUrls.forEach((nameOrUrl, index) => {
            this.resolveImage(nameOrUrl, (imageTexture) => {
                this.imageSet[index] = imageTexture
                this.customImageLoaded = true

                // Retargets the static display too, so the single-image
                // guard no longer knows what's shown
                if (index === 0) {
                    this.applyImage(imageTexture)
                    this.imageKey = null
                }

                this.syncImageCopies()
            })
        })
    }

    // Distribute the loaded set across the unrolled image-front samplers
    // (round-robin) with each copy's own dimensions
    syncImageCopies() {
        const loaded = this.imageSet?.filter(Boolean)

        if (!loaded?.length || !this.imageWaveTextureNodes)
            return

        this.imageWaveTextureNodes.forEach((node, index) => {
            const imageTexture = loaded[index % loaded.length]
            node.value = imageTexture
            this.uImageSizes.array[index].set(imageTexture.image.width, imageTexture.image.height)
        })
    }

    // Gaussian pulse around the travelling wave front(s), 0 while inactive.
    // Up to MAX_REPEATS copies of the wave run simultaneously, each offset
    // by uWaveInterval — their pulses sum, so overlapping fronts stack.
    // The repeat loop is unrolled in JS at material-build time: each copy is
    // one more term in the expression tree, no GPU-side control flow needed.
    // Returns the pulse split into its two uses: `move` (lift/hop — zero for
    // color-only waves) and `glow` (brightness/tint — all wave types).
    wavePulse() {
        const waveData = attribute('crowdWave', 'vec4')
        const dist = waveData.x
        const angle = waveData.y
        const isSweep = this.uWavePattern.equal(1)

        // exp(-x²) — squared via self-multiplication because WGSL pow() is
        // undefined for negative bases
        const bell = (x) => exp(x.mul(x).negate())

        // Tint-without-movement waves have nothing to catch the eye, so
        // only they get the slower, wider radial front
        const colorOnlyFlag = this.uWaveTint.mul(float(1).sub(this.uWaveMove))
        const radialSpeed = mix(this.uWaveSpeed, this.uWaveSpeed.mul(COLOR_WAVE_SPEED_FACTOR), colorOnlyFlag)
        const radialWidth = mix(this.uWaveWidth, this.uWaveWidth.mul(COLOR_WAVE_WIDTH_FACTOR), colorOnlyFlag)

        // A sweep front's total life is one full turn (2π). uSweepSpeed is
        // ±2π / sweepLapTime, so a full turn takes sweepLapTime (reaching
        // the opposite side at the halfway point). The fade-out (below)
        // follows this, so a front dies back where it was born — behind the
        // stage, where there are no stands to see it.
        //
        // Capped at the copy budget (interval * (MAX_REPEATS - 1)): if the
        // interval is so small that a full turn needs more than MAX_REPEATS
        // fronts alive at once, they fade out at the budget's edge instead
        // of popping when their copy is recycled (a graceful degradation —
        // the sweep just won't reach all the way around).
        const sweepLife = TWO_PI.div(abs(this.uSweepSpeed))
            .min(this.uWaveInterval.mul(MAX_REPEATS - 1))

        // Both patterns share one train model: a new front spawns every
        // uWaveInterval. In loop mode time wraps modulo the interval and the
        // MAX_REPEATS unrolled copies become a rolling window of the most
        // recent fronts — radial ones leave through the venue's edge, sweep
        // ones fade out behind the stage, so the recycle is never seen.
        const loopedTime = this.uWaveTime.mod(this.uWaveInterval)
            .add(this.uWaveInterval.mul(MAX_REPEATS - 1))

        // Per-person reaction jitter: everyone perceives the front slightly
        // early or late (centered, so the wave's average timing is unchanged)
        const reactionJitter = hash(instanceIndex.add(41)).sub(0.5).mul(this.uWaveJitter)
        const waveTime = mix(this.uWaveTime, loopedTime, this.uWaveLoop).sub(reactionJitter)

        let sum = float(0)
        // Per-wave color mode: each front's bell, weighted by that front's
        // own color from the sequence
        let colorSum = vec3(0)

        for (let i = 0; i < MAX_REPEATS; i++) {
            // In loop mode every copy exists regardless of the repeats slider
            const exists = step(i, this.uWaveRepeats.sub(1)).max(this.uWaveLoop)
            const copyTime = waveTime.sub(this.uWaveInterval.mul(i))
            const started = step(0, copyTime)

            // Radial: front travels outward from the stage
            const radialFront = dist.sub(copyTime.mul(radialSpeed))
            const radial = bell(radialFront.div(radialWidth))

            // Sweep: front circles the venue; wrap the angle diff to [-π, π]
            const sweepAngle = copyTime.mul(this.uSweepSpeed).add(this.uSweepStart)
            const angleDelta = angle.sub(sweepAngle).add(PI).mod(TWO_PI).sub(PI)
            // Fade in over the first second, fade out over the last second
            // of the front's life (one full turn) — both happen behind the
            // stage, so a front's birth and death are invisible
            const sweepFade = clamp(copyTime, 0, 1).mul(clamp(sweepLife.sub(copyTime), 0, 1))
            const sweep = bell(angleDelta.div(this.uSweepWidth)).mul(sweepFade)

            const contribution = select(isSweep, sweep, radial).mul(started).mul(exists)
            sum = sum.add(contribution)

            // Which spawned front this copy shows, so perWave can color it.
            // In a finite train copy i is simply the i-th front. In loop
            // mode the copies recycle, so the front number advances with the
            // generation counter (floor(time / interval)); as time crosses
            // an interval a front shifts down one copy and its number — and
            // thus its color — stays with it, so a single front never
            // changes color, and each new spawn takes the next color.
            const waveIndex = select(
                this.uWaveLoop.greaterThan(0.5),
                this.uWaveTime.div(this.uWaveInterval).floor().sub(MAX_REPEATS - 1 - i),
                float(i),
            )
            const colorIndex = waveIndex.mod(this.uWaveColorCount).toInt()
            colorSum = colorSum.add(this.uWaveColors.element(colorIndex).mul(contribution))
        }

        const glow = sum.min(1.5).mul(step(0, this.uWaveTime)).mul(this.uWaveAmp)

        return {
            move: glow.mul(this.uWaveMove),
            glow,
            // Overlapping fronts blend their colors by their local weight
            perWaveColor: colorSum.div(sum.max(0.001)),
        }
    }

    setBodies() {
        // Instance origin at the feet
        const geometry = new THREE.CapsuleGeometry(0.28, 0.55, 3, 8)
        geometry.translate(0, 0.56, 0)
        this.setInstanceAttributes(geometry)

        const material = new THREE.MeshStandardNodeMaterial()
        material.colorNode = mix(color('#232030'), color('#4a4260'), hash(instanceIndex.add(3)))

        const jitter = hash(instanceIndex).mul(Math.PI * 2)
        const bob = abs(sin(this.uSwayPhase.mul(0.5).add(jitter))).mul(0.05)
        // Bodies hop at a fixed fraction of the stick lift
        const hop = this.wavePulse().move.mul(this.uWaveLift).mul(0.2)
        material.positionNode = positionLocal.add(vec3(0, bob.add(hop), 0))

        this.bodies = new THREE.InstancedMesh(geometry, material, this.slots.length)
        this.fillInstances(this.bodies)
        this.scene.add(this.bodies)
    }

    setLightsticks() {
        // A glowing stick held up beside the body
        const geometry = new THREE.CapsuleGeometry(0.05, 0.35, 2, 6)
        geometry.translate(0.3, 1.25, 0)
        this.setInstanceAttributes(geometry)

        const material = new THREE.MeshBasicNodeMaterial()

        // Per-person color, two modes selected by uPaletteCount:
        // - song palette: each person gets a random member color; only the
        //   lightness spread applies, so the colors stay recognizable
        // - fallback: base stick color spread by random hue/sat/light
        const hueSeed = hash(instanceIndex.add(11)).sub(0.5)
        const satSeed = hash(instanceIndex.add(17)).sub(0.5)
        const lightSeed = hash(instanceIndex.add(23)).sub(0.5)
        const lightSpread = lightSeed.mul(this.uLightVariation).mul(1.2).add(1)

        const hueShifted = hue(this.uStickColor, hueSeed.mul(this.uHueVariation).mul(TWO_PI))
        const fallback = saturation(hueShifted, satSeed.mul(this.uSatVariation).mul(2).add(1)).mul(lightSpread)

        const paletteIndex = hash(instanceIndex.add(29))
            .mul(this.uPaletteCount)
            .floor()
            .min(this.uPaletteCount.sub(1))
            .max(0)
            .toInt()
        const member = this.uPalette.element(paletteIndex).mul(lightSpread)

        // Crossfade instead of a hard select, so the crowd eases between
        // the idle look and the song's palette (see update)
        const base = mix(fallback, member, this.uPaletteMix)

        // Crowd display: each person samples "their" pixel (grid coords are
        // instanced attributes, so they cross to the fragment stage as a
        // varying). Out-of-image or transparent pixels keep the normal look.
        const gridAttr = attribute('crowdGrid', 'vec2')

        // Two horizontal mappings, selected by uImageWrap:
        // - grid (0): per-stand columns — every stand shows its own centered
        //   copy of the image
        // - wrap (1): ONE image around the whole bowl — EXACTLY the image
        //   sweep's arc-length projection (angle delta times the seat's own
        //   distance to the stage), with the front frozen at the back
        //   stand's center (azimuth 0). Centered on the back stand, the
        //   overflow continues onto the side stands the same way a sweep
        //   image crosses from one stand to the next.
        // col/azimuth grow along +X, which reads right-to-left from the
        // stage's viewpoint — negate so the image isn't mirrored. Snapped
        // to a texel in the VERTEX stage (whole stick agrees on one pixel)
        // with a quarter-texel bias: row counts alternate odd/even, which
        // would otherwise park some rows exactly on texel edges where
        // nearest-filtering flickers between the two neighboring pixels.
        const waveAttr = attribute('crowdWave', 'vec4')
        const wrapDelta = waveAttr.y.add(PI).mod(TWO_PI).sub(PI)
        const wrapX = wrapDelta.negate().mul(waveAttr.x).div(PERSON_SPACING)
        const pixelX = mix(gridAttr.x.negate(), wrapX, this.uImageWrap)
        const pixel = vec2(pixelX, gridAttr.y).add(this.uImageSize.mul(0.5))
        const texel = varying(pixel.add(0.25).floor())
        const imageUv = texel.add(0.5).div(this.uImageSize)
        const imageSample = texture(this.imageTexture, imageUv)
        // Every texture() node sampling the crowd image — loadImage must
        // swap the texture on all of them
        this.imageTextureNodes = [imageSample]

        const inBounds = step(0, texel.x).mul(step(texel.x, this.uImageSize.x.sub(1)))
            .mul(step(0, texel.y)).mul(step(texel.y, this.uImageSize.y.sub(1)))
        // Optional restriction of the static display to the center (back)
        // stand: its swayMode is odd (front-back sway), the side stands'
        // even — parity is a clean stand id already in the packed attribute
        const standParity = varying(attribute('crowdWave', 'vec4').z.mod(2))
        const standMask = mix(float(1), standParity, this.uImageCenterOnly)

        const imageAmount = this.uImageMix.mul(inBounds).mul(step(0.5, imageSample.a)).mul(standMask)
        const displayBase = mix(base, imageSample.rgb, imageAmount)

        const {move, glow, perWaveColor} = this.wavePulse()

        // Same math as the position waves, different output: the pulse is
        // computed in the vertex stage (where the instanced attributes
        // provably work — that's the lift waves) and carried into the
        // fragment stage as a varying for the color to consume. Every vertex
        // of an instance gets the same value, so interpolation is exact.
        const waveGlow = varying(glow)

        // Tinting waves fade through the wave color sequence: pulse intensity
        // is the position along the list, so a rising front climbs the colors
        // in succession and descends back through them as it passes. The beat
        // pulse makes the tempo visible venue-wide.
        const gradientPos = waveGlow.min(1).mul(this.uWaveColorCount.sub(1)).max(0)
        const gradientIndex = gradientPos.floor().toInt()
        const nextIndex = gradientIndex.add(1).min(this.uWaveColorCount.toInt().sub(1)).max(0)
        const gradientColor = mix(
            this.uWaveColors.element(gradientIndex),
            this.uWaveColors.element(nextIndex),
            gradientPos.fract(),
        )

        // Per-wave mode: each consecutive front carries the next color of
        // the sequence whole (computed in the vertex stage alongside the
        // pulse, carried across as a varying)
        const waveColor = mix(gradientColor, varying(perWaveColor), this.uWaveColorMode)

        // Tint strength is decoupled from the gradient position: the glow
        // still picks WHICH color of the sequence, but the blend over the
        // stick's base color saturates early (x3), so the first colors of
        // the array show as fully as the last one instead of being washed
        // out on the bell's shoulders — equal-strength color bands riding
        // the front.
        const tintStrength = waveGlow.mul(3).min(1)
        const tinted = mix(displayBase, waveColor, tintStrength.mul(this.uWaveTint))
        const beatPulse = max(sin(this.uSwayPhase.mul(2)), 0).pow(4).mul(0.25)
        const animated = tinted.mul(waveGlow.mul(2.0).add(beatPulse).add(0.9))

        // "Image sticks" solo mode: in-image sticks show their pixel color
        // verbatim — no wave tint, no glow, no beat pulse. Sticks outside
        // the image (or on transparent pixels) keep the normal behavior.
        const soloAmount = this.uImageSolo.mul(inBounds).mul(step(0.5, imageSample.a)).mul(standMask)
        // uImageFlash dims the image itself: a flicker fade darkens the
        // picture toward black in place instead of dissolving it into the
        // crowd colors (membership and brightness are separate knobs)
        const soloed = mix(animated, imageSample.rgb.mul(this.uImageFlash), soloAmount)

        // Flicker blackout: every stick NOT currently showing an image
        // pixel fades to black — the image-sweep look without the sweep.
        // Scaled by (1 - soloAmount) so the image itself stays lit; during
        // a flash's off phase soloAmount is 0 and the whole venue is dark.
        const blackout = this.uImageBlackout.mul(float(1).sub(soloAmount))
        const blacked = mix(soloed, vec3(0), blackout)

        // Image sweep wave: the picture is anchored on the travelling sweep
        // front and read by arc length — a person `delta` radians from the
        // front at distance d sits delta*d/PERSON_SPACING person-columns from
        // the image's center, so the image keeps its proportions on every
        // row. Rows reuse the static grid mapping. Computed in the vertex
        // stage (instanced attributes) and carried across as a varying.
        const waveData = attribute('crowdWave', 'vec4')
        const sweepFrontAngle = this.uWaveTime.mul(this.uImageSweepSpeed).add(this.uSweepStart)

        // Up to MAX_IMAGE_COPIES fronts, evenly spaced around the circle,
        // each sampling its own texture (assigned from the image set by
        // syncImageCopies). Blackout canvas: sticks stay black unless one
        // copy's opaque pixel lands on them; copies sum (they never overlap
        // for sanely sized images).
        this.imageWaveTextureNodes = []
        let sweepImageColor = vec3(0)
        // How much of this stick any image front covers (0..1) — lets the
        // no-blackout mode override only the covered sticks
        let sweepCoverage = float(0)

        for (let i = 0; i < MAX_IMAGE_COPIES; i++) {
            const exists = step(i, this.uImageCopies.sub(1))
            const copyAngle = sweepFrontAngle.add(float(i).mul(TWO_PI).div(this.uImageCopies))
            const copyDelta = waveData.y.sub(copyAngle).add(PI).mod(TWO_PI).sub(PI)
            const copySize = this.uImageSizes.element(i)

            // Negated for the same reason as the static display's grid.x:
            // larger azimuth reads leftward from the stage, image columns
            // grow rightward. Snapped to a texel INSIDE the varying — i.e.
            // in the vertex stage — so the whole stick agrees on one pixel:
            // flooring the continuous coordinate per fragment speckles near
            // texel edges. Quarter-texel bias as in the static display
            // (rows alternate integer/half-integer centering).
            const copyTexel = varying(vec2(
                copyDelta.negate().mul(waveData.x).div(PERSON_SPACING).add(copySize.x.mul(0.5)),
                attribute('crowdGrid', 'vec2').y.add(copySize.y.mul(0.5)),
            ).add(0.25).floor())
            const copyUv = copyTexel.add(0.5).div(copySize)
            // Each copy gets its OWN placeholder texture object: samplers
            // built on the same texture are deduplicated into one binding,
            // and every copy would then show whatever the last sync wrote
            const copySample = texture(this.imageTexture.clone(), copyUv)
            this.imageWaveTextureNodes.push(copySample)

            const copyInBounds = step(0, copyTexel.x).mul(step(copyTexel.x, copySize.x.sub(1)))
                .mul(step(0, copyTexel.y)).mul(step(copyTexel.y, copySize.y.sub(1)))

            const copyShow = copyInBounds.mul(step(0.5, copySample.a)).mul(exists)
            sweepImageColor = sweepImageColor.add(copySample.rgb.mul(copyShow))
            sweepCoverage = sweepCoverage.add(copyShow)
        }

        // Fade the blackout in and out over the wave's lifetime. The sweep
        // angle is periodic (one lap = uImageLapTime), so a looping train
        // needs no time wrapping — just skip the fade-out until toggled off.
        const imageWaveFade = clamp(this.uWaveTime, 0, 1)
            .mul(mix(clamp(this.uImageLapTime.sub(this.uWaveTime), 0, 1), float(1), this.uWaveLoop))
            .mul(step(0, this.uWaveTime))
        // Blackout on: the whole venue mixes toward the copies' color
        // (black outside the images). Blackout off: only covered sticks
        // take the image, the rest of the crowd stays lit.
        const sweepMask = mix(sweepCoverage.min(1), float(1), this.uImageWaveBlackout)
        material.colorNode = mix(blacked, sweepImageColor, this.uImageWave.mul(imageWaveFade).mul(this.uWaveAmp).mul(sweepMask))

        // Stick size: scale around this instance's own hand position (baked
        // world-space attribute) so length grows upward and width thickens
        // in place, at every row height
        const stickAnchor = attribute('crowdAnchor', 'vec3')
        const stickScale = vec3(this.uStickWidth, this.uStickLength, this.uStickWidth)
        const scaled = positionLocal.sub(stickAnchor).mul(stickScale).add(stickAnchor)

        // Sway as a rotation about the elbow pivot (just below the hand).
        // Side stands rotate about world Z (tip swings side to side), the
        // back stand about world X (front to back) — see StadiumBowl STANDS
        // Sway mode from the packed attribute: even = side to side, odd =
        // front to back; modes >= 2 swing mirrored (negated = half-period
        // delay). See StadiumBowl STANDS.
        const swayMode = attribute('crowdWave', 'vec4').z
        const swaySign = float(1).sub(step(1.5, swayMode).mul(2))

        const frontBack = swayMode.mod(2)

        const rotateAboutZ = (v, s, c) => vec3(
            v.x.mul(c).sub(v.y.mul(s)),
            v.x.mul(s).add(v.y.mul(c)),
            v.z,
        )
        const rotateAboutX = (v, s, c) => vec3(
            v.x,
            v.y.mul(c).sub(v.z.mul(s)),
            v.y.mul(s).add(v.z.mul(c)),
        )

        // The beat sway, staggered per person by uSwaySpread
        const pivot = stickAnchor.sub(vec3(0, ELBOW_OFFSET, 0))
        const swayPhase = this.uSwayPhase.add(hash(instanceIndex).mul(this.uSwaySpread))
        const angle = sin(swayPhase).mul(SWAY_ANGLE).mul(swaySign)
        const angleSin = sin(angle)
        const angleCos = cos(angle)
        const offset = scaled.sub(pivot)

        const swayRotated = mix(
            rotateAboutZ(offset, angleSin, angleCos),
            rotateAboutX(offset, angleSin, angleCos),
            frontBack,
        )

        // Fixed per-person tilt about the axis orthogonal to the sway plane
        // (±uStickTilt), so sticks aren't militarily parallel mid-swing
        const tiltAngle = hash(instanceIndex.add(53)).sub(0.5).mul(2).mul(this.uStickTilt)
        const tiltSin = sin(tiltAngle)
        const tiltCos = cos(tiltAngle)
        const tilted = mix(
            rotateAboutX(swayRotated, tiltSin, tiltCos),
            rotateAboutZ(swayRotated, tiltSin, tiltCos),
            frontBack,
        )

        const rotated = pivot.add(tilted)

        material.positionNode = rotated.add(vec3(0, move.mul(this.uWaveLift), 0))

        this.lightsticks = new THREE.InstancedMesh(geometry, material, this.slots.length)
        this.fillInstances(this.lightsticks)
        this.scene.add(this.lightsticks)
    }

    setNetworkEvents() {
        this.network.on('emotePlayed', ({emoteId, at}) => {
            if (emoteId === 'crowdwave')
                this.startWave(at ?? this.network.serverClock.now())
        })

        this.network.on('roomJoined', () => this.syncPalette())
        this.network.on('danceStateChanged', () => this.syncPalette())
        this.network.on('roomLeft', () => this.syncPalette())
    }

    // Adopt the playing song's member colors, or clear back to fallback
    syncPalette() {
        const dance = this.network.dance
        const song = dance?.phase === 'playing'
            ? songs.find((candidate) => candidate.id === dance.songId)
            : null

        this.setPalette(song?.colors ?? null)
        this.syncWaveColors()
    }

    // Wave gradient: the playing song's colors, or a sequence derived from
    // the fallback wave color — [lighter, color, lighter] so even a single
    // color fades through shades instead of being flat
    syncWaveColors() {
        const dance = this.network.dance
        const song = dance?.phase === 'playing'
            ? songs.find((candidate) => candidate.id === dance.songId)
            : null

        if (song?.colors?.length) {
            this.setWaveColors(song.colors)
            return
        }

        // Second debug swatch set: the fallback sequence is the two colors
        // as-is (no lightness expansion)
        if (this.waveColorFallback2) {
            this.setWaveColors([this.waveColorFallback, this.waveColorFallback2])
            return
        }

        const hsl = {}
        this.waveColorFallback.getHSL(hsl)
        const lighter = new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + 0.3))

        this.setWaveColors([lighter, this.waveColorFallback, lighter])
    }

    setPalette(colors) {
        const count = Math.min(colors?.length ?? 0, MAX_PALETTE)

        for (let i = 0; i < count; i++)
            this.uPalette.array[i].set(colors[i])

        // Clearing keeps the old colors and count in place: the crossfade
        // eases back to the fallback look over the outgoing palette —
        // zeroing the count here would reshuffle everyone's member color
        // mid-fade
        if (count > 0)
            this.uPaletteCount.value = count

        this.paletteMixTarget = count > 0 ? 1 : 0
    }

    setWaveColors(colors) {
        if (!colors?.length)
            return

        const count = Math.min(colors.length, MAX_WAVE_COLORS)

        for (let i = 0; i < count; i++)
            this.uWaveColors.array[i].set(colors[i])

        this.uWaveColorCount.value = count
    }

    applyType(typeIndex) {
        const type = WAVE_TYPES[typeIndex]

        this.uWavePattern.value = type.pattern
        this.uWaveMove.value = type.move ? 1 : 0
        this.uWaveTint.value = type.tint ? 1 : 0
        this.uImageWave.value = type.image ? 1 : 0

        // The image sweep needs pictures; fall back to the default set
        if (type.image && !this.imageSet?.length)
            this.loadImageSet(DEFAULT_IMAGE_SET)
    }

    startWave(startedAt, forcedType = null) {
        this.waveStartedAt = startedAt

        // Same timestamp on every client -> same wave type everywhere
        // (forcedType is for the debug panel's local previews)
        this.applyType(forcedType ?? Math.abs(Math.floor(startedAt)) % RANDOM_WAVE_COUNT)
    }

    stopWave() {
        this.waveStartedAt = null
        this.uWaveTime.value = -1
    }

    // The debug panel's current numbers as a choreography cue
    // (shared/crowdChoreography.js schema) — at/until are placeholders
    buildCueFromDebug() {
        const type = WAVE_TYPES[this.debugParams.waveType]
        const round = (value, factor = 100) => Math.round(value * factor) / factor

        if (type.image) {
            const cue = {
                at: 0,
                until: round(this.uImageLapTime.value),
                action: 'imageSweep',
                images: this.imageSetKey ? this.imageSetKey.split('|') : [...DEFAULT_IMAGE_SET],
                copies: this.uImageCopies.value,
                lapTime: round(this.uImageLapTime.value),
            }

            if (this.uImageSweepSpeed.value > 0)
                cue.direction = 'ccw'

            if (this.uImageWaveBlackout.value !== 1)
                cue.blackout = false

            return cue
        }

        const cue = {
            at: 0,
            until: 10,
            action: 'wave',
            pattern: type.pattern === 0 ? 'radial' : 'sweep',
        }

        if (!type.move)
            cue.move = false

        if (type.tint) {
            cue.colors = this.debugParams.waveColor2
                ? [this.debugParams.waveColor, this.debugParams.waveColor2]
                : [this.debugParams.waveColor]

            // Gradient is the cue default — only per-wave needs the flag
            if (this.uWaveColorMode.value === 1)
                cue.colorMode = 'perWave'
        }

        if (type.move)
            cue.lift = round(this.uWaveLift.value)

        // Looping trains ignore the repeats count (every copy exists)
        if (!this.debugParams.loopWave)
            cue.repeats = Math.round(this.uWaveRepeats.value)

        cue.interval = round(this.uWaveInterval.value)

        if (type.pattern === 0) {
            cue.speed = round(this.uWaveSpeed.value)
            cue.width = round(this.uWaveWidth.value)
        } else {
            // lapTime = seconds for a full turn around the venue
            cue.lapTime = round((Math.PI * 2) / Math.abs(this.uSweepSpeed.value))
            cue.width = round(this.uSweepWidth.value, 1000)

            if (this.uSweepSpeed.value > 0)
                cue.direction = 'ccw'
        }

        // Cue default is loop: true — only a one-shot needs the flag
        if (!this.debugParams.loopWave)
            cue.loop = false

        return cue
    }

    // JS-object-literal formatting (unquoted keys, single-quoted strings)
    // so the cue pastes into shared/crowdChoreography.js in-house style
    formatCue(cue) {
        const formatValue = (value) => {
            if (Array.isArray(value))
                return `[${value.map(formatValue).join(', ')}]`

            if (typeof value === 'string')
                return `'${value}'`

            return String(value)
        }

        const body = Object.entries(cue)
            .map(([key, value]) => `    ${key}: ${formatValue(value)}`)
            .join(',\n')

        return `{\n${body}\n},`
    }

    copyCueToClipboard() {
        const json = this.formatCue(this.buildCueFromDebug())

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(json)
                .then(() => console.log(`Cue copied to clipboard:\n${json}`))
                .catch(() => console.log(`Clipboard unavailable — cue JSON:\n${json}`))
        } else {
            console.log(`Clipboard unavailable — cue JSON:\n${json}`)
        }
    }

    // Card-stunt wave: pass one image or an array (paths under public/) and
    // they circle the venue on a blacked-out crowd, one image per lap.
    // Omit `urls` to reuse the loaded set.
    startImageWave(startedAt, urls = null) {
        if (urls)
            this.loadImageSet(Array.isArray(urls) ? urls : [urls])

        this.startWave(startedAt, WAVE_TYPES.findIndex((type) => type.image))
    }

    update() {
        const network = this.network
        const dance = network.dance

        // Same beat math as the player lightsticks (Character.js), so the
        // fake crowd sways in phase with the real one
        let tempo = IDLE_TEMPO
        let time = network.serverClock.now() / 1000

        if (dance?.phase === 'playing') {
            const song = songs.find((candidate) => candidate.id === dance.songId)
            tempo = song?.tempo ?? IDLE_TEMPO
            time = Math.max(0, (network.serverClock.now() - dance.startedAt) / 1000)

            // The song's cue timeline runs off the same synced clock
            this.choreographer.update(time, dance)
        } else {
            this.choreographer.release()
        }

        this.uSwayPhase.value = (time * (tempo / 60) * Math.PI) % (Math.PI * 2)

        // Ease the idle-colors <-> song-palette crossfade toward its target
        if (this.uPaletteMix.value !== this.paletteMixTarget) {
            const fadeStep = (this.experience.time.delta / 1000) / this.paletteFade

            this.uPaletteMix.value = this.uPaletteMix.value < this.paletteMixTarget
                ? Math.min(this.paletteMixTarget, this.uPaletteMix.value + fadeStep)
                : Math.max(this.paletteMixTarget, this.uPaletteMix.value - fadeStep)
        }

        if (this.waveStartedAt !== null) {
            const waveTime = (network.serverClock.now() - this.waveStartedAt) / 1000

            // The last repeat starts (repeats - 1) intervals after the first;
            // a looping train never expires until toggled off. A sweep (image
            // or regular) lives one full lap, however slow the lap is set;
            // radial fronts cross the venue in WAVE_DURATION.
            const imageWave = this.uImageWave.value === 1
            const isSweep = this.uWavePattern.value === 1

            let baseLife = WAVE_DURATION
            if (imageWave)
                baseLife = this.uImageLapTime.value
            else if (isSweep)
                baseLife = (Math.PI * 2) / Math.abs(this.uSweepSpeed.value)

            const totalDuration = imageWave
                ? baseLife
                : baseLife + (this.uWaveRepeats.value - 1) * this.uWaveInterval.value
            // The loop uniform is the source of truth (the debug button and
            // choreography cues both drive it; debugParams may not exist)
            const looping = this.uWaveLoop.value === 1

            if (!looping && waveTime > totalDuration) {
                this.waveStartedAt = null
                this.uWaveTime.value = -1
            } else {
                this.uWaveTime.value = Math.max(0, waveTime)
            }
        }
    }
}
