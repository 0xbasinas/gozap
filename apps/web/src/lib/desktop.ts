/**
 * When the desktop app sends someone to the sign-in page it adds three query parameters (client_id, code_challenge,
 * state). They must travel with the sign-in request so the server can hand the finished sign-in back to the app.
 */
export interface DesktopParams {
  client_id: string
  code_challenge: string
  state: string
}

export function readDesktopParams(params: URLSearchParams): DesktopParams | null {
  const client_id = params.get('client_id')
  const code_challenge = params.get('code_challenge')
  const state = params.get('state')
  if (client_id !== 'electron' || !code_challenge || !state) return null
  return { client_id, code_challenge, state }
}
