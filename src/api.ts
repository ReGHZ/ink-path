import { serve } from '@hono/node-server'

import { createApp } from './app.js'

const DEFAULT_PORT = 4004

function readPort() {
    const rawPort = process.env.PORT

    if (rawPort === undefined) {
        return DEFAULT_PORT
    }

    const port = Number.parseInt(rawPort, 10)

    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        throw new Error(`Invalid PORT value: ${rawPort}`)
    }

    return port
}

const app = createApp()
const port = readPort()

const server = serve(
    {
        fetch: app.fetch,
        port,
    },
    (info) => {
        console.info(`API server listening on http://localhost:${info.port}`)
    },
)

function shutdown(signal: NodeJS.Signals) {
    console.info(`Received ${signal}. Shutting down API server.`)

    server.close((error?: Error | null) => {
        if (error) {
            console.error('Failed to close API server gracefully.', error)
            process.exit(1)
        }

        process.exit(0)
    })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)