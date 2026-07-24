/**
 * Crowd choreography — per-song cue timelines, keyed by song id (songs.js).
 *
 * Purely client-side: every client runs the same cues against the synced
 * song clock (dance.startedAt + ServerClock), so no network traffic is
 * needed and late joiners land mid-cue in the correct state. The runner is
 * CrowdChoreographer.js; it re-evaluates the timeline every frame, so cues
 * are declarative state over time, not fire-and-forget events.
 *
 * Cue shape (times in seconds of song time):
 *   at      — when the cue becomes active
 *   until   — when it ends; omit = stays active for the rest of the song
 *   action  — 'stickColor' | 'wave' | 'imageSweep'
 *   ease    — seconds to blend in/out of the cue's numeric params, either
 *             one number or {in, out}. Omit = instant.
 *   easing  — blend curve: 'smooth' (default) or 'linear'
 *
 * 'stickColor' — recolor the crowd's lightsticks:
 *   color                          — base stick color
 *   hueVariation / satVariation /
 *   lightVariation                 — per-person spread overrides (optional)
 *
 * 'wave' — a wave running for the cue's whole window:
 *   pattern  — 'sweep' (default) or 'radial'
 *   move     — sticks lift / bodies hop (default true)
 *   tint     — tint through the wave colors (default: true when a color is given)
 *   color    — single wave color, or:
 *   colors   — wave color sequence (like a song's member colors)
 *   colorMode— 'gradient' (default): every front fades through `colors` by
 *              intensity; 'perWave': each consecutive front takes the next
 *              color in `colors`, whole
 *   lift     — stick lift height
 *   repeats / interval — wave train settings (radial trains mostly)
 *   interval — seconds between spawned fronts (a new front every interval)
 *   lapTime  — sweep: seconds for a front to travel one full turn around
 *              the venue (it fades out behind the stage as it completes it)
 *   direction— sweep travel: 'cw' (default) or 'ccw'
 *   speed    — radial: front speed in units/s
 *   width    — front thickness: world units on radial waves (default 6),
 *              radians on sweeps (default 0.4)
 *   loop     — default true: waves keep coming for the whole window;
 *              false = one single wave fired at `at`
 *
 * 'imageSweep' — blackout + a strip of images travelling around the venue
 * like a marquee (card stunt). The images are laid end to end in array
 * order, so they can never overlap however wide they are — a set wider than
 * the venue simply scrolls through like a ticker.
 *   images   — Resources item names (sources.js) or paths under public/,
 *              in the order they appear along the strip (max 8)
 *   spacing  — gap between images, in columns. One column is the arc one
 *              person occupies, the same unit as the images' pixel widths,
 *              so `spacing: 30` next to a 60px image is a half-image gap.
 *   start    — degrees of travel from behind the stage to image 1's leading
 *              edge at the cue's start (default 0 = the sequence begins
 *              behind the stage). Images run dead zone -> stage right ->
 *              back stand -> stage left -> dead zone, so ~225 starts them
 *              at the near edge of the stage-left stand.
 *   lapTime  — seconds for the strip to travel one full turn
 *   loop     — true (default): endless marquee, the sequence repeats; false:
 *              the strip passes by once. The repeat seam sits behind the
 *              stage, where there are no stands to see it.
 *   direction— travel: 'cw' (default) or 'ccw'
 *   blackout — true (default): the venue blacks out under the images;
 *              false: the crowd stays lit, images ride over it
 *
 * 'imageFlicker' — the static card-stunt display blinking on and off,
 * beat-synced across clients (song-time driven):
 *   image    — Resources item name or path under public/, or:
 *   images   — array of them, rotating one image per flash
 *   rate     — flashes per second (default 2)
 *   duty     — fraction of each cycle the image is on (default 0.5)
 *   fade     — seconds each flash ramps in/out (default 0 = hard on/off).
 *              With blackout (or duty 1) the ramp dims the image toward
 *              black; otherwise it dissolves into the lit crowd
 *   center   — true (default): image on the center stand only; false: one
 *              continuous image wrapped around the bowl, bleeding onto the
 *              side stands when it's wider than the back stand
 *   blackout — true: every other stick fades to black for the cue's whole
 *              window, imageSweep-style (default false)
 *
 * Overlapping cues: the LAST one in the array wins the contested params
 * ('wave' and 'imageSweep' contend for the wave machinery; 'stickColor' is
 * independent and can overlap either).
 */

const flickerLemonade = {
    action: 'imageFlicker',
    images: ['lemonade1'],
    rate: 128 / 60,
    duty: 0.75,
    fade: 0.1,
    center: false,
    // ease: {out: 0.5},
}

const chorusLemonade = {
    action: 'wave',
    pattern: 'radial',
    colors: ['#e0ef00', '#2b6b0b'],
    lift: 1.15,
    interval: 1.2,
    speed: 22,
    ease: {in: 1, out: 1}
}

