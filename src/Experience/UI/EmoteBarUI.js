import Experience from '../Experience.js'
import emotes from '../../../shared/emotes.js'

export default class EmoteBarUI {
    constructor() {
        this.experience = new Experience()
        this.network = this.experience.network
        this.audio = this.experience.audio

        this.element = document.getElementById('emote-bar')
        this.buttons = new Map()
        this.cooldownUntil = new Map()

        this.setButtons()
        this.setMuteToggle()
        this.setHotkeys()
        this.setNetworkEvents()

        console.log('EmoteBarUI loaded')
    }

    setNetworkEvents() {
        this.network.on('roomLeft', () => {
            for (const button of this.buttons.values())
                button.classList.remove('active')
        })
    }

    setButtons() {
        for (const emote of emotes) {
            const button = document.createElement('button')
            button.type = 'button'
            button.title = `${emote.name} (${emote.key})`
            button.innerHTML = `<span class="emote-icon">${emote.icon}</span><span class="emote-key">${emote.key}</span>`
            button.addEventListener('click', () => this.trigger(emote))

            this.element.appendChild(button)
            this.buttons.set(emote.id, button)
        }
    }

    setMuteToggle() {
        this.muteButton = document.createElement('button')
        this.muteButton.type = 'button'
        this.muteButton.className = 'emote-mute'
        this.muteButton.addEventListener('click', () => {
            this.audio.setMuted(!this.audio.muted)
            this.updateMuteButton()
        })

        this.updateMuteButton()
        this.element.appendChild(this.muteButton)
    }

    updateMuteButton() {
        this.muteButton.textContent = this.audio.muted ? '🔕' : '🔔'
        this.muteButton.title = this.audio.muted
            ? 'Emote sounds are off — click to enable'
            : 'Emote sounds are on — click to mute'
    }

    setHotkeys() {
        window.addEventListener('keydown', (event) => {
            // Don't trigger emotes while typing in the chat or lobby inputs
            const tagName = document.activeElement?.tagName

            if (tagName === 'INPUT' || tagName === 'TEXTAREA')
                return
            if (!this.network.room)
                return

            const emote = emotes.find((candidate) => candidate.key === event.key)

            if (emote)
                this.trigger(emote)
        })
    }

    trigger(emote) {
        if ((this.cooldownUntil.get(emote.id) ?? 0) > Date.now())
            return

        this.network.sendEmote(emote.id)

        // Mirror of the server-side cooldown, purely for button feedback
        if (emote.cooldown)
            this.startCooldown(emote)
    }

    startCooldown(emote) {
        const button = this.buttons.get(emote.id)
        const keyElement = button.querySelector('.emote-key')

        this.cooldownUntil.set(emote.id, Date.now() + emote.cooldown)
        button.disabled = true

        const tick = setInterval(() => {
            const remaining = this.cooldownUntil.get(emote.id) - Date.now()

            if (remaining <= 0) {
                clearInterval(tick)
                button.disabled = false
                keyElement.textContent = emote.key
            } else {
                keyElement.textContent = Math.ceil(remaining / 1000)
            }
        }, 250)
    }
}
