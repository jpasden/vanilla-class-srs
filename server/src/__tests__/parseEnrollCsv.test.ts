import { describe, it, expect } from 'vitest'
import { parseEnrollCsv } from '../services/enrollment.service'

describe('parseEnrollCsv', () => {
  it('parses a file with a proper name,email header', () => {
    const buf = Buffer.from('name,email\nDoug Test,dt@qbd.org\nAnne Test,at@qbd.org\n')
    const result = parseEnrollCsv(buf, false)
    expect(result.status).toBe('parsed')
    if (result.status === 'parsed') {
      expect(result.rows).toEqual([
        { name: 'Doug Test', email: 'dt@qbd.org' },
        { name: 'Anne Test', email: 'at@qbd.org' },
      ])
    }
  })

  it('asks for confirmation on a headerless file, without parsing rows yet', () => {
    const buf = Buffer.from('Doug Test,dt@qbd.org\nAnne Test,at@qbd.org\n')
    const result = parseEnrollCsv(buf, false)
    expect(result.status).toBe('needs_confirmation')
    if (result.status === 'needs_confirmation') {
      expect(result.detectedFormat).toEqual({ name: 'Doug Test', email: 'dt@qbd.org' })
    }
  })

  it('parses a headerless file as (name, email) once confirmed', () => {
    const buf = Buffer.from('Doug Test,dt@qbd.org\nAnne Test,at@qbd.org\n')
    const result = parseEnrollCsv(buf, true)
    expect(result.status).toBe('parsed')
    if (result.status === 'parsed') {
      expect(result.rows).toEqual([
        { name: 'Doug Test', email: 'dt@qbd.org' },
        { name: 'Anne Test', email: 'at@qbd.org' },
      ])
    }
  })

  it('does not ask for confirmation when a recognized header is present, even though row 2 looks like an email pair', () => {
    const buf = Buffer.from('name,email\nDoug Test,dt@qbd.org\n')
    const result = parseEnrollCsv(buf, false)
    expect(result.status).toBe('parsed')
  })

  it('treats a file whose first row is not header-shaped and not email-shaped as a (probably malformed) header, letting downstream validation catch it', () => {
    // e.g. someone uploads a completely different two-column file
    const buf = Buffer.from('foo,bar\nsomething,else\n')
    const result = parseEnrollCsv(buf, false)
    expect(result.status).toBe('parsed')
    if (result.status === 'parsed') {
      expect(result.rows).toEqual([{ foo: 'something', bar: 'else' }])
    }
  })

  it('strips a UTF-8 BOM before detecting the header', () => {
    const buf = Buffer.from('﻿name,email\nDoug Test,dt@qbd.org\n')
    const result = parseEnrollCsv(buf, false)
    expect(result.status).toBe('parsed')
    if (result.status === 'parsed') {
      expect(result.rows).toEqual([{ name: 'Doug Test', email: 'dt@qbd.org' }])
    }
  })

  it('returns parse_error for garbage input', () => {
    const buf = Buffer.from('"unterminated quote,x\n')
    const result = parseEnrollCsv(buf, false)
    expect(result.status).toBe('parse_error')
  })

  it('handles an empty file', () => {
    const buf = Buffer.from('')
    const result = parseEnrollCsv(buf, false)
    expect(result.status).toBe('parsed')
    if (result.status === 'parsed') {
      expect(result.rows).toEqual([])
    }
  })
})
