import { logger } from '../../infrastructure/logger.js'

import type { AppEnvironment } from '../http/context.js'
import type { MiddlewareHandler } from 'hono'

export const requestLogger: MiddlewareHandler<AppEnvironment> = async (c, next) => {
    const start = performance.now()
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID()

    c.set('requestId', requestId)
    c.header('x-request-id', requestId)

    await next()

    logger.info({
        requestId,
        method: c.req.method,
        path: c.req.path,
        statusCode: c.res.status,
        durationMs: Math.round(performance.now() - start),
    })
}