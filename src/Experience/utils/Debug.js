import {Pane} from 'tweakpane'

export default class Debug {
    constructor() {
        this.active = window.location.hash === '#debug'

        if (this.active) {
            this.container = document.createElement('div')
            this.container.classList.add('debug-ui')
            document.body.appendChild(this.container)

            this.ui = new Pane({container: this.container})
        }
    }
}