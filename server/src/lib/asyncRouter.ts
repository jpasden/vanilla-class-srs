import { Router, RouterOptions, RequestHandler } from 'express'

// Express 4 does not catch rejected promises from async route handlers — an
// unhandled rejection propagates to the process instead of the error-handling
// middleware, and the request just hangs. This wraps each HTTP-verb method so
// every handler's rejection is forwarded to next(err) automatically, without
// touching the ~100 individual async (req, res) => {...} handlers.
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

export function asyncRouter(options?: RouterOptions): Router {
  const router = Router(options)

  for (const method of HTTP_METHODS) {
    const original = router[method].bind(router)
    router[method] = ((path: string, ...handlers: RequestHandler[]) => {
      const wrapped = handlers.map((handler) => {
        if (handler.length >= 4) return handler // error-handling middleware — leave as-is
        return (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]) => {
          Promise.resolve(handler(req, res, next)).catch(next)
        }
      })
      return original(path, ...(wrapped as RequestHandler[]))
    }) as typeof router[typeof method]
  }

  return router
}
