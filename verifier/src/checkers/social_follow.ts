import axios from "axios"

export async function checkXFollow(
  userXId: string,
  targetHandle: string,
  bearerToken: string,
): Promise<boolean> {
  const res = await axios.get(
    `https://api.twitter.com/2/users/${userXId}/following?user.fields=username&max_results=1000`,
    { headers: { Authorization: `Bearer ${bearerToken}` } },
  )
  return (res.data.data ?? []).some(
    (u: { username: string }) =>
      u.username.toLowerCase() === targetHandle.replace("@", "").toLowerCase(),
  )
}

export async function checkDiscordMember(
  userId: string,
  serverId: string,
  botToken: string,
): Promise<boolean> {
  try {
    await axios.get(
      `https://discord.com/api/v10/guilds/${serverId}/members/${userId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    )
    return true
  } catch {
    return false
  }
}

export async function checkDiscordRole(
  userId: string,
  serverId: string,
  roleId: string,
  botToken: string,
): Promise<boolean> {
  try {
    const res = await axios.get(
      `https://discord.com/api/v10/guilds/${serverId}/members/${userId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    )
    return (res.data.roles as string[]).includes(roleId)
  } catch {
    return false
  }
}
