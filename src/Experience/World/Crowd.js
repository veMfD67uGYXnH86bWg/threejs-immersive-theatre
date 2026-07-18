import * as THREE from 'three/webgpu'
import {abs, attribute, clamp, color, exp, float, hash, hue, instanceIndex, max, mix, PI, positionLocal, saturation, select, sin, step, TWO_PI, uniform, uniformArray, varying, vec3} from 'three/tsl'
import Experience from '../Experience.js'
import songs from '../../../shared/songs.js'
import {STANDS, STAND_ROWS, STEP_HEIGHT, STEP_DEPTH} from './Stadium.js'

const PERSON_SPACING = 0.95
const IDLE_TEMPO = 90
const WAVE_SPEED = 22 // units/s, wave front radius growth from the stage
const WAVE_WIDTH = 6
// Color-only radial waves have no motion to catch the eye, so they travel
// slower and wider — otherwise the tint crosses the stands in a ~1.5s blink
const COLOR_WAVE_SPEED_FACTOR = 0.5
const COLOR_WAVE_WIDTH_FACTOR = 1.8
const WAVE_LIFT = 0.9
const WAVE_DURATION = 6 // s, enough for the front to cross the whole venue
const SWEEP_SPEED = (Math.PI * 2) / 2.8 // rad/s — negate to flip direction
const SWEEP_WIDTH = 0.55 // radians
const STAGE_CENTER = {x: 0, z: -7}

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
]

// The shader loops over this many potential wave copies (repeats), each
// offset by the wave interval — overlapping fronts sum together
const MAX_REPEATS = 8

// Uniform arrays are fixed-size: room for this many member colors per song
const MAX_PALETTE = 12

