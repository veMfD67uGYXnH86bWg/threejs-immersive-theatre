/**
 * Emote catalog — shared by client (buttons, hotkeys, sounds, animations)
 * and server (id validation + cooldown enforcement).
 *
 *   - sound: client-only, path under public/ played positionally from the
 *     emoting player's seat
 *   - cooldown: ms between uses per player, enforced server-side and
 *     mirrored on the emote button
 *   - toggle: on/off state held on the player server-side (late joiners see
 *     it) instead of a one-shot broadcast
 */
export default [
    {id: 'wave', name: 'Wave', icon: '👋', key: '1'},
    {id: 'clap', name: 'Clap', icon: '👏', key: '2'},
    {id: 'heart', name: 'Heart', icon: '💜', key: '3'},
    {id: 'cheer', name: 'Cheer', icon: '🎉', key: '4', sound: 'sounds/cheers.ogg', cooldown: 10000},
    {id: 'lightstick', name: 'Lightstick', icon: '🪩', key: '5', toggle: true},
    {id: 'crowdwave', name: 'Crowd wave', icon: '🌊', key: '6', cooldown: 20000},
]
