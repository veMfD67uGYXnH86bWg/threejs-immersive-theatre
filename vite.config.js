import {defineConfig} from 'vite'

// The socket.io server (server/index.js) runs on its own port.
// Proxying it here lets the client connect to the same origin in dev,
// exactly like in production where server/index.js serves the built client.
export default defineConfig({
    publicDir: './public/',
    server: {
        proxy: {
            '/socket.io': {
                target: 'http://localhost:3001',
                ws: true,
            },
        },
        host: true,
        open: '/'
    },
    build: {
        outDir: './dist',
        emptyOutDir: true,
        // Source maps would let anyone reconstruct the original source in
        // devtools — keep them off for deploys (flip on locally to debug a
        // production build)
        sourcemap: false
    },
})
