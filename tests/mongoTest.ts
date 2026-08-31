function safeDatabaseSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24)
  return normalized || fallback
}

export function testMongoUri(
  suite: string,
  environment: NodeJS.ProcessEnv = process.env
): string {
  const worker = safeDatabaseSegment(environment.JEST_WORKER_ID ?? 'local', 'local')
  const explicitRun = environment.DOCUMENT_TS_TEST_RUN_ID
  const githubRun = environment.GITHUB_RUN_ID
    ? `${environment.GITHUB_RUN_ID}_${environment.GITHUB_RUN_ATTEMPT ?? '1'}`
    : undefined
  const localRun = `pid_${process.pid}`
  const run = safeDatabaseSegment(explicitRun ?? githubRun ?? localRun, 'run')
  const suiteName = safeDatabaseSegment(suite, 'suite')
  const database = `document_ts_${suiteName}_${run}_${worker}`.slice(0, 63)
  const uri = new URL(environment.MONGO_URI ?? 'mongodb://127.0.0.1:27017')
  uri.pathname = `/${database}`
  return uri.toString()
}
