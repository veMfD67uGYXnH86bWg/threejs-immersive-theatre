import * as THREE from 'three/webgpu'
import choreographies from '../../../shared/crowdChoreography.js'

// Cue blend curves, selected per cue via `easing` (default 'smooth')
const EASINGS = {
    linear: (x) => x,
    smooth: (x) => x * x * (3 - 2 * x),
}

/**
 * Runs a song's cue timeline (shared/crowdChoreography.js) against the
 * synced song clock. Stateless by design: every frame it recomputes which
 * cues are active and applies them over the Crowd's default uniform values,
 * so seeking, late joins and reconnections all land in the correct state.
 *
 * A param stops being driven -> it snaps back to the default captured at
 * startup (so the debug panel stays usable outside cue windows, but manual
 * tweaks made BEFORE a cue window are also reverted by it — by design).
 * Overlapping cues: last one in the timeline wins.
 */
export default class CrowdChoreographer {
    constructor(crowd) {
        this.crowd = crowd

        // Every uniform a cue can drive, keyed by cue param name
        this.params = {
            stickColor: {node: crowd.uStickColor, color: true},
            hueVariation: {node: crowd.uHueVariation},
            satVariation: {node: crowd.uSatVariation},
            lightVariation: {node: crowd.uLightVariation},
            waveLift: {node: crowd.uWaveLift},
            waveAmp: {node: crowd.uWaveAmp},
            waveRepeats: {node: crowd.uWaveRepeats},
            waveInterval: {node: crowd.uWaveInterval},
            sweepWidth: {node: crowd.uSweepWidth},
            waveSpeed: {node: crowd.uWaveSpeed},
            waveWidth: {node: crowd.uWaveWidth},
            waveColorMode: {node: crowd.uWaveColorMode},
            sweepSpeed: {node: crowd.uSweepSpeed},
            wavePattern: {node: crowd.uWavePattern},
            waveMove: {node: crowd.uWaveMove},
            waveTint: {node: crowd.uWaveTint},
            waveLoop: {node: crowd.uWaveLoop},
            imageWave: {node: crowd.uImageWave},
            imageSolo: {node: crowd.uImageSolo},
            imageCenter: {node: crowd.uImageCenterOnly},
            imageBlackout: {node: crowd.uImageBlackout},
            imageFlash: {node: crowd.uImageFlash},
            imageWrap: {node: crowd.uImageWrap},
            imageWaveBlackout: {node: crowd.uImageWaveBlackout},
            imageCopies: {node: crowd.uImageCopies},
            imageLapTime: {node: crowd.uImageLapTime},
            imageSweepSpeed: {node: crowd.uImageSweepSpeed},
        }

        // The neutral state cues blend from and release back to
        this.defaults = {}
        for (const [key, param] of Object.entries(this.params))
            this.defaults[key] = param.color ? param.node.value.clone() : param.node.value

        this.touched = new Set()
        this.frameTouched = new Set()
        this.drivingWave = false
        this.waveColorsCue = null
        this.workColor = new THREE.Color()
    }

    update(songTime, dance) {
        const cues = choreographies[dance.songId]

        if (!cues?.length) {
            this.release()
            return
        }

        this.frameTouched = new Set()
        let waveCue = null

        for (const cue of cues) {
            if (songTime < cue.at || songTime >= (cue.until ?? Infinity))
                continue

            const blend = this.blendFor(cue, songTime)

            if (cue.action === 'stickColor')
                this.applyStickColor(cue, blend)
            else if (cue.action === 'imageFlicker')
                this.applyImageFlicker(cue, blend, songTime)
            else if (cue.action === 'wave' || cue.action === 'imageSweep')
                waveCue = {cue, blend} // wave machinery is shared: last wins
        }

        if (waveCue)
            this.applyWaveCue(waveCue.cue, waveCue.blend, dance)
        else
            this.releaseWave()

        // Params driven last frame but not this frame go back to default
        for (const key of this.touched) {
            if (!this.frameTouched.has(key))
                this.restore(key)
        }

        this.touched = this.frameTouched
    }

