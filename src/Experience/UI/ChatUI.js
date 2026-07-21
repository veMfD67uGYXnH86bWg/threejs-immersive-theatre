import Experience from '../Experience.js'
import {CHAT_PATTERN, containsUrl} from '../../../shared/validation.js'

const MAX_MESSAGES_IN_DOM = 100
const INVALID_TEXT_NOTICE = 'Message contains unsupported characters'
const LINK_NOTICE = 'Links aren\'t allowed in chat'

export default class ChatUI {
    constructor() {
        this.experience = new Experience()
        this.network = this.experience.network

        this.messagesList = document.getElementById('chat-messages')
        this.form = document.getElementById('chat-form')
        this.input = document.getElementById('chat-input')

        this.setEvents()
        this.setNetworkEvents()

        console.log('ChatUI loaded')
    }

    setEvents() {
        this.form.addEventListener('submit', (event) => {
            event.preventDefault()

            const text = this.input.value.trim().replace(/\s+/g, ' ')

            if (!text)
                return

            // Clear the box on every submission, valid or not — a rejected
            // message is gone with just the notice to explain why
            this.input.value = ''

            // Same rules the server enforces — fail fast, no round trip
            if (!CHAT_PATTERN.test(text)) {
                this.addSystemMessage(INVALID_TEXT_NOTICE)
                return
            }

            if (containsUrl(text)) {
                this.addSystemMessage(LINK_NOTICE)
                return
            }

            this.network.sendChat(text)
        })

        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape')
                this.input.blur()
        })
    }

    setNetworkEvents() {
        this.network.on('roomJoined', (room) => {
            this.messagesList.innerHTML = ''

            for (const message of room.chatHistory)
                this.addMessage(message)

            this.addSystemMessage(`Joined room ${room.code}`)
        })

        this.network.on('chatMessage', (message) => {
            this.addMessage(message)
        })

        this.network.on('chatBlocked', ({reason} = {}) => {
            if (reason === 'invalid')
                this.addSystemMessage(INVALID_TEXT_NOTICE)
            else if (reason === 'link')
                this.addSystemMessage(LINK_NOTICE)
            else
                this.addSystemMessage('Your message was blocked by moderation')
        })

        this.network.on('playerJoined', (player) => {
            this.addSystemMessage(`${player.username} joined`)
        })

        this.network.on('playerLeft', (player) => {
            this.addSystemMessage(`${player.username} left`)
        })
    }

    addMessage({id, username, text}) {
        const item = document.createElement('li')

        const author = document.createElement('span')
        author.className = 'chat-author'
        if (id === this.network.selfId)
            author.classList.add('self')
        author.textContent = username

        const body = document.createElement('span')
        body.textContent = text

        item.append(author, body)
        this.appendItem(item)
    }

    addSystemMessage(text) {
        const item = document.createElement('li')
        item.className = 'chat-system'
        item.textContent = text
        this.appendItem(item)
    }

    appendItem(item) {
        this.messagesList.appendChild(item)

        while (this.messagesList.children.length > MAX_MESSAGES_IN_DOM)
            this.messagesList.firstChild.remove()

        this.messagesList.scrollTop = this.messagesList.scrollHeight
    }
}
