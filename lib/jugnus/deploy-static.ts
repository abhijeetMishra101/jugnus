export function getPreviewUrl(projectId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://jugnus.vercel.app'
  return `${base}/preview/${projectId}`
}
