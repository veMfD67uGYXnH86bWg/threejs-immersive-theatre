/**
 * Content moderation via OpenAI's moderation API (free, needs an API key):
 * https://platform.openai.com/docs/guides/moderation
 *
 * Applied to chat messages and usernames (see index.js). Fails OPEN on
 * purpose: if the key is missing, the request times out, or the API errors,
 * content is let through — a moderation outage shouldn't kill the chat.
 *
 * Set OPENAI_API_KEY in .env (see .env.example); without it moderation is
 * disabled entirely.
 */

const API_URL = 'https://api.openai.com/v1/moderations'
const REQUEST_TIMEOUT = 4000
const CACHE_LIMIT = 500

const apiKey = process.env.OPENAI_API_KEY

if (!apiKey)
    console.warn('OPENAI_API_KEY not set — username/chat moderation is disabled')

// Identical texts (rejoining usernames, repeated messages) skip the API —
// fewer calls against the rate limit and instant results
const cache = new Map()

export async function checkMessage(text) {
    if (!apiKey)
        return {flagged: false}

    if (cache.has(text))
        return cache.get(text)

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'omni-moderation-latest',
                input: text,
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        })

        if (!response.ok) {
            // 429 means two different things: 'rate_limit_exceeded' (too many
            // requests/min, transient) vs 'insufficient_quota' (the account
            // has no billing/credits — fix on platform.openai.com)
            const body = await response.json().catch(() => null)
            const code = body?.error?.code ?? body?.error?.type ?? 'unknown'
            const message = body?.error?.message ?? ''
            console.warn(`Moderation API ${response.status} (${code}): ${message} — letting content through`)
            return {flagged: false}
        }

        const data = await response.json()
        const result = {flagged: data.results?.[0]?.flagged === true}

        cache.set(text, result)
        if (cache.size > CACHE_LIMIT)
            cache.delete(cache.keys().next().value)

        return result
    } catch (error) {
        console.warn(`Moderation request failed (${error.message}) — letting content through`)
        return {flagged: false}
    }
}
