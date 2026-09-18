export const flags = {
  // Shipped — always on
  SINGLE_FRONT_DOOR_UI:    true,
  DYNAMIC_AGENT_ROUTING:   true,
  OPENAI_IMAGE_25:         true,  // actual gate is OPENAI_API_KEY presence checked in image.ts

  // Experimental / cost risk — opt-in via env var
  OPENAI_AGENTS_EXECUTION: process.env.OPENAI_AGENTS_EXECUTION === 'true',
  ASTRA_EXPERT_ESCALATION: process.env.ASTRA_EXPERT_ESCALATION === 'true',
  JEV_DECISION_ENGINE:     process.env.JEV_DECISION_ENGINE     === 'true',
} as const

export type FeatureFlag = keyof typeof flags
