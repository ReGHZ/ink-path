import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'

import { requestLogger } from './shared/middleware/RequestMiddleware.js'

import type { AppEnvironment } from './shared/http/context.js'


export function createApp() {
    const app = new Hono<AppEnvironment>({
        strict: true,
    })

    app.use('*', secureHeaders())
    app.use('*', requestLogger)

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