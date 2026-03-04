import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'

import authRouter from './routes/auth'
import adminRouter from './routes/admin'
import teachersRouter from './routes/teachers'
import studentsRouter from './routes/students'
import cardsetsRouter from './routes/cardsets'

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app