    // No song playing (or none with cues): hand everything back
    release() {
        for (const key of this.touched)
            this.restore(key)

        this.touched = new Set()
        this.releaseWave()
    }

    releaseWave() {
        if (!this.drivingWave)
            return

        this.drivingWave = false
        this.crowd.stopWave()

        if (this.waveColorsCue) {
            this.waveColorsCue = null
            this.crowd.syncWaveColors()
        }
    }

    applyStickColor(cue, blend) {
        this.apply('stickColor', cue.color, blend)

        if (cue.hueVariation != null)
            this.apply('hueVariation', cue.hueVariation, blend)

        if (cue.satVariation != null)
            this.apply('satVariation', cue.satVariation, blend)

        if (cue.lightVariation != null)
            this.apply('lightVariation', cue.lightVariation, blend)
    }

    // Strobe the static card-stunt display: the image blinks on/off on the
    // center stand (all stands with center: false), rotating through the
    // cue's images, one per flash. Everything is a pure function of song
    // time, so every client flashes in unison; the cue's ease scales the
    // overall intensity in/out at the window edges, `fade` shapes each
    // individual flash.
    applyImageFlicker(cue, blend, songTime) {
        const rate = cue.rate ?? 2 // flashes per second
        const duty = cue.duty ?? 0.5 // fraction of each cycle spent on
        const phase = (songTime - cue.at) * rate
        const cycle = Math.floor(phase)
        const cycleTime = phase - cycle // 0..1 through the current flash cycle

        // Next image each flash; the swap lands on the cycle boundary,
        // while the display is dark (no-op unless it actually changes)
        const images = cue.images ?? (cue.image ? [cue.image] : null)

        if (images?.length)
            this.crowd.loadImage(images[cycle % images.length])

        // Per-flash envelope: hard on/off by default; `fade` (seconds)
        // ramps each flash in and out instead, clamped so ramps never
        // overlap even on short duties
        const on = cycleTime < duty
        let flash = 0

        if (on) {
            const fade = Math.min((cue.fade ?? 0) * rate, duty / 2)

            flash = fade > 0
                ? Math.max(0, Math.min(cycleTime / fade, (duty - cycleTime) / fade, 1))
                : 1
            flash = (EASINGS[cue.easing] ?? EASINGS.smooth)(flash)
        }

        // Two fade styles, picked automatically:
        // - dark fade (blackout cues, and duty 1 slideshows): the envelope
        //   dims the image toward BLACK in place — the crowd colors never
        //   bleed through mid-transition
        // - crowd fade (strobe over a lit crowd): the envelope dissolves
        //   the image into the normal stick colors, as before
        const darkFade = Boolean(cue.blackout) || duty >= 1

        this.apply('imageSolo', on ? (darkFade ? blend : flash * blend) : 0)
        this.apply('imageFlash', darkFade ? flash : 1)
        // center: true — image on the center stand only (per-stand grid);
        // center: false — ONE image wrapped around the bowl, bleeding onto
        // the side stands when wider than the back stand
        const centered = cue.center !== false
        this.apply('imageCenter', centered ? 1 : 0)
        this.apply('imageWrap', centered ? 0 : 1)

        // Blackout follows the window ease (not the flash), so the venue
        // darkens once and stays dark while the image blinks
        this.apply('imageBlackout', cue.blackout ? blend : 0)
    }

