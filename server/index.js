import {createServer} from 'node:http'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import express from 'express'
import {Server} from 'socket.io'

import RoomManager from './RoomManager.js'
import {checkMessage} from './moderation.js'
import emotes from '../shared/emotes.js'
import {
    sanitizeChatText,
    sanitizeEmoteId,
    sanitizeRoomCode,
    sanitizeUsername,
} from './utils/validation.js'

const PORT = process.env.PORT ?? 3001

const app = express()
const httpServer = createServer(app)

// Same-origin in both dev (vite proxies /socket.io, see vite.config.js) and
// prod (this server serves dist/), so no CORS config needed.
// maxHttpBufferSize: largest legit payload is a 240-char chat message, so
// cap incoming messages at 4KB instead of socket.io's 1MB default.
const io = new Server(httpServer, {maxHttpBufferSize: 4096})

const roomManager = new RoomManager({
    onDanceState: (room, state) => io.to(room.code).emit('dance:state', state),
    onVotes: (room, votes) => io.to(room.code).emit('dance:votes', votes),
})

// Serve the built client in production
const distPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist')
if (existsSync(distPath)) {
    app.use(express.static(distPath))
}

// Shared by every join path: sanitize, then run the username through
// moderation so slurs can't be smuggled in as display names
async function validateUsername(rawUsername) {
    const username = sanitizeUsername(rawUsername)

    if (!username)
        return {error: 'Username must be 1-16 letters or numbers'}

    const {flagged} = await checkMessage(username)

    if (flagged)
        return {error: 'Username not allowed'}

    return {username}
}

function joinRoom(socket, room, username) {
    const player = room.addPlayer(socket.id, username)

    if (!player)
        return null

    socket.data.roomCode = room.code
    socket.join(room.code)
    socket.to(room.code).emit('player:joined', {player: room.serializePlayer(player)})

    console.log(`${username} joined room ${room.code} (seat ${player.seatIndex}, ${room.players.size}/${room.maxPlayers})`)

    return room.snapshot(socket.id)
}

function leaveRoom(socket) {
    const code = socket.data.roomCode

    if (!code)
        return

    const room = roomManager.getRoom(code)
    socket.data.roomCode = null
    socket.leave(code)

    if (!room)
        return

    const player = room.removePlayer(socket.id)

    if (player) {
        socket.to(code).emit('player:left', {id: player.id})
        console.log(`${player.username} left room ${code} (${room.players.size}/${room.maxPlayers})`)
    }

    roomManager.removeIfEmpty(code)
}

io.on('connection', (socket) => {
    const ack = (callback) => (typeof callback === 'function' ? callback : () => {
    })

    socket.on('join:quick', async ({username: rawUsername} = {}, callback) => {
        const {username, error} = await validateUsername(rawUsername)

        if (error)
            return ack(callback)({ok: false, error})
        if (socket.data.roomCode)
            return ack(callback)({ok: false, error: 'Already in a room'})

        const room = roomManager.quickJoin()

        if (!room)
            return ack(callback)({ok: false, error: 'Server is full — try again later'})

        const snapshot = joinRoom(socket, room, username)

        ack(callback)(snapshot ? {ok: true, room: snapshot} : {ok: false, error: 'Room is full'})
    })

    socket.on('join:create', async ({username: rawUsername, isPrivate} = {}, callback) => {
        const {username, error} = await validateUsername(rawUsername)

        if (error)
            return ack(callback)({ok: false, error})
        if (socket.data.roomCode)
            return ack(callback)({ok: false, error: 'Already in a room'})

        const room = roomManager.createRoom({isPrivate: isPrivate === true})

        if (!room)
            return ack(callback)({ok: false, error: 'Server is full — try again later'})

        const snapshot = joinRoom(socket, room, username)

        ack(callback)(snapshot ? {ok: true, room: snapshot} : {ok: false, error: 'Room is full'})
    })

    socket.on('join:code', async ({username: rawUsername, code: rawCode} = {}, callback) => {
        const code = sanitizeRoomCode(rawCode)

        if (!code)
            return ack(callback)({ok: false, error: 'Invalid room code'})

        const {username, error} = await validateUsername(rawUsername)

        if (error)
            return ack(callback)({ok: false, error})
        if (socket.data.roomCode)
            return ack(callback)({ok: false, error: 'Already in a room'})

        const room = roomManager.getRoom(code)

        if (!room)
            return ack(callback)({ok: false, error: 'Room not found'})
        if (room.isFull)
            return ack(callback)({ok: false, error: 'Room is full'})

        const snapshot = joinRoom(socket, room, username)

        ack(callback)(snapshot ? {ok: true, room: snapshot} : {ok: false, error: 'Room is full'})
    })

    socket.on('rooms:list', (callback) => {
        ack(callback)({ok: true, rooms: roomManager.listPublicRooms()})
    })

    socket.on('chat:message', async ({text: rawText} = {}) => {
        const room = roomManager.getRoom(socket.data.roomCode)
        const player = room?.players.get(socket.id)

        if (!room || !player)
            return

        const text = sanitizeChatText(rawText)

        if (!text) {
            socket.emit('chat:blocked', {reason: 'invalid'})
            return
        }

        if (room.isChatRateLimited(player))
            return

        const {flagged} = await checkMessage(text)

        if (flagged) {
            socket.emit('chat:blocked', {reason: 'moderation'})
            return
        }

        const message = room.addChatMessage(player, text)
        io.to(room.code).emit('chat:message', message)
    })

    socket.on('emote:play', ({emoteId: rawEmoteId} = {}) => {
        const room = roomManager.getRoom(socket.data.roomCode)
        const player = room?.players.get(socket.id)
        const emoteId = sanitizeEmoteId(rawEmoteId)

        if (!room || !player || !emoteId)
            return

        const emote = emotes.find((candidate) => candidate.id === emoteId)

        if (!emote)
            return

        // Toggle emotes flip state held on the player (so late joiners see
        // it via the snapshot) instead of relaying a one-shot emote
        if (emote.toggle) {
            player.lightstick = !player.lightstick
            io.to(room.code).emit('player:lightstick', {id: player.id, active: player.lightstick})
            return
        }

        if (emote.cooldown) {
            const now = Date.now()
            player.emoteCooldowns ??= {}

            if (now - (player.emoteCooldowns[emoteId] ?? 0) < emote.cooldown)
                return

            player.emoteCooldowns[emoteId] = now
        }

        // `at` lets clients drive clock-synced effects (e.g. the crowd wave)
        // from the same instant regardless of network jitter
        io.to(room.code).emit('emote:play', {id: player.id, emoteId, at: Date.now()})
    })

    socket.on('vote:cast', ({songId} = {}) => {
        const room = roomManager.getRoom(socket.data.roomCode)

        if (!room || typeof songId !== 'string')
            return

        room.castVote(socket.id, songId)
    })

    socket.on('room:leave', () => {
        leaveRoom(socket)
    })

    // NTP-style probe for the client's ServerClock
    socket.on('time:sync', (clientTime, callback) => {
        ack(callback)({clientTime, serverTime: Date.now()})
    })

    socket.on('disconnect', () => {
        leaveRoom(socket)
    })
})

httpServer.listen(PORT, () => {
    console.log(`Immersive Theatre server listening on http://localhost:${PORT}`)
})
