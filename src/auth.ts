export interface AuthResult {
  token: string;
  email: string;
}

async function post(base: string, path: string, body: unknown): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(base.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('could not reach the server');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as AuthResult;
}

export function login(base: string, email: string, password: string): Promise<AuthResult> {
  return post(base, '/api/login', { email, password });
}

export function signup(
  base: string,
  email: string,
  password: string,
  invite: string,
): Promise<AuthResult> {
  return post(base, '/api/signup', { email, password, invite });
}