const prechorusLemonade = {
    action: 'wave',
    pattern: 'sweep',
    colorMode: 'perWave',
    colors: ['#e0ef00', '#2b6b0b', '#ffffd1'],
    lift: 1.15,
    interval: 0.55,
    lapTime: 4,
    width: 0.348,
    ease: {in: 1, out: 1}
}

const verseLemonade = {
    action: 'wave',
    pattern: 'sweep',
    lapTime: 5,
    lift: 1.4,
    ease: {in: 1, out: 1}
}

export default {


    // Lemonade — Aespa
    'song-a': [
        // Intro
        {
            at: 0,
            until: 9,
            action: 'imageSweep',
            images: ['giselle2', 'karina2', 'ningning2', 'winter2'],
            spacing: 30,
            lapTime: 8,
            blackout: true,
            ease: {in: 1, out: 1}
        },
        {
            at: 20,
            until: 23,
            action: 'imageFlicker',
            images: ['lemonade1', 'lemonade2'],
            rate: 128 / 60,
            duty: 1,
            // fade: 0.1,
            center: false,
            blackout: true,
            ease: {out: 0.5},

        },
        // Verse 1
        {
            at: 23,
            until: 40.5,
            ...verseLemonade,
        },
        {
            at: 40.5,
            until: 54,
            ...verseLemonade,
            direction: 'ccw',
        },
        {
            at: 60,
            until: 62.25,
            ...flickerLemonade,
        },

        // Pre-Chorus 1
        {
            at: 54,
            until: 69,
            ...prechorusLemonade,
        },
        {
            at: 67,
            until: 69.25,
            ...flickerLemonade,

        },

        // Chorus 1
        {
            at: 69,
            until: 84.5,
            ...chorusLemonade,
        },
        {
            at: 82,
            until: 84.25,
            ...flickerLemonade,
        },
        // Verse 2
        {
            at: 86,
            until: 101,
            ...verseLemonade,
        },
        // Pre-Chorus 2
        {
            at: 101,
            until: 116,
            ...prechorusLemonade,
        },
        {
            at: 106.5,
            until: 108.75,
            ...flickerLemonade
        },
        {
            at: 114,
            until: 116.25,
            ...flickerLemonade
        },

        // Chorus 2
        {
            at: 116,
            until: 131,
            ...chorusLemonade,
        },
        {
            at: 129,
            until: 131.25,
            ...flickerLemonade
        },

        // Bridge 131 to 154 bridge
        {
            at: 131.25,
            until: 149.5, // 154
            action: 'imageSweep',
            images: ['lemonade2', 'lemonade1', 'ningning1', 'winter1', 'giselle1', 'karina1'],
            spacing: 30,
            start: -550,
            lapTime: 8,
            loop: false,
            blackout: true,
            ease: {in: 1, out: 1}
        },
        // Chorus 3
        {
            at: 153.5,
            until: 183,
            ...chorusLemonade,
        },
        {
            at: 159,
            until: 161.25,
            ...flickerLemonade
        },
        {
            at: 167,
            until: 169.25,
            ...flickerLemonade
        },
        {
            at: 181.5,
            until: 183.75,
            ...flickerLemonade
        },

    ],

    // Love Dive — IVE
    'song-b': [
        {
            at: 0,
            until: 22,
            action: 'imageSweep',
            images: ['lovedive1', 'ive1', 'leeseo1', 'liz1', 'wonyoung1', 'rei1', 'gaeul1', 'yujin1'],
            spacing: 25,
            start: -720,
            // start: 360,
            lapTime: 8,
            loop: false,
            blackout: true,
            ease: {out: 1},
            // direction: 'ccw',
        },
    ],

    // Cosmic - Red Velvet
    'song-c': [
        {
            at: 0,
            until: 225,
            action: 'wave',
            pattern: 'sweep',
            colorMode: 'perWave',
            colors: ['#c21e56', '#eeb211', '#0070b8', '#32cd32', '#6c3082'],
            lift: 1.15,
            interval: 0.55,
            lapTime: 4,
            width: 0.348,
            ease: {in: 2}
        },
    ],

    // The Cycle Ends - Lena Raine
    'song-d': [
        {
            at: 0,
            until: 181,
            action: 'wave',
            pattern: 'sweep',
            colorMode: 'perWave',
            colors: ['#76E1CE', '#04bb43'],
            // colors: ['#76E1CE', '#3ef500', '#f80000'],
            lift: 1.15,
            interval: 0.55,
            lapTime: 4,
            width: 0.348,
            ease: {in: 1}
        },
    ],

    // Cream Soda - EXO
    'song-e': [],

    // Here, Tomorrow - Lilas, Kevin Penkin, League of Legends
    'song-f': [],
}