    applyWaveCue(cue, blend, dance) {
        const crowd = this.crowd
        const image = cue.action === 'imageSweep'

        // The cue's ease drives the master wave intensity: glow, lift, hop
        // and the image blackout all scale with it, so the wave fades in
        // and out instead of popping (target IS the blend, applied fully)
        this.apply('waveAmp', blend)

        // Wave configuration: discrete, never eased
        this.apply('wavePattern', image || cue.pattern !== 'radial' ? 1 : 0)
        this.apply('waveMove', !image && (cue.move ?? true) ? 1 : 0)
        this.apply('waveTint', !image && (cue.tint ?? Boolean(cue.color || cue.colors)) ? 1 : 0)
        this.apply('waveLoop', (cue.loop ?? true) ? 1 : 0)
        this.apply('imageWave', image ? 1 : 0)

        if (cue.lift != null)
            this.apply('waveLift', cue.lift, blend)

        if (cue.repeats != null)
            this.apply('waveRepeats', cue.repeats)

        if (cue.interval != null)
            this.apply('waveInterval', cue.interval)

        // Front thickness: units for radial waves, radians for sweeps
        if (cue.width != null) {
            if (!image && cue.pattern === 'radial')
                this.apply('waveWidth', cue.width, blend)
            else
                this.apply('sweepWidth', cue.width)
        }

        if (cue.speed != null)
            this.apply('waveSpeed', cue.speed, blend)

        // Sweep travel direction: 'cw' (default) or 'ccw'; negative rad/s
        // is clockwise. Applied even without a lapTime, so direction alone
        // can flip a default-speed sweep. lapTime is seconds per full turn
        // (2π) for both the image sweep and the regular sweep.
        if (image || cue.pattern !== 'radial') {
            const direction = cue.direction === 'ccw' ? 1 : -1

            if (image) {
                const lapTime = cue.lapTime ?? this.defaults.imageLapTime
                this.apply('imageLapTime', lapTime)
                this.apply('imageSweepSpeed', direction * (Math.PI * 2) / lapTime)
            } else {
                const lapTime = cue.lapTime ?? (Math.PI * 2) / Math.abs(this.defaults.sweepSpeed)
                this.apply('sweepSpeed', direction * (Math.PI * 2) / lapTime)
            }
        }

        if (image) {
            crowd.loadImageSet(cue.images) // no-op when already loaded

            if (cue.copies != null)
                this.apply('imageCopies', cue.copies)

            // blackout: false keeps the crowd lit under the passing images
            this.apply('imageWaveBlackout', cue.blackout === false ? 0 : 1)
        }

        // Wave color sequence is a side effect (uniformArray), swapped once
        // per cue and restored on release
        // 'perWave': each consecutive front takes the next color of the
        // sequence whole, instead of every front fading through all of them
        this.apply('waveColorMode', cue.colorMode === 'perWave' ? 1 : 0)

        const colors = cue.colors ?? (cue.color ? [cue.color] : null)

        if (colors && this.waveColorsCue !== cue) {
            crowd.setWaveColors(colors)
            this.waveColorsCue = cue
        } else if (!colors && this.waveColorsCue) {
            this.waveColorsCue = null
            crowd.syncWaveColors()
        }

        // Anchored to song time: every client (however late it joined)
        // computes the same wave phase
        crowd.waveStartedAt = dance.startedAt + cue.at * 1000
        this.drivingWave = true
    }

    // Set one uniform to default->target at `blend` (colors lerp, numbers mix)
    apply(key, target, blend = 1) {
        const param = this.params[key]
        const fallback = this.defaults[key]

        if (param.color)
            param.node.value.copy(fallback).lerp(this.workColor.set(target), blend)
        else
            param.node.value = fallback + (target - fallback) * blend

        this.frameTouched.add(key)
    }

    restore(key) {
        const param = this.params[key]

        if (param.color)
            param.node.value.copy(this.defaults[key])
        else
            param.node.value = this.defaults[key]
    }

    // 0..1 blend from the cue's ease windows, pure function of song time
    blendFor(cue, songTime) {
        if (!cue.ease)
            return 1

        const easeIn = typeof cue.ease === 'object' ? cue.ease.in ?? 0 : cue.ease
        const easeOut = typeof cue.ease === 'object' ? cue.ease.out ?? 0 : cue.ease

        let blend = 1

        if (easeIn > 0)
            blend = Math.min(blend, (songTime - cue.at) / easeIn)

        if (cue.until != null && easeOut > 0)
            blend = Math.min(blend, (cue.until - songTime) / easeOut)

        const curve = EASINGS[cue.easing] ?? EASINGS.smooth

        return curve(Math.min(1, Math.max(0, blend)))
    }
}
