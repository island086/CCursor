import { create, toBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { AgentClientMessageSchema } from '../gen/agent_v1_pb'
import { appendMessage, closeSession, getOrCreateSession } from '../handlers/agent/session'
import { resolveBidiAppendPayload } from '../services/core/BidiService'

function heartbeatBytes(): Uint8Array {
  return toBinary(AgentClientMessageSchema, create(AgentClientMessageSchema, {
    message: {
      case: 'clientHeartbeat',
      value: {},
    },
  }))
}

describe('bidiAppend payload compatibility', () => {
  it('reads current Cursor dataBinary bytes', () => {
    const bytes = heartbeatBytes()
    const payload = resolveBidiAppendPayload({
      data: '',
      dataBinary: bytes,
    })

    expect(payload).toEqual({
      hex: Buffer.from(bytes).toString('hex'),
      encoding: 'binary',
    })
  })

  it('reads JSON-encoded dataBinary base64', () => {
    const bytes = heartbeatBytes()
    const payload = resolveBidiAppendPayload({
      data: '',
      dataBinary: Buffer.from(bytes).toString('base64'),
    })

    expect(payload).toEqual({
      hex: Buffer.from(bytes).toString('hex'),
      encoding: 'base64',
    })
  })

  it('falls back to legacy data hex', () => {
    const hex = Buffer.from(heartbeatBytes()).toString('hex')
    const payload = resolveBidiAppendPayload({
      data: hex,
      dataBinary: new Uint8Array(),
    })

    expect(payload).toEqual({ hex, encoding: 'hex' })
  })

  it('prefers dataBinary when both fields are populated', () => {
    const bytes = heartbeatBytes()
    const payload = resolveBidiAppendPayload({
      data: 'deadbeef',
      dataBinary: bytes,
    })

    expect(payload?.encoding).toBe('binary')
    expect(payload?.hex).toBe(Buffer.from(bytes).toString('hex'))
  })

  it('decodes the resolved payload into the session queue', () => {
    const requestId = 'bidi-append-compat'
    const bytes = heartbeatBytes()
    const payload = resolveBidiAppendPayload({ dataBinary: bytes })

    expect(payload).toBeDefined()
    appendMessage(requestId, payload!.hex)

    try {
      const session = getOrCreateSession(requestId)
      expect(session.messages.at(-1)).toHaveProperty('clientHeartbeat')
    }
    finally {
      closeSession(requestId)
    }
  })
})
