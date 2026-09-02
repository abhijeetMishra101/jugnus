import type { Octokit } from '@octokit/rest'

export async function readFileFromBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<{ content: string } | { error: string }> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch })
    if ('content' in data && typeof data.content === 'string') {
      return { content: Buffer.from(data.content, 'base64').toString('utf-8') }
    }
    return { error: 'Not a file' }
  } catch {
    return { error: `File not found: ${path} on ${branch}` }
  }
}

export async function listDirectory(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<{ files: string[] } | { error: string }> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch })
    if (!Array.isArray(data)) return { error: 'Not a directory' }
    return { files: data.map((f) => `${f.type === 'dir' ? '📁' : '📄'} ${f.name}`) }
  } catch {
    return { error: `Directory not found: ${path}` }
  }
}

export async function commitFilesToBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  files: Array<{ path: string; content: string }>
): Promise<{ ok: boolean; sha: string } | { error: string }> {
  try {
    // Get or create branch
    let baseSha: string
    try {
      const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` })
      baseSha = ref.object.sha
    } catch {
      const { data: mainRef } = await octokit.rest.git.getRef({ owner, repo, ref: 'heads/main' })
      baseSha = mainRef.object.sha
      await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseSha })
    }

    // Get base tree
    const { data: baseCommit } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: baseSha })
    const baseTreeSha = baseCommit.tree.sha

    // Create blobs for each file
    const treeItems = await Promise.all(
      files.map(async (f) => {
        const { data: blob } = await octokit.rest.git.createBlob({
          owner, repo,
          content: Buffer.from(f.content).toString('base64'),
          encoding: 'base64',
        })
        return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha }
      })
    )

    // Create tree and commit
    const { data: newTree } = await octokit.rest.git.createTree({
      owner, repo, base_tree: baseTreeSha, tree: treeItems,
    })
    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner, repo, message, tree: newTree.sha, parents: [baseSha],
    })
    await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha })

    return { ok: true, sha: newCommit.sha }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function createPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body: string
): Promise<{ url: string; number: number }> {
  const { data } = await octokit.rest.pulls.create({ owner, repo, title, head, base, body })
  return { url: data.html_url, number: data.number }
}

export async function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | null
): Promise<boolean> {
  if (!signature || !process.env.GITHUB_WEBHOOK_SECRET) return false
  const { verify } = await import('@octokit/webhooks-methods')
  return verify(process.env.GITHUB_WEBHOOK_SECRET, rawBody.toString('utf-8'), signature)
}
