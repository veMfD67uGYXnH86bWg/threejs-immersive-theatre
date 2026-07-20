/**
 * Song catalog — single source of truth for server (voting + playback clock)
 * and client (voting UI, YouTube embed, dancer animation).
 *
 * Per entry:
 *   - youtubeId: the official music video's YouTube id (null = no video yet,
 *     the placeholder dancer still dances). Use official uploads so the
 *     rights stay handled on YouTube's side.
 *   - duration: how long the room plays this song before the next vote, in
 *     ms. MUST match the video/dance length once real entries are in —
 *     placeholder values are short on purpose so rotation is easy to test.
 *   - tempo: BPM, drives the synced lightstick sway (and any future
 *     beat-driven effects). PLACEHOLDER guesses — set the real BPM per song.
 *   - colors: optional member/fandom colors, randomly distributed across
 *     the crowd's lightsticks while the song plays. Omit to fall back to
 *     the base stick color + HSL variation. PLACEHOLDER values.
 */
export default [
    {
        id: 'song-a',
        name: 'Lemonade',
        artist: 'Aespa',
        youtubeId: 'LBhcqYqeu0U',
        duration: 187000,
        tempo: 128,
        // colors: ['#e0ef00', '#52525e', '#2b6b0b', '#ffffd1'],
        colors: ['#e0ef00', '#2b6b0b', '#ffffd1'],
    },
    {
        id: 'song-b',
        name: 'Love Dive',
        artist: 'IVE',
        youtubeId: 'l-jZOXa7gQY',
        duration: 177000,
        tempo: 118,
        colors: ['#0e8bff', '#f74ae3', '#ffffff', "#d92133"]
    },
    {

        id: 'song-c',
        name: 'Cosmic',
        artist: 'Red Velvet',
        youtubeId: 'Q-ZxAm-yPE8',
        duration: 225000,
        tempo: 106,
        colors: ['#c21e56', '#eeb211', '#0070b8', '#32cd32', '#6c3082']
    },
    {

        id: 'song-d',
        name: 'The Cycle Ends',
        artist: 'Lena Raine',
        youtubeId: 'MokkEQR6tdI',
        duration: 181000,
        tempo: 120,
    },
    {

        id: 'song-e',
        name: 'Obsession',
        artist: 'EXO',
        youtubeId: 'TadhhUt9BPc',
        duration: 203000,
        tempo: 129,
    },
]
