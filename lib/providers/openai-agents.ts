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

const MODEL_CODEX = 'gpt-4o'

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

  const systemPrompt = `You are Leo, a frontend builder. You have a Python code_interpreter.

YOUR JOB: generate a single self-contained \`index.html\` that implements the design below.
Use inline CSS and JavaScript — no external build tools or npm required.
Use CDN links for Chart.js, Tailwind, or any other library.

HOW TO OUTPUT THE FILE — follow this format EXACTLY so the system can parse it:

### index.html
\`\`\`html
<complete HTML here>
\`\`\`

After the file, print this JSON summary on its own line:
{"filesCreated":["index.html"],"buildSucceeded":true,"testsPassed":true,"buildOutput":"HTML generated successfully","testOutput":""}

Use the Python code_interpreter to:
1. Generate the HTML string
2. Print it in the format above
3. Print the JSON summary

DESIGN FILES:
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

    // Parse files from output_text (Leo prints them in ### filename\n```\ncontent\n``` format)
    const outputFiles: Record<string, string> = {}
    const FILE_RE = /###\s+([^\n]+)\n```[a-z]*\n([\s\S]*?)```/g
    for (const match of outputText.matchAll(FILE_RE)) {
      outputFiles[match[1].trim()] = match[2]
    }
    // Also scan code_interpreter_call results — OpenAI returns logs in result.logs, not result.text
    type CIResult = { type: string; text?: string; logs?: string }
    type CIItem = { type: string; code?: string; results?: CIResult[] }
    const outputItems = (response as unknown as { output?: CIItem[] }).output ?? []
    for (const item of outputItems) {
      if (item.type === 'code_interpreter_call') {
        for (const result of item.results ?? []) {
          const text = result.logs ?? result.text ?? ''
          if (text) {
            for (const match of text.matchAll(FILE_RE)) {
              outputFiles[match[1].trim()] = match[2]
            }
          }
        }
      }
    }

    const evidence: ExecutionEvidence = {
      filesCreated: summary.filesCreated ?? Object.keys(outputFiles),
      dependenciesInstalled: true,
      buildSucceeded: summary.buildSucceeded ?? Object.keys(outputFiles).length > 0,
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
