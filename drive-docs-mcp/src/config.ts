export interface Config {
  port: number;
  /** Root name → Drive folder id. Paths start with the root name. */
  roots: Record<string, string>;
  mcpSecret: string;
  google: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
}

const REQUIRED = ['DRIVE_ROOTS', 'MCP_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;

const MIN_SECRET_LENGTH = 32;
const ROOT_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const FOLDER_ID = /^[A-Za-z0-9_-]+$/;

/** Parses "xapiems=1AbC...,finance=1XyZ..." into { xapiems: '1AbC...', finance: '1XyZ...' }. */
export function parseRoots(value: string): Record<string, string> {
  const roots: Record<string, string> = {};
  const pairs = value.split(',').map((pair) => pair.trim()).filter(Boolean);
  if (pairs.length === 0) throw new Error('DRIVE_ROOTS must list at least one name=folderId pair');

  for (const pair of pairs) {
    const [name = '', id = '', ...rest] = pair.split('=').map((part) => part.trim());
    if (rest.length > 0 || !ROOT_NAME.test(name) || !FOLDER_ID.test(id)) {
      throw new Error(`Invalid DRIVE_ROOTS entry "${pair}": use name=folderId, name in lowercase letters, digits, "-" or "_"`);
    }
    if (name in roots) throw new Error(`DRIVE_ROOTS repeats the name "${name}"`);
    roots[name] = id;
  }
  return roots;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const secret = env.MCP_SECRET as string;
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`MCP_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  return {
    port: Number(env.PORT ?? 3000),
    roots: parseRoots(env.DRIVE_ROOTS as string),
    mcpSecret: secret,
    google: {
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      refreshToken: env.GOOGLE_REFRESH_TOKEN as string,
    },
  };
}
