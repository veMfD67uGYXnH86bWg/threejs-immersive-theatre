// Deterministic vivid color from any string (used to tint player characters)
export default function stringToColor(string) {
    let hash = 0

    for (let i = 0; i < string.length; i++) {
        hash = string.charCodeAt(i) + ((hash << 5) - hash)
        hash |= 0
    }

    const hue = Math.abs(hash) % 360

    return `hsl(${hue}, 70%, 60%)`
}
