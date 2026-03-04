import { Request, Response, NextFunction } from 'express'
import { ZodSchema } from 'zod'

/**
 * validate — middleware factory that parses req.body against a Zod schema.
 * Attaches the parsed data to req.body on success; returns 400 on failure.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: 'Invalid request', details: result.error.flatten() })
      return
    }
    req.body = result.data
    next()
  }
}
