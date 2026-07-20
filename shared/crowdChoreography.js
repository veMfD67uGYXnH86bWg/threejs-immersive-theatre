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
 * 'imageSweep' — blackout + images circling the venue (card stunt):
 *   images   — Resources item names (sources.js) or paths under public/
 *   copies   — simultaneous fronts (1..4), round-robin over `images`
 *   scale    — image size on the crowd; 1 (default) = one image pixel per
 *              person. The crowd canvas is 14 rows tall and ~159 columns
 *              around at the front row (~298 at the back), so the images'
 *              total width must fit that budget or fronts overlap. Use
 *              13 / imageHeight to make art exactly fill the height.
 *   lapTime  — seconds per full lap
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
export default {
    // Lemonade — Aespa
    'song-a': [
        {
            at: 0,
            until: 16,
            action: 'imageSweep',
            images: ['giselle2', 'karina2', 'ningning2', 'winter2'],
            copies: 4,
            lapTime: 8,
            blackout: true,
            ease: {out: 0.5},
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
        {
            at: 40.5,
            until: 54,
            action: 'wave',
            pattern: 'sweep',
            lapTime: 5,
            lift: 1.4,
            ease: 1
        },
        {
            at: 60,
            until: 62,
            action: 'imageFlicker',
            images: ['lemonade1'],
            rate: 128 / 60,
            duty: 0.75,
            fade: 0.1,
            center: false,

        },
        {
            at: 67,
            until: 69,
            action: 'imageFlicker',
            images: ['lemonade1'],
            rate: 128 / 60,
            duty: 0.75,
            fade: 0.1,
            center: false,
            ease: {out: 0.5},

        },
        {
            at: 69,
            until: 84.5,
            action: 'wave',
            pattern: 'radial',
            colors: ['#e0ef00', '#2b6b0b'],
            lift: 1.15,
            interval: 1.2,
            speed: 22
        },
        {
            at: 101,
            until: 116,
            action: 'wave',
            pattern: 'sweep',
            colorMode: 'perWave',
            colors: ['#e0ef00', '#2b6b0b', '#ffffd1'],
            lift: 1.15,
            interval: 0.55,
            lapTime: 4,
            width: 0.348,
            ease: {in: 1}
        },


        // {
        //     at: 20,
        //     until: 44,
        //     action: 'imageSweep',
        //     images: ['lemonade1', 'lemonade2'],
        //     copies: 2,
        //     lapTime: 10,
        //     direction: 'ccw',
        //     blackout: false,
        // },
        // {
        //     at: 44,
        //     until: 60,
        //     action: 'wave',
        //     pattern: 'radial',
        //     colors: ['#ffd166', '#ff9de2'],
        //     repeats: 3,
        //     interval: 1.5,
        //     ease: {in: 0.5, out: 2}
        // },
        // {
        //     at: 62,
        //     until: 70,
        //     action: 'imageFlicker',
        //     images: ['lemonade1', 'lemonade2'],
        //     rate: 2,
        //     duty: 1,
        //     fade: 0.1,
        //     ease: {in: 0.5, out: 1}
        // },
    ],

    // Love Dive — IVE
    'song-b': [

        {
            at: 0,
            until: 64,
            action: 'imageSweep',
            images: ['yujin1', 'gaeul1', 'rei1', 'wonyoung1', 'liz1', 'leeseo1', 'ive1', 'lovedive1'],
            copies: 8,
            lapTime: 16,
            blackout: true,
            ease: {out: 0.5},
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
        // {
        //     at: 0,
        //     until: 181,
        //     action: 'wave',
        //     pattern: 'radial',
        //     colorMode: 'perWave',
        //     // colors: ['#76E1CE', '#56A4B8', '#498B8F'],
        //     colors: ['#76E1CE', '#3ef500', '#f80000'],
        //     lift: 1.15,
        //     interval: 1.2,
        //     speed: 22,
        //     ease: {in: 2}
        // },

        {
            at: 0,
            until: 181,
            action: 'wave',
            pattern: 'sweep',
            colorMode: 'perWave',
            colors: ['#76E1CE', '#56A4B8', '#498B8F'],
            // colors: ['#76E1CE', '#3ef500', '#f80000'],
            lift: 1.15,
            interval: 0.55,
            lapTime: 4,
            width: 0.348,
            ease: {in: 1}
        },
        // {
        //     at: 0,
        //     until: 181,
        //     action: 'wave',
        //     pattern: 'radial',
        //     colorMode: 'perWave',
        //     colors: ['#76E1CE', '#56A4B8', '#4E9496'],
        //     lift: 1.15,
        //     interval: 0.55,
        //     lapTime: 4,
        //     width: 0.348,
        //     ease: {in: 2}
        // },
        // 76E1CE
    ],

    // Obsession - EXO
    'song-e': [],
}
