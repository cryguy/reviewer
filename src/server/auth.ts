// ---------------------------------------------------------------------------
// Basic auth middleware
// ---------------------------------------------------------------------------

export function authenticate(
  request: Request,
  authConfig: Record<string, string>,
): { username: string } | null {
  const authHeader = request.headers.get('Authorization');
  if (authHeader === null || !authHeader.startsWith('Basic ')) {
    return null;
  }

  const base64 = authHeader.slice('Basic '.length);
  let decoded: string;
  try {
    decoded = atob(base64);
  } catch {
    return null;
  }

  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  const username = decoded.slice(0, colonIndex);
  const password = decoded.slice(colonIndex + 1);

  const expectedPassword = authConfig[username];
  if (expectedPassword === undefined || expectedPassword !== password) {
    return null;
  }

  return { username };
}

export function unauthorizedResponse(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Reviewer Dashboard"',
      'Content-Type': 'text/plain',
    },
  });
}
