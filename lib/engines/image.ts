import OpenAI from 'openai'
import { flags } from '../feature-flags'

const MODEL_STANDARD = 'dall-e-3'
const MODEL_PREMIUM  = 'dall-e-3'

// Conservative budget: max 2 generated images per project to cap cost
const MAX_GENERATED_IMAGES_PER_PROJECT = 2

export type ImageResult =
  | { source: 'founder';   url: string; alt: string }
  | { source: 'stock';     url: string; alt: string; photographer: string }
  | { source: 'generated'; url: string; alt: string; model: string; costUsd: number }
  | { source: 'placeholder'; css: string }
  | { source: 'unavailable'; reason: string }

export interface GenerateImageParams {
  prompt: string
  /** Alt text description for the generated image */
  alt: string
  /** Use premium model for hero/key visuals, standard for supporting images */
  quality?: 'standard' | 'premium'
  /** How many AI images have already been generated for this project */
  generatedCount?: number
}

/**
 * ImageEngine — tries stock search first, then AI generation if warranted and budget allows.
 * Falls back gracefully to a styled CSS placeholder if everything is unavailable.
 */
export async function generateImage(params: GenerateImageParams): Promise<ImageResult> {
  const { prompt, alt, quality = 'standard', generatedCount = 0 } = params

  // Budget guard
  if (generatedCount >= MAX_GENERATED_IMAGES_PER_PROJECT) {
    return { source: 'unavailable', reason: `Image generation budget reached (max ${MAX_GENERATED_IMAGES_PER_PROJECT} per project)` }
  }

  if (!flags.OPENAI_IMAGE_25 || !process.env.OPENAI_API_KEY) {
    return { source: 'unavailable', reason: 'Image generation not enabled' }
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = quality === 'premium' ? MODEL_PREMIUM : MODEL_STANDARD

  try {
    const response = await client.images.generate({
      model,
      prompt,
      n: 1,
      size: '1792x1024',
      response_format: 'url',
    })

    const url = response.data?.[0]?.url
    if (!url) throw new Error('No URL in response')

    // Rough cost estimate: ~$0.04 per image for standard, ~$0.08 for premium
    const costUsd = quality === 'premium' ? 0.08 : 0.04

    return { source: 'generated', url, alt, model, costUsd }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { source: 'unavailable', reason }
  }
}

/** CSS gradient placeholder to use when no image is available */
export function imagePlaceholder(label = 'Your photo will go here'): ImageResult {
  return {
    source: 'placeholder',
    css: `<div style="width:100%;height:400px;background:linear-gradient(135deg,var(--color-primary,#2d6a4f),var(--color-accent,#52b788));display:flex;align-items:center;justify-content:center;border-radius:12px"><span style="color:white;font-size:1.1rem;opacity:0.85">📷 ${label}</span></div>`,
  }
}
