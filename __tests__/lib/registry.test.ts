import { describe, it, expect } from 'vitest'
import { JUGNU_REGISTRY, getJugnu, jugnuForCapability } from '@/lib/jugnus/registry'

describe('JUGNU_REGISTRY', () => {
  it('has all four jugnus', () => {
    expect(Object.keys(JUGNU_REGISTRY)).toEqual(expect.arrayContaining(['maya', 'leo', 'nia', 'tara']))
  })

  it('each jugnu has a non-empty system prompt', () => {
    for (const j of Object.values(JUGNU_REGISTRY)) {
      expect(j.systemPrompt.length).toBeGreaterThan(50)
    }
  })

  it('each jugnu has at least one capability', () => {
    for (const j of Object.values(JUGNU_REGISTRY)) {
      expect(j.capabilities.length).toBeGreaterThan(0)
    }
  })
})

describe('getJugnu', () => {
  it('returns Maya', () => {
    expect(getJugnu('maya').name).toBe('Maya')
  })

  it('returns Leo', () => {
    expect(getJugnu('leo').role).toBe('Builder')
  })
})

describe('jugnuForCapability', () => {
  it('returns nia for design', () => {
    expect(jugnuForCapability('design')).toBe('nia')
  })

  it('returns leo for coding', () => {
    expect(jugnuForCapability('coding')).toBe('leo')
  })

  it('returns tara for review', () => {
    expect(jugnuForCapability('review')).toBe('tara')
  })

  it('defaults to leo for unknown capability', () => {
    expect(jugnuForCapability('something_unknown')).toBe('leo')
  })
})
