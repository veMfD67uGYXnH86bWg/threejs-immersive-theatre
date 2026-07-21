import songs from '../shared/songs.js'

const MAX_PLAYERS = 10
const CHAT_HISTORY_LIMIT = 50
const CHAT_RATE_LIMIT = {maxMessages: 5, windowMs: 5000}
const VOTING_DURATION = 30000
const PREPARE_DURATION = 5000 // "up next" intermission between vote and song

export default class Room {
    constructor(code, {isPrivate = false} = {}) {
        this.code = code
        this.isPrivate = isPrivate
        this.maxPlayers = MAX_PLAYERS
        this.players = new Map()
        this.chatHistory = []

        // The room owns the dance state machine: a voting phase picks the
        // next song (most votes wins, ends early once everyone voted), a
        // short "preparing" intermission announces the winner (and gives the
        // client room for stage-transition animations), the song plays out
        // on the room's clock, then back to voting. Clients derive the
        // playback position from `startedAt` (server time), so everyone —
        // including late joiners — sees the same moment.
        this.onDanceState = null
        this.onVotes = null
        this.phaseTimer = null
        this.votes = new Map()
        this.startVoting()
    }

    get isFull() {
        return this.players.size >= this.maxPlayers
    }

    get isEmpty() {
        return this.players.size === 0
    }

    startVoting() {
        this.phase = 'voting'
        this.votes.clear()
        this.currentSong = null
        this.phaseEndsAt = Date.now() + VOTING_DURATION

        clearTimeout(this.phaseTimer)
        this.phaseTimer = setTimeout(() => this.startPreparing(), VOTING_DURATION)

        if (this.onDanceState)
            this.onDanceState(this.getDanceState())
    }

    startPreparing() {
        const counts = this.getVoteCounts()
        const highest = Math.max(0, ...Object.values(counts))

        // Most votes wins; ties (or no votes at all) resolve randomly
        const pool = highest > 0
            ? songs.filter((song) => counts[song.id] === highest)
            : songs

        this.phase = 'preparing'
        this.currentSong = pool[Math.floor(Math.random() * pool.length)]
        this.phaseEndsAt = Date.now() + PREPARE_DURATION

        clearTimeout(this.phaseTimer)
        this.phaseTimer = setTimeout(() => this.startPlaying(), PREPARE_DURATION)

        if (this.onDanceState)
            this.onDanceState(this.getDanceState())
    }

    startPlaying() {
        this.phase = 'playing'
        this.playbackStartedAt = Date.now()

        clearTimeout(this.phaseTimer)
        this.phaseTimer = setTimeout(() => this.startVoting(), this.currentSong.duration)

        if (this.onDanceState)
            this.onDanceState(this.getDanceState())
    }

    castVote(playerId, songId) {
        if (this.phase !== 'voting')
            return
        if (!this.players.has(playerId))
            return
        if (!songs.some((song) => song.id === songId))
            return

        this.votes.set(playerId, songId)

        // No point waiting out the timer once every player has voted
        if (this.votes.size >= this.players.size)
            this.startPreparing()
        else if (this.onVotes)
            this.onVotes(this.getVoteCounts())
    }

    getVoteCounts() {
        const counts = {}

        for (const songId of this.votes.values())
            counts[songId] = (counts[songId] ?? 0) + 1

        return counts
    }

    getDanceState() {
        if (this.phase === 'voting') {
            return {
                phase: 'voting',
                endsAt: this.phaseEndsAt,
                votes: this.getVoteCounts(),
            }
        }

        if (this.phase === 'preparing') {
            return {
                phase: 'preparing',
                songId: this.currentSong.id,
                endsAt: this.phaseEndsAt,
            }
        }

        return {
            phase: 'playing',
            songId: this.currentSong.id,
            duration: this.currentSong.duration,
            startedAt: this.playbackStartedAt,
        }
    }

    stopTimers() {
        clearTimeout(this.phaseTimer)
    }

    findFreeSeat() {
        const taken = new Set([...this.players.values()].map((player) => player.seatIndex))

        for (let seatIndex = 0; seatIndex < this.maxPlayers; seatIndex++) {
            if (!taken.has(seatIndex))
                return seatIndex
        }

        return -1
    }

    addPlayer(socketId, username) {
        const seatIndex = this.findFreeSeat()

        if (seatIndex === -1)
            return null

        const player = {
            id: socketId,
            username,
            seatIndex,
            chatTimestamps: [],
        }
        this.players.set(socketId, player)

        return player
    }

    removePlayer(socketId) {
        const player = this.players.get(socketId)
        this.players.delete(socketId)
        this.votes.delete(socketId)

        // The leaver might have been the last one still deciding
        if (this.phase === 'voting' && this.players.size > 0 && this.votes.size >= this.players.size)
            this.startPreparing()

        return player ?? null
    }

    isChatRateLimited(player) {
        const now = Date.now()
        player.chatTimestamps = player.chatTimestamps.filter(
            (timestamp) => now - timestamp < CHAT_RATE_LIMIT.windowMs
        )

        if (player.chatTimestamps.length >= CHAT_RATE_LIMIT.maxMessages)
            return true

        player.chatTimestamps.push(now)

        return false
    }

    addChatMessage(player, text) {
        const message = {
            id: player.id,
            username: player.username,
            text,
            timestamp: Date.now(),
        }

        this.chatHistory.push(message)
        if (this.chatHistory.length > CHAT_HISTORY_LIMIT)
            this.chatHistory.shift()

        return message
    }

    serializePlayer(player) {
        return {
            id: player.id,
            username: player.username,
            seatIndex: player.seatIndex,
        }
    }

    snapshot(selfId) {
        return {
            code: this.code,
            isPrivate: this.isPrivate,
            maxPlayers: this.maxPlayers,
            selfId,
            players: [...this.players.values()].map((player) => this.serializePlayer(player)),
            chatHistory: this.chatHistory,
            dance: this.getDanceState(),
        }
    }
}
