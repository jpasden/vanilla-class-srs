import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import type { requirePasswordChanged as RequirePasswordChanged } from '../middleware/auth'

const findUnique = vi.fn()
vi.mock('../lib/prisma', () => ({
  default: { user: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}))

// Imported after the mock so the module under test picks up the mocked prisma client.
let requirePasswordChanged: typeof RequirePasswordChanged
beforeAll(async () => {
  ;({ requirePasswordChanged } = await import('../middleware/auth'))
})

function makeRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {}
  res.status = vi.fn().mockImplementation((code: number) => { res.statusCode = code; return res as Response })
  res.json = vi.fn().mockImplementation((body: unknown) => { res.body = body; return res as Response })
  return res as Response & { statusCode?: number; body?: unknown }
}

beforeEach(() => {
  findUnique.mockReset()
})

describe('requirePasswordChanged', () => {
  it('blocks the request with 403 while mustChangePassword is true', async () => {
    findUnique.mockResolvedValue({ mustChangePassword: true })
    const req = { user: { sub: 'user-1', role: 'STUDENT' } } as Request
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await requirePasswordChanged(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.body).toMatchObject({ mustChangePassword: true })
  })

  it('calls next() once mustChangePassword is false', async () => {
    findUnique.mockResolvedValue({ mustChangePassword: false })
    const req = { user: { sub: 'user-1', role: 'STUDENT' } } as Request
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await requirePasswordChanged(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('looks up the flag from the database rather than trusting the JWT payload', async () => {
    // The JWT only carries { sub, role } — this guard exists specifically
    // because that flag isn't in the token, so a reset takes effect
    // immediately rather than after the access token expires.
    findUnique.mockResolvedValue({ mustChangePassword: false })
    const req = { user: { sub: 'user-42', role: 'TEACHER' } } as Request
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await requirePasswordChanged(req, res, next)

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-42' },
      select: { mustChangePassword: true },
    })
  })

  it('returns 401 if the user no longer exists', async () => {
    findUnique.mockResolvedValue(null)
    const req = { user: { sub: 'deleted-user', role: 'STUDENT' } } as Request
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await requirePasswordChanged(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
  })
})
