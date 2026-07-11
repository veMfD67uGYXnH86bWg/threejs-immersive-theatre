import Room from './Room.js'

// No ambiguous characters (0/O, 1/I) so codes are easy to share verbally
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5

// Each room holds timers and state — cap them so a bot spamming
// create-room can't grow memory unbounded
const MAX_ROOMS = 100

export default class RoomManager {
    constructor({onDanceState = null, onVotes = null} = {}) {
        this.rooms = new Map()
        this.onDanceState = onDanceState
        this.onVotes = onVotes
    }

    generateCode() {
        let code

        do {
            code = ''
            for (let i = 0; i < CODE_LENGTH; i++)
                code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
        } while (this.rooms.has(code))

        return code
    }

    createRoom({isPrivate = false} = {}) {
        if (this.rooms.size >= MAX_ROOMS)
            return null

        const room = new Room(this.generateCode(), {isPrivate})
        room.onDanceState = (state) => this.onDanceState?.(room, state)
        room.onVotes = (votes) => this.onVotes?.(room, votes)
        this.rooms.set(room.code, room)

        console.log(`Room ${room.code} created (private: ${room.isPrivate})`)

        return room
    }

    getRoom(code) {
        return this.rooms.get(code) ?? null
    }

    // First public room with a free seat, or a fresh one
    quickJoin() {
        for (const room of this.rooms.values()) {
            if (!room.isPrivate && !room.isFull)
                return room
        }

        return this.createRoom()
    }

    listPublicRooms() {
        return [...this.rooms.values()]
            .filter((room) => !room.isPrivate)
            .map((room) => ({
                code: room.code,
                playerCount: room.players.size,
                maxPlayers: room.maxPlayers,
                // null while the room is voting on the next song; the client
                // looks up name/artist in shared/songs.js from this id
                songId: room.currentSong?.id ?? null,
            }))
    }

    removeIfEmpty(code) {
        const room = this.rooms.get(code)

        if (room && room.isEmpty) {
            room.stopTimers()
            this.rooms.delete(code)
            console.log(`Room ${code} removed (empty)`)
        }
    }
}
