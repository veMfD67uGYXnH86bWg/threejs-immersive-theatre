import Experience from '../Experience.js'
import Character from './Character.js'
import stringToColor from '../utils/stringToColor.js'

/**
 * Keeps the 3D characters in sync with the room state held by NetworkManager:
 * spawns one Character per player on their assigned seat, removes them when
 * they leave, and forwards emotes.
 *
 * Seats are slots in the crowd itself (the middle stand's front row), so
 * players sit among the audience — the fake body of each taken slot is
 * hidden, while its lightstick stays and becomes the player's own.
 */
export default class PlayerManager {
    constructor() {
        this.experience = new Experience()
        this.network = this.experience.network
        this.crowd = this.experience.world.crowd

        this.characters = new Map()

        this.setNetworkEvents()

        // The user may already be in a room before the world finished loading
        this.syncFromNetwork()

        console.log('PlayerManager loaded')
    }

    setNetworkEvents() {
        this.network.on('roomJoined', () => {
            this.syncFromNetwork()
        })

        this.network.on('roomLeft', () => {
            this.clear()
        })

        this.network.on('playerJoined', (player) => {
            this.spawn(player)
        })

        this.network.on('playerLeft', (player) => {
            this.despawn(player.id)
        })

        this.network.on('emotePlayed', ({id, emoteId}) => {
            this.characters.get(id)?.playEmote(emoteId)
        })
    }

    syncFromNetwork() {
        this.clear()

        for (const player of this.network.players.values())
            this.spawn(player)
    }

    spawn(player) {
        if (this.characters.has(player.id))
            return

        const seatTransform = this.crowd.getSeatTransform(player.seatIndex)
        const character = new Character(player, seatTransform, {
            isSelf: player.id === this.network.selfId,
        })

        this.characters.set(player.id, character)
        // Reveal the crowd pill + lightstick at this seat, tinting the pill
        // to the player's colour (same seed as their old avatar sphere)
        this.crowd.setPlayerSlotOccupied(
            player.seatIndex,
            true,
            stringToColor(player.username + player.id),
        )
    }

    despawn(id) {
        const character = this.characters.get(id)

        if (!character)
            return

        // Hide the seat's pill + lightstick again — nobody's there
        this.crowd.setPlayerSlotOccupied(character.player.seatIndex, false)

        character.destroy()
        this.characters.delete(id)
    }

    clear() {
        for (const id of [...this.characters.keys()])
            this.despawn(id)
    }

    update() {
        for (const character of this.characters.values())
            character.update()
    }
}
