import Experience from '../Experience.js'
import {USERNAME_PATTERN} from '../../../shared/validation.js'
import songs from '../../../shared/songs.js'

const USERNAME_STORAGE_KEY = 'immersive-theatre-username'
const DISCLAIMER_STORAGE_KEY = 'immersive-theatre-photosensitivity-ok'

export default class LobbyUI {
    constructor() {
        this.experience = new Experience()
        this.network = this.experience.network

        this.element = document.getElementById('lobby')
        this.usernameInput = document.getElementById('lobby-username')
        this.quickButton = document.getElementById('lobby-quick')
        this.createButton = document.getElementById('lobby-create')
        this.privateCheckbox = document.getElementById('lobby-private')
        this.codeInput = document.getElementById('lobby-code')
        this.joinCodeButton = document.getElementById('lobby-join-code')
        this.refreshButton = document.getElementById('lobby-refresh')
        this.roomsList = document.getElementById('lobby-rooms')
        this.errorElement = document.getElementById('lobby-error')
        this.homeElement = document.getElementById('lobby-home')
        this.inviteElement = document.getElementById('lobby-invite')
        this.inviteTextElement = document.getElementById('lobby-invite-text')
        this.inviteJoinButton = document.getElementById('lobby-invite-join')
        this.inviteBackButton = document.getElementById('lobby-invite-back')
        this.disclaimerElement = document.getElementById('lobby-disclaimer')
        this.disclaimerAcceptButton = document.getElementById('disclaimer-accept')
        this.disclaimerRememberCheckbox = document.getElementById('disclaimer-remember')

        this.usernameInput.value = localStorage.getItem(USERNAME_STORAGE_KEY) ?? ''
        this.inviteCode = this.parseInviteCode()

        this.disclaimerAccepted = localStorage.getItem(DISCLAIMER_STORAGE_KEY) === '1'
        if (this.disclaimerAccepted)
            this.disclaimerElement.classList.add('hidden')

        this.setEvents()

        if (this.inviteCode)
            this.showInvite()
        else
            this.refreshRooms()

        console.log('LobbyUI loaded')
    }

    // Invite links look like /?room-code=AB3CD (see UI.js room pill copy)
    parseInviteCode() {
        const raw = new URLSearchParams(window.location.search).get('room-code') ?? ''
        const code = raw.trim().toUpperCase()

        return /^[A-Z0-9]{4,8}$/.test(code) ? code : null
    }

    showInvite() {
        this.inviteTextElement.textContent = `You've been invited to room ${this.inviteCode}`
        this.inviteJoinButton.textContent = `Join room ${this.inviteCode}`
        this.homeElement.classList.add('hidden')
        this.inviteElement.classList.remove('hidden')
    }

    exitInviteMode() {
        if (!this.inviteCode)
            return

        this.inviteCode = null

        // Drop ?room-code=... so refreshing or disconnecting later lands on
        // the normal lobby instead of the invite again
        window.history.replaceState(null, '', window.location.pathname)

        this.inviteElement.classList.add('hidden')
        this.homeElement.classList.remove('hidden')
    }

    setEvents() {
        this.quickButton.addEventListener('click', () => {
            const username = this.getUsername()

            if (username)
                this.network.quickJoin(username, (result) => this.handleJoinResult(result))
        })

        this.createButton.addEventListener('click', () => {
            const username = this.getUsername()

            if (username)
                this.network.createRoom(username, this.privateCheckbox.checked, (result) => this.handleJoinResult(result))
        })

        this.joinCodeButton.addEventListener('click', () => this.joinByCode())
        this.codeInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter')
                this.joinByCode()
        })

        this.refreshButton.addEventListener('click', () => this.refreshRooms())

        this.inviteJoinButton.addEventListener('click', () => {
            const username = this.getUsername()

            if (username)
                this.network.joinByCode(username, this.inviteCode, (result) => this.handleJoinResult(result))
        })

        this.inviteBackButton.addEventListener('click', () => {
            this.showError('')
            this.exitInviteMode()
            this.refreshRooms()
        })

        this.disclaimerAcceptButton.addEventListener('click', () => {
            this.disclaimerAccepted = true

            if (this.disclaimerRememberCheckbox.checked)
                localStorage.setItem(DISCLAIMER_STORAGE_KEY, '1')

            this.disclaimerElement.classList.add('hidden')
            this.showError('')
        })
    }

    // Gates every join path (quick, create, code, room list, invite link):
    // no username or no accepted photosensitivity warning = no joining
    getUsername() {
        const username = this.usernameInput.value.trim()

        if (!username) {
            this.showError('Pick a username first')
            this.usernameInput.focus()
            return null
        }

        // Same rule the server enforces — fail fast, no round trip
        if (!USERNAME_PATTERN.test(username)) {
            this.showError('Username must be 1-16 letters or numbers')
            this.usernameInput.focus()
            return null
        }

        if (!this.disclaimerAccepted) {
            this.showError('Please accept the photosensitivity warning below')
            this.flashDisclaimer()
            return null
        }

        localStorage.setItem(USERNAME_STORAGE_KEY, username)

        return username
    }

    flashDisclaimer() {
        this.disclaimerElement.classList.add('highlight')
        clearTimeout(this.disclaimerFlashTimer)
        this.disclaimerFlashTimer = setTimeout(() => {
            this.disclaimerElement.classList.remove('highlight')
        }, 1600)
    }

    joinByCode(code = this.codeInput.value) {
        const username = this.getUsername()

        if (username)
            this.network.joinByCode(username, code, (result) => this.handleJoinResult(result))
    }

    handleJoinResult(result) {
        if (!result?.ok) {
            this.showError(result?.error ?? 'Something went wrong')
            this.refreshRooms()
        }
    }

    refreshRooms() {
        this.network.listRooms(({rooms}) => {
            this.roomsList.innerHTML = ''

            if (rooms.length === 0) {
                const empty = document.createElement('li')
                empty.className = 'lobby-rooms-empty'
                empty.textContent = 'No public rooms yet — create one!'
                this.roomsList.appendChild(empty)
                return
            }

            for (const room of rooms) {
                const item = document.createElement('li')
                const song = songs.find((candidate) => candidate.id === room.songId)
                console.log(`song is ${song}, room songId is ${room.songId}, room is ${room}`)
                console.log(room)
                const nowPlaying = song
                    ? `♪ ${song.name} — ${song.artist}`
                    : '🗳 Voting for the next song…'
                item.innerHTML =
                    `<div class="lobby-room-row"><span>${room.code}</span><span>${room.playerCount}/${room.maxPlayers}</span></div>` +
                    `<div class="lobby-room-song">${nowPlaying}</div>`

                if (room.playerCount < room.maxPlayers)
                    item.addEventListener('click', () => this.joinByCode(room.code))
                else
                    item.classList.add('full')

                this.roomsList.appendChild(item)
            }
        })
    }

    showError(message) {
        this.errorElement.textContent = message
    }

    show(message = '') {
        this.showError(message)
        this.refreshRooms()
        this.element.classList.remove('hidden')
    }

    hide() {
        this.showError('')
        this.exitInviteMode()
        this.element.classList.add('hidden')
    }
}
