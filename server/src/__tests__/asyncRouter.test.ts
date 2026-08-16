import { describe, it, expect, afterEach } from 'vitest'
import express, { Request, Response, NextFunction } from 'express'
import type { Server } from 'http'
import { asyncRouter } from '../lib/asyncRouter'

function makeApp() {
  const router = asyncRouter()
  router.get('/rejects', async () => {
    throw new Error('boom')
  })
  router.get('/ok', async (_req: Request, res: Response) => {
    res.json({ ok: true })
  })

  const app = express()
  app.use(router)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'Internal server error' })
  })
  return app
}

let server: Server | undefined

afterEach(() => {
  server?.close()
  server = undefined
})

function listen(app: express.Express): Promise<number> {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const address = server!.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

describe('asyncRouter', () => {
  it('forwards a rejected async handler to the error-handling middleware instead of hanging', async () => {
    const port = await listen(makeApp())
    const res = await fetch(`http://localhost:${port}/rejects`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
  })

  it('leaves a normally-resolving async handler unaffected', async () => {
    const port = await listen(makeApp())
    const res = await fetch(`http://localhost:${port}/ok`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
