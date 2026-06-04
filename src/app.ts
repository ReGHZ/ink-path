import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'

import type { AppEnvironment } from './shared/http/context.js'

export function createApp() {
    const app = new Hono<AppEnvironment>({
        strict: true,
    })

    app.use('*', secureHeaders())
    app.use('*', logger()) //TODO : use pino later

    app.use('*', async (c, next) => {
        const requestId = crypto.randomUUID()

        c.set('requestId', requestId)
        c.header('x-request-id', requestId)

        await next()
    })

    app.get('/health', (c) => {
        return c.json({
            status: 'ok',
            service: 'ink-path-api',
            requestId: c.get('requestId'),
        })
    })

    return app
}

export type App = ReturnType<typeof createApp>