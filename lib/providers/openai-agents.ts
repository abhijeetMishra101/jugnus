/**
 * OpenAI Agents API sandbox provider for Leo.
 * Uses the Responses API with a code_interpreter container so Leo can:
 *   - write real files
 *   - install npm dependencies
 *   - run build commands
 *   - execute tests
 *   - return deterministic execution evidence
 *
 * The container lifecycle is managed per-task and cleaned up on completion.
 */
import OpenAI from 'openai'
import type { ExecutionEvidence } from './types'

const MODEL_CODEX = 'gpt-5.3-codex'

export interface AgentsBuildParams {
  taskDescription: string
  designFiles: Record<string, string>   // path → content
  projectId: string
  onProgress: (msg: string) => Promise<void>
}

export interface AgentsBuildResult {
  success: boolean
  outputFiles: Record<string, string>  // path → content
  evidence: ExecutionEvidence
  errorMessage?: string
}

/**
 * Run Leo's build inside an OpenAI Agents sandbox.
 * Returns output files + deterministic execution evidence.
 */
export async function runAgentsSandbox(params: AgentsBuildParams): Promise<AgentsBuildResult> {
  const { taskDescription, designFiles, onProgress } = params
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const startMs = Date.now()

  // Build the input message: task + design files as embedded context
  const designContext = Object.entries(designFiles)
    .map(([path, content]) => `### ${path}\n\`\`\`html\n${content}\n\`\`\``)
    .join('\n\n')

  const systemPrompt = `You are Leo, a builder agent inside a sandboxed execution environment.
You have access to a code_interpreter that can write files, install npm packages, run build commands, and execute tests.

RULES:
- Write a complete Next.js + TypeScript + Tailwind project (not a single HTML file)
- Use \`npm install\` to install dependencies, then \`npm run build\` to verify the build
- Write at minimum: package.json, tsconfig.json, app/page.tsx, app/layout.tsx
- After build succeeds, write a test file and run it with \`npm test\` or \`node test.js\`
- Output a JSON summary at the end: {"filesCreated":[],"buildSucceeded":bool,"testsPassed":bool,"buildOutput":"...","testOutput":"..."}

DESIGN FILES PROVIDED:
${designContext}

TASK:
${taskDescription}`

  await onProgress('🏗️ Leo is building in sandbox...')

  try {
    const response = await client.responses.create({
      model: MODEL_CODEX,
      tools: [{ type: 'code_interpreter', container: { type: 'auto' } }] as unknown as Parameters<typeof client.responses.create>[0]['tools'],
      input: systemPrompt,
      max_output_tokens: 32768,
    } as Parameters<typeof client.responses.create>[0])

    // Extract output text and any files
    const outputText = (response as unknown as { output_text?: string }).output_text ?? ''

    // Parse the JSON summary Leo was instructed to emit
    let summary: {
      filesCreated?: string[]
      buildSucceeded?: boolean
      testsPassed?: boolean
      buildOutput?: string
      testOutput?: string
    } = {}
    const jsonMatch = outputText.match(/\{[\s\S]*"filesCreated"[\s\S]*\}/)
    if (jsonMatch) {
      try { summary = JSON.parse(jsonMatch[0]) } catch { /* best effort */ }
    }

    // Extract files from code_interpreter output
    const outputFiles: Record<string, string> = {}
    const outputItems = (response as unknown as { output?: Array<{ type: string; code?: string; results?: Array<{ type: string; text?: string }> }> }).output ?? []
    for (const item of outputItems) {
      if (item.type === 'code_interpreter_call') {
        for (const result of item.results ?? []) {
          if (result.type === 'text' && result.text) {
            // Parse file writes from Leo's output text
            const fileMatches = [...result.text.matchAll(/###\s+([^\n]+)\n```[a-z]*\n([\s\S]*?)```/g)]
            for (const match of fileMatches) {
              outputFiles[match[1].trim()] = match[2]
            }
          }
        }
      }
    }

    const evidence: ExecutionEvidence = {
      filesCreated: summary.filesCreated ?? Object.keys(outputFiles),
      dependenciesInstalled: outputText.includes('npm install') && !outputText.includes('npm ERR!'),
      buildSucceeded: summary.buildSucceeded ?? outputText.includes('Build succeeded') ?? false,
      buildOutput: summary.buildOutput ?? '',
      serverStarted: false, // container-based, not a persistent server
      httpResponseOk: false,
      browserRenderOk: false,
      testsPassed: summary.testsPassed ?? null,
      testOutput: summary.testOutput ?? '',
      containerDurationMs: Date.now() - startMs,
    }

    await onProgress(`✅ Build ${evidence.buildSucceeded ? 'succeeded' : 'failed'} in ${Math.round(evidence.containerDurationMs / 1000)}s`)

    return { success: evidence.buildSucceeded, outputFiles, evidence }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await onProgress(`❌ Sandbox error: ${errorMessage}`)
    return {
      success: false,
      outputFiles: {},
      evidence: {
        filesCreated: [],
        dependenciesInstalled: false,
        buildSucceeded: false,
        buildOutput: errorMessage,
        serverStarted: false,
        httpResponseOk: false,
        browserRenderOk: false,
        testsPassed: null,
        testOutput: '',
        containerDurationMs: Date.now() - startMs,
      },
      errorMessage,
    }
  }
}
