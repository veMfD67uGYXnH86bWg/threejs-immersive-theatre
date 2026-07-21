/**
 * Emote catalog — shared by client (buttons, hotkeys, sounds, animations)
 * and server (id validation + cooldown enforcement).
 *
 *   - sound: client-only, path under public/ played positionally from the
 *     emoting player's seat
 *   - cooldown: ms between uses per player, enforced server-side and
 *     mirrored on the emote button
 *
 * Players hold a crowd lightstick by sitting in the stands (see Crowd.js),
 * so there is no personal lightstick emote.
 */
export default [
    {id: 'wave', name: 'Wave', icon: '👋', key: '1'},
    {id: 'clap', name: 'Clap', icon: '👏', key: '2'},
    {id: 'heart', name: 'Heart', icon: '💜', key: '3'},
    {id: 'cheer', name: 'Cheer', icon: '🎉', key: '4', sound: 'sounds/cheers.ogg', cooldown: 10000},
    {id: 'crowdwave', name: 'Crowd wave', icon: '🌊', key: '5', cooldown: 20000},
]
