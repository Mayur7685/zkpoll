import axios from "axios"

/**
 * Check whether a GitHub user (by username) meets optional criteria.
 * Currently just verifies the account exists (connected via OAuth = account exists).
 * Future: params.minRepos, params.minFollowers, params.orgName
 */
export async function checkGitHubAccount(
  username: string,
  _params: { minRepos?: number; minFollowers?: number; orgName?: string } = {},
): Promise<boolean> {
  if (!username) return false
  try {
    // No auth header needed for public user info (60 req/hr unauthenticated)
    const res = await axios.get(`https://api.github.com/users/${encodeURIComponent(username)}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (res.status !== 200) return false
    const user = res.data as { public_repos: number; followers: number }

    if (_params.minRepos !== undefined && user.public_repos < _params.minRepos) return false
    if (_params.minFollowers !== undefined && user.followers < _params.minFollowers) return false

    if (_params.orgName) {
      try {
        await axios.get(
          `https://api.github.com/orgs/${encodeURIComponent(_params.orgName)}/members/${encodeURIComponent(username)}`,
          { headers: { Accept: 'application/vnd.github+json' } },
        )
      } catch {
        return false  // 404 = not a member
      }
    }

    return true
  } catch {
    return false
  }
}
