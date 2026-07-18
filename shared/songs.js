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
        colors: ['#8fd6ff', '#ffd166', '#c2f970', '#ff9de2']
    },
    {
        id: 'song-b',
        name: 'Love Dive',
        artist: 'IVE',
        youtubeId: 'l-jZOXa7gQY',
        duration: 177000,
        tempo: 118
    },
    {

        id: 'song-c',
        name: 'Cosmic',
        artist: 'Red Velvet',
        youtubeId: 'Q-ZxAm-yPE8',
        duration: 225000,
        tempo: 106
    },
    {

        id: 'song-d',
        name: 'The Cycle Ends',
        artist: 'Lena Raine',
        youtubeId: 'MokkEQR6tdI',
        duration: 181000,
        tempo: 120
    },
    {

        id: 'song-e',
        name: 'Obsession',
        artist: 'EXO',
        youtubeId: 'TadhhUt9BPc',
        duration: 203000,
        tempo: 129,
        colors: ['#e84c3d', '#f1c40f', '#9b59b6', '#3498db', '#2ecc71', '#e67ce2']
    },
]
