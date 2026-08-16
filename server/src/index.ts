import 'dotenv/config'
import express, { Request, Response, NextFunction } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'

import authRouter from './routes/auth'
import adminRouter from './routes/admin'
import teachersRouter from './routes/teachers'
import studentsRouter from './routes/students'
import cardsetsRouter from './routes/cardsets'

// Express 4 does not catch rejections from async handlers, and an unhandled
// rejection crashes the Node process by default — Docker restarts it, but
// every in-flight request (including a student mid-session) dies with it.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})

const app = express()
const PORT = process.env.PORT ?? 3000

app.use(cors({
  origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())

// Routes
app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/api/teachers', teachersRouter)
app.use('/api/teachers/cardsets', cardsetsRouter)
app.use('/api/students', studentsRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Catches rejected promises from async route handlers (Express 4 doesn't) and
// any synchronous throw that reaches here without a response already sent.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app
