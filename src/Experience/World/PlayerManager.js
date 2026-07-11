import Experience from '../Experience.js'
import Character from './Character.js'

/**
 * Keeps the 3D characters in sync with the room state held by NetworkManager:
 * spawns one Character per player on their assigned seat, removes them when
 * they leave, and forwards emotes.
 */
export default class PlayerManager {
    constructor() {
        this.experience = new Experience()
        this.network = this.experience.network
        this.theatreSeats = this.experience.world.theatreSeats

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

        this.network.on('lightstickToggled', ({id, active}) => {
            this.characters.get(id)?.setLightstickActive(active)
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

        const seatTransform = this.theatreSeats.getSeatTransform(player.seatIndex)
        const character = new Character(player, seatTransform, {
            isSelf: player.id === this.network.selfId,
        })

        this.characters.set(player.id, character)
    }

    despawn(id) {
        const character = this.characters.get(id)

        if (!character)
            return

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
