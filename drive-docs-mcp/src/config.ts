export interface Config {
  port: number;
  rootFolderId: string;
  mcpSecret: string;
  google: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
}

const REQUIRED = [
  'DRIVE_ROOT_FOLDER_ID',
  'MCP_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
] as const;

const MIN_SECRET_LENGTH = 32;

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
    rootFolderId: env.DRIVE_ROOT_FOLDER_ID as string,
    mcpSecret: secret,
    google: {
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      refreshToken: env.GOOGLE_REFRESH_TOKEN as string,
    },
  };
}
