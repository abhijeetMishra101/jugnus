import OpenAI from 'openai'
import { createServiceClient } from '../supabase/server'
import { flags } from '../feature-flags'

const MODEL_STANDARD = 'gpt-image-1'   // OpenAI Images 2.5 — better quality, lower cost than DALL-E 3
const MODEL_PREMIUM  = 'gpt-image-1'

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
      size: '1024x1024',
    })

    const imgData = response.data?.[0]
    const b64 = imgData?.b64_json
    if (!b64) throw new Error('No image data in response')

    // Upload to Supabase Storage so the HTML embeds a real URL, not a ~1MB data URI
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`
    const buf = Buffer.from(b64, 'base64')
    const db = createServiceClient()
    const { error: uploadError } = await db.storage
      .from('generated-images')
      .upload(filename, buf, { contentType: 'image/png', upsert: false })

    let url: string
    if (uploadError) {
      // Storage upload failed — fall back to data URL rather than blocking Nia
      url = `data:image/png;base64,${b64}`
    } else {
      const { data: { publicUrl } } = db.storage
        .from('generated-images')
        .getPublicUrl(filename)
      url = publicUrl
    }

    const costUsd = 0.04

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
