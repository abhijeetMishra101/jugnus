/**
 * Feature flags — all default false.
 * The existing Claude path runs when every flag is off.
 * Each phase flips exactly one flag. Rollback = set flag to 'false' in Vercel env vars.
 */
export const flags = {
  SINGLE_FRONT_DOOR_UI:    process.env.NEXTGEN_SINGLE_FRONT_DOOR_UI    === 'true',
  DYNAMIC_AGENT_ROUTING:   process.env.DYNAMIC_AGENT_ROUTING            === 'true',
  JEV_DECISION_ENGINE:     process.env.JEV_DECISION_ENGINE              === 'true',
  OPENAI_IMAGE_25:         process.env.OPENAI_IMAGE_25                  === 'true',
  OPENAI_AGENTS_EXECUTION: process.env.OPENAI_AGENTS_EXECUTION          === 'true',
  ASTRA_EXPERT_ESCALATION: process.env.ASTRA_EXPERT_ESCALATION          === 'true',
} as const

export type FeatureFlag = keyof typeof flags