// Tinting waves fade through a color sequence as the pulse rises and falls.
// The sequence comes from the playing song's `colors` (shared/songs.js);
// without one, it's derived from this fallback color as
// [color +30 lightness, color, color +30 lightness].
const WAVE_COLOR_FALLBACK = '#ffd166'
const MAX_WAVE_COLORS = 8

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

        this.slots = this.buildSlots()
        this.setBodies()
        this.setLightsticks()
        this.setNetworkEvents()
        this.setDebug()

        console.log(`Crowd loaded (${this.slots.length} people)`)
    }

    setDebug() {
        if (!this.debug.active)
            return

        this.debugFolder = this.debug.ui.addFolder({
            title: 'Crowd',
            expanded: true,
        })

        this.debugParams = {
            waveType: 0,
            loopWave: false,
            lightstickColor: '#ff2d95',
            waveColor: WAVE_COLOR_FALLBACK,
        }

        this.debugFolder.addBlade({
            view: 'list',
            label: 'Wave type',
            options: WAVE_TYPES.map((type, index) => ({text: type.name, value: index})),
            value: 0,
        }).on('change', (event) => {
            this.debugParams.waveType = event.value

            // While looping, switch the running train's type live
            if (this.debugParams.loopWave)
                this.applyType(event.value)
        })

        // Local preview only — doesn't broadcast to the room
        this.debugFolder.addButton({title: 'Trigger wave'}).on('click', () => {
            this.startWave(this.network.serverClock.now(), this.debugParams.waveType)
        })

        // Endless wave train: a new front every interval until toggled off
        const loopButton = this.debugFolder.addButton({title: 'Loop wave: off'})
        loopButton.on('click', () => {
            this.debugParams.loopWave = !this.debugParams.loopWave
            loopButton.title = this.debugParams.loopWave ? 'Loop wave: ON' : 'Loop wave: off'
            this.uWaveLoop.value = this.debugParams.loopWave ? 1 : 0

            if (this.debugParams.loopWave)
                this.startWave(this.network.serverClock.now(), this.debugParams.waveType)
        })

        this.debugFolder.addBinding(this.uWaveRepeats, 'value', {
            label: 'Wave repeats',
            min: 1,
            max: MAX_REPEATS,
            step: 1,
        })

        this.debugFolder.addBinding(this.uWaveInterval, 'value', {
            label: 'Wave interval (s)',
            min: 0.2,
            max: 4,
            step: 0.05,
        })

        this.debugFolder.addBinding(this.uWaveJitter, 'value', {
            label: 'Reaction spread (s)',
            min: 0,
            max: 0.5,
            step: 0.01,
        })

        this.debugFolder.addBinding(this.debugParams, 'lightstickColor', {
            label: 'Stick color',
        }).on('change', (event) => {
            this.uStickColor.value.set(event.value)
        })

        // Fallback wave color, used when the playing song has no `colors`
        this.debugFolder.addBinding(this.debugParams, 'waveColor', {
            label: 'Wave color',
        }).on('change', (event) => {
            this.waveColorFallback.set(event.value)
            this.syncWaveColors()
        })

        this.debugFolder.addBinding(this.uHueVariation, 'value', {
            label: 'Hue variation',
            min: 0,
            max: 1,
            step: 0.01,
        })

        this.debugFolder.addBinding(this.uSatVariation, 'value', {
            label: 'Sat variation',
            min: 0,
            max: 1,
            step: 0.01,
        })

        this.debugFolder.addBinding(this.uLightVariation, 'value', {
            label: 'Light variation',
            min: 0,
            max: 1,
            step: 0.01,
        })
    }

    // One slot per fake person on the stand steps. Deterministic jitter so
    // every client builds the identical crowd.
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

    // Baked distance and azimuth to the stage per instance — what the
    // radial and sweep wave fronts are measured against
    setInstanceAttributes(geometry) {
        const distances = new Float32Array(this.slots.length)
        const angles = new Float32Array(this.slots.length)

        this.slots.forEach((slot, index) => {
            distances[index] = slot.distance
            angles[index] = slot.angle
        })

        geometry.setAttribute('crowdDistance', new THREE.InstancedBufferAttribute(distances, 1))
        geometry.setAttribute('crowdAngle', new THREE.InstancedBufferAttribute(angles, 1))
    }

    // Gaussian pulse around the travelling wave front(s), 0 while inactive.
    // Up to MAX_REPEATS copies of the wave run simultaneously, each offset
    // by uWaveInterval — their pulses sum, so overlapping fronts stack.
    // The repeat loop is unrolled in JS at material-build time: each copy is
    // one more term in the expression tree, no GPU-side control flow needed.
    // Returns the pulse split into its two uses: `move` (lift/hop — zero for
    // color-only waves) and `glow` (brightness/tint — all wave types).
    wavePulse() {
        const dist = attribute('crowdDistance', 'float')
        const angle = attribute('crowdAngle', 'float')
        const isSweep = this.uWavePattern.equal(1)

        // exp(-x²) — squared via self-multiplication because WGSL pow() is
        // undefined for negative bases
        const bell = (x) => exp(x.mul(x).negate())

        // Tint-without-movement waves have nothing to catch the eye, so
        // only they get the slower, wider radial front
        const colorOnlyFlag = this.uWaveTint.mul(float(1).sub(this.uWaveMove))
        const radialSpeed = mix(float(WAVE_SPEED), float(WAVE_SPEED * COLOR_WAVE_SPEED_FACTOR), colorOnlyFlag)
        const radialWidth = mix(float(WAVE_WIDTH), float(WAVE_WIDTH * COLOR_WAVE_WIDTH_FACTOR), colorOnlyFlag)

        // Loop mode: wrap time modulo the interval (offset so all copies are
        // live) — the MAX_REPEATS unrolled copies then act as the youngest
        // fronts of an infinite train, each reborn at the stage as it exits
        const loopedTime = this.uWaveTime.mod(this.uWaveInterval)
            .add(this.uWaveInterval.mul(MAX_REPEATS - 1))

        // Per-person reaction jitter: everyone perceives the front slightly
        // early or late (centered, so the wave's average timing is unchanged)
        const reactionJitter = hash(instanceIndex.add(41)).sub(0.5).mul(this.uWaveJitter)
        const waveTime = mix(this.uWaveTime, loopedTime, this.uWaveLoop).sub(reactionJitter)

        let sum = float(0)

        for (let i = 0; i < MAX_REPEATS; i++) {
            // In loop mode every copy exists regardless of the repeats slider
            const exists = step(i, this.uWaveRepeats.sub(1)).max(this.uWaveLoop)
            const copyTime = waveTime.sub(this.uWaveInterval.mul(i))
            const started = step(0, copyTime)

            // Radial: front travels outward from the stage
            const radialFront = dist.sub(copyTime.mul(radialSpeed))
            const radial = bell(radialFront.div(radialWidth))

            // Sweep: front circles the venue; wrap the angle diff to [-π, π]
            const sweepAngle = copyTime.mul(SWEEP_SPEED)
            const angleDelta = angle.sub(sweepAngle).add(PI).mod(TWO_PI).sub(PI)
            const sweepFade = clamp(copyTime, 0, 1).mul(clamp(float(WAVE_DURATION).sub(copyTime), 0, 1))
            const sweep = bell(angleDelta.div(SWEEP_WIDTH)).mul(sweepFade)

            sum = sum.add(select(isSweep, sweep, radial).mul(started).mul(exists))
        }

        const glow = sum.min(1.5).mul(step(0, this.uWaveTime))

        return {
            move: glow.mul(this.uWaveMove),
            glow,
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
        const hop = this.wavePulse().move.mul(0.18)
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

        const base = select(this.uPaletteCount.greaterThan(0), member, fallback)

        const {move, glow} = this.wavePulse()

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
        const waveColor = mix(
            this.uWaveColors.element(gradientIndex),
            this.uWaveColors.element(nextIndex),
            gradientPos.fract(),
        )

        const tinted = mix(base, waveColor, waveGlow.mul(this.uWaveTint).min(1))
        const beatPulse = max(sin(this.uSwayPhase.mul(2)), 0).pow(4).mul(0.25)
        material.colorNode = tinted.mul(waveGlow.mul(2.0).add(beatPulse).add(0.9))

        const sway = sin(this.uSwayPhase.add(hash(instanceIndex).mul(0.9))).mul(0.16)
        material.positionNode = positionLocal.add(vec3(sway, move.mul(WAVE_LIFT), 0))

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

        const hsl = {}
        this.waveColorFallback.getHSL(hsl)
        const lighter = new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + 0.3))

        this.setWaveColors([lighter, this.waveColorFallback, lighter])
    }

    setPalette(colors) {
        const count = Math.min(colors?.length ?? 0, MAX_PALETTE)

        for (let i = 0; i < count; i++)
            this.uPalette.array[i].set(colors[i])

        this.uPaletteCount.value = count
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
    }

    startWave(startedAt, forcedType = null) {
        this.waveStartedAt = startedAt

        // Same timestamp on every client -> same wave type everywhere
        // (forcedType is for the debug panel's local previews)
        this.applyType(forcedType ?? Math.abs(Math.floor(startedAt)) % WAVE_TYPES.length)
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
        }

        this.uSwayPhase.value = (time * (tempo / 60) * Math.PI) % (Math.PI * 2)

        if (this.waveStartedAt !== null) {
            const waveTime = (network.serverClock.now() - this.waveStartedAt) / 1000

            // The last repeat starts (repeats - 1) intervals after the first;
            // a looping train never expires until toggled off
            const totalDuration = WAVE_DURATION
                + (this.uWaveRepeats.value - 1) * this.uWaveInterval.value
            const looping = this.debugParams?.loopWave === true

            if (!looping && waveTime > totalDuration) {
                this.waveStartedAt = null
                this.uWaveTime.value = -1
            } else {
                this.uWaveTime.value = Math.max(0, waveTime)
            }
        }
    }
}
