import { connect } from '../dist/index'

export async function connectForDevelopment(uri: string): Promise<void> {
  await connect({
    uri,
    retry: { maxAttempts: 10, waitSeconds: 5 },
    mongoClientOptions: { maxPoolSize: 10 },
  })
}

export async function connectForProduction(uri: string, caFile: string): Promise<void> {
  await connect({
    uri,
    production: true,
    tls: { enabled: true, caFile },
    mongoClientOptions: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10_000,
    },
  })
}

export function legacyPositionalSignatureDoesNotCompile(): Promise<void> {
  // @ts-expect-error The positional v6 API is intentionally removed.
  return connect('mongodb://localhost:27017/testDb')
}
