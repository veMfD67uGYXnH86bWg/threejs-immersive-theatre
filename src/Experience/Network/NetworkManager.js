import {io} from 'socket.io-client'

import EventEmitter from '../utils/EventEmitter.js'
import ServerClock from './ServerClock.js'

/**
 * Wraps the socket.io connection and re-emits server events through the
 * project's EventEmitter so the rest of the Experience never touches the
 * socket directly.
 *
 * Emitted events: roomJoined, roomLeft, playerJoined, playerLeft,
 * chatMessage, emotePlayed, danceStateChanged, danceVotesChanged,
 * disconnected
 */
export default class NetworkManager extends EventEmitter {
    constructor() {
        super()

        this.room = null
        this.selfId = null
        this.players = new Map()
        this.dance = null

        // Same origin: vite proxies /socket.io to the server in dev
        // (see vite.config.js), and the server serves dist/ in production
        this.socket = io()
        this.serverClock = new ServerClock(this.socket)

        this.setSocketEvents()

        console.log('NetworkManager loaded')
    }

    setSocketEvents() {
        this.socket.on('player:joined', ({player}) => {
            if (!this.room)
                return

            this.players.set(player.id, player)
            this.trigger('playerJoined', [player])
        })

        this.socket.on('player:left', ({id}) => {
            const player = this.players.get(id)

            if (!player)
                return

            this.players.delete(id)
            this.trigger('playerLeft', [player])
        })

        this.socket.on('chat:message', (message) => {
            this.trigger('chatMessage', [message])
        })

        this.socket.on('chat:blocked', (payload) => {
            this.trigger('chatBlocked', [payload ?? {}])
        })

        this.socket.on('emote:play', ({id, emoteId, at}) => {
            this.trigger('emotePlayed', [{id, emoteId, at}])
        })

        this.socket.on('dance:state', (dance) => {
            this.dance = dance
            this.trigger('danceStateChanged', [dance])
        })

        this.socket.on('dance:votes', (votes) => {
            if (this.dance?.phase === 'voting') {
                this.dance.votes = votes
                this.trigger('danceVotesChanged', [votes])
            }
        })

        this.socket.on('disconnect', () => {
            if (this.room) {
                this.clearRoomState()
                this.trigger('roomLeft', ['disconnected'])
            }

            this.trigger('disconnected')
        })
    }

    handleJoinResult(result, callback) {
        if (result?.ok) {
            this.room = result.room
            this.selfId = result.room.selfId
            this.players = new Map(result.room.players.map((player) => [player.id, player]))
            this.dance = result.room.dance ?? null
            this.trigger('roomJoined', [this.room])
        }

        if (callback)
            callback(result)
    }

    quickJoin(username, callback) {
        this.socket.emit('join:quick', {username}, (result) => this.handleJoinResult(result, callback))
    }

    createRoom(username, isPrivate, callback) {
        this.socket.emit('join:create', {username, isPrivate}, (result) => this.handleJoinResult(result, callback))
    }

    joinByCode(username, code, callback) {
        this.socket.emit('join:code', {username, code}, (result) => this.handleJoinResult(result, callback))
    }

    listRooms(callback) {
        this.socket.emit('rooms:list', (result) => callback(result))
    }

    sendChat(text) {
        this.socket.emit('chat:message', {text})
    }

    sendEmote(emoteId) {
        this.socket.emit('emote:play', {emoteId})
    }

    castVote(songId) {
        this.socket.emit('vote:cast', {songId})
    }

    clearRoomState() {
        this.room = null
        this.selfId = null
        this.players.clear()
        this.dance = null
    }

    leaveRoom() {
        if (!this.room)
            return

        this.socket.emit('room:leave')
        this.clearRoomState()
        this.trigger('roomLeft', ['left'])
    }
}
