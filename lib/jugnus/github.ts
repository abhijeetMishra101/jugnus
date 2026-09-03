import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

interface FileSnapshot {
  path: string
  content: string
}

async function getInstallationOctokit(owner: string): Promise<Octokit> {
  const appId = parseInt(process.env.GITHUB_APP_ID ?? '0')
  const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')

  if (!appId || !privateKey) throw new Error('GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not set')

  // App-level client to find the installation for this owner
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  })

  const { data: installations } = await appOctokit.apps.listInstallations()
  const installation = installations.find((i) => i.account?.login === owner)
  if (!installation) {
    throw new Error(
      `GitHub App 'jugnus-abhijeet' is not installed for '${owner}'. ` +
      `Install it at github.com/settings/apps/jugnus-abhijeet.`
    )
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId: installation.id },
  })
}

async function pushBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  files: FileSnapshot[],
  commitMessage: string,
): Promise<void> {
  // Get default branch and its latest commit
  const { data: repoData } = await octokit.repos.get({ owner, repo })
  const defaultBranch = repoData.default_branch

  const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` })
  const baseSha = refData.object.sha

  const { data: baseCommit } = await octokit.git.getCommit({ owner, repo, commit_sha: baseSha })

  // Create blobs for all files (parallel)
  const treeItems = await Promise.all(
    files.map(async (f) => {
      const { data: blob } = await octokit.git.createBlob({
        owner, repo, content: f.content, encoding: 'utf-8',
      })
      return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha }
    })
  )

  // Create a new tree on top of the base
  const { data: newTree } = await octokit.git.createTree({
    owner, repo, base_tree: baseCommit.tree.sha, tree: treeItems,
  })

  // Commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner, repo, message: commitMessage, tree: newTree.sha, parents: [baseSha],
  })

  // Create or force-update the branch
  try {
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: newCommit.sha })
  } catch {
    await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha, force: true })
  }
}

export async function pushProjectToGitHub(params: {
  files: FileSnapshot[]
  projectTitle: string
  projectId: string
}): Promise<{ prUrl: string | null; error: string | null }> {
  const { files, projectTitle, projectId } = params

  const outputsRepo = process.env.GITHUB_OUTPUTS_REPO
  if (!outputsRepo) return { prUrl: null, error: 'GITHUB_OUTPUTS_REPO env var not set' }

  const [owner, repo] = outputsRepo.split('/')
  const branch = `jugnus/${projectId.slice(0, 8)}`

  try {
    const octokit = await getInstallationOctokit(owner)

    await pushBranch(octokit, owner, repo, branch, files, `jugnus: ${projectTitle}`)

    const { data: repoData } = await octokit.repos.get({ owner, repo })
    const { data: pr } = await octokit.pulls.create({
      owner, repo,
      title: `🤖 ${projectTitle}`,
      head: branch,
      base: repoData.default_branch,
      body: [
        `Built autonomously by the Jugnus AI team.`,
        ``,
        `**Project:** ${projectTitle}`,
        `**Files:** ${files.length}`,
        ``,
        `> A Vercel preview URL will appear in the PR checks once the build finishes.`,
      ].join('\n'),
    })

    return { prUrl: pr.html_url, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[github] pushProjectToGitHub failed:', msg)
    return { prUrl: null, error: msg }
  }
}
