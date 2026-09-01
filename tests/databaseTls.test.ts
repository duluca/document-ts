import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { AddressInfo, createConnection, Socket } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer, Server as TlsServer } from 'tls'

import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals'

import { close, connect, connectionStatus } from '../src/index'
import { testMongoUri } from './mongoTest'

jest.setTimeout(60_000)

describe('Database TLS integration', () => {
  let caFile: string
  let temporaryDirectory: string
  let tlsProxy: TlsServer
  let tlsProxyPort: number
  let wrongCaFile: string

  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'document-ts-tls-'))
    const certificates = createTestCertificates(temporaryDirectory)
    caFile = certificates.caFile
    wrongCaFile = certificates.wrongCaFile
    tlsProxy = await startTlsMongoProxy(
      certificates.serverCertificateFile,
      certificates.serverKeyFile
    )
    tlsProxyPort = (tlsProxy.address() as AddressInfo).port
  })

  afterAll(async () => {
    await close()
    if (tlsProxy) {
      await new Promise<void>((resolve, reject) => {
        tlsProxy.close((error) => (error ? reject(error) : resolve()))
      })
    }
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  })

  test('connects with the trusted CA and matching hostname', async () => {
    await connect({
      uri: proxyUri('localhost', tlsProxyPort),
      production: true,
      retry: { maxAttempts: 1, waitSeconds: 0 },
      tls: { enabled: true, caFile },
      mongoClientOptions: { family: 4, serverSelectionTimeoutMS: 3_000 },
    })

    expect(connectionStatus()).toBe(true)
    await close()
  })

  test('rejects an omitted CA before opening a production connection', async () => {
    await expect(
      connect({
        uri: proxyUri('localhost', tlsProxyPort),
        production: true,
        retry: { maxAttempts: 1, waitSeconds: 0 },
        tls: { enabled: true },
        mongoClientOptions: { family: 4, serverSelectionTimeoutMS: 3_000 },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })

    expect(connectionStatus()).toBe(false)
  })

  test('rejects a certificate signed by an untrusted CA', async () => {
    await expect(
      connect({
        uri: proxyUri('localhost', tlsProxyPort),
        production: true,
        retry: { maxAttempts: 1, waitSeconds: 0 },
        tls: { enabled: true, caFile: wrongCaFile },
        mongoClientOptions: { family: 4, serverSelectionTimeoutMS: 3_000 },
      })
    ).rejects.toThrow()

    expect(connectionStatus()).toBe(false)
  })

  test('rejects a trusted certificate whose hostname does not match', async () => {
    await expect(
      connect({
        uri: proxyUri('127.0.0.1', tlsProxyPort),
        production: true,
        retry: { maxAttempts: 1, waitSeconds: 0 },
        tls: { enabled: true, caFile },
        mongoClientOptions: { family: 4, serverSelectionTimeoutMS: 3_000 },
      })
    ).rejects.toThrow()

    expect(connectionStatus()).toBe(false)
  })
})

function proxyUri(host: string, port: number): string {
  return `mongodb://${host}:${port}/tlsDb?directConnection=true`
}

async function startTlsMongoProxy(
  certificateFile: string,
  keyFile: string
): Promise<TlsServer> {
  const upstreamUri = new URL(testMongoUri('tls_upstream'))
  const upstreamHost = upstreamUri.hostname
  const upstreamPort = Number(upstreamUri.port || '27017')
  const upstreamSockets = new Set<Socket>()
  const server = createServer({
    cert: readFileSync(certificateFile),
    key: readFileSync(keyFile),
  })

  server.on('secureConnection', (clientSocket) => {
    const upstreamSocket = createConnection({
      host: upstreamHost,
      port: upstreamPort,
    })
    upstreamSockets.add(upstreamSocket)
    upstreamSocket.on('close', () => upstreamSockets.delete(upstreamSocket))
    upstreamSocket.on('error', (error) => clientSocket.destroy(error))
    clientSocket.on('error', () => upstreamSocket.destroy())
    clientSocket.pipe(upstreamSocket).pipe(clientSocket)
  })
  server.on('tlsClientError', () => undefined)
  server.on('close', () => {
    for (const socket of upstreamSockets) {
      socket.destroy()
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  return server
}

function createTestCertificates(directory: string): {
  caFile: string
  serverCertificateFile: string
  serverKeyFile: string
  wrongCaFile: string
} {
  const caFile = join(directory, 'ca.pem')
  const caKeyFile = join(directory, 'ca-key.pem')
  const serverCertificateFile = join(directory, 'server-cert.pem')
  const serverCertificateRequestFile = join(directory, 'server.csr')
  const serverExtensionFile = join(directory, 'server.ext')
  const serverKeyFile = join(directory, 'server-key.pem')
  const wrongCaFile = join(directory, 'wrong-ca.pem')
  const wrongCaKeyFile = join(directory, 'wrong-ca-key.pem')

  runOpenSsl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-days',
    '1',
    '-nodes',
    '-subj',
    '/CN=document-ts-test-ca',
    '-keyout',
    caKeyFile,
    '-out',
    caFile,
  ])
  runOpenSsl([
    'req',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-nodes',
    '-subj',
    '/CN=localhost',
    '-keyout',
    serverKeyFile,
    '-out',
    serverCertificateRequestFile,
  ])

  writeFileSync(
    serverExtensionFile,
    'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n'
  )
  runOpenSsl([
    'x509',
    '-req',
    '-in',
    serverCertificateRequestFile,
    '-CA',
    caFile,
    '-CAkey',
    caKeyFile,
    '-CAcreateserial',
    '-days',
    '1',
    '-sha256',
    '-extfile',
    serverExtensionFile,
    '-out',
    serverCertificateFile,
  ])
  runOpenSsl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-days',
    '1',
    '-nodes',
    '-subj',
    '/CN=document-ts-wrong-ca',
    '-keyout',
    wrongCaKeyFile,
    '-out',
    wrongCaFile,
  ])

  return { caFile, serverCertificateFile, serverKeyFile, wrongCaFile }
}

function runOpenSsl(arguments_: string[]): void {
  try {
    execFileSync('openssl', arguments_, { stdio: 'pipe' })
  } catch {
    throw new Error(`openssl failed: openssl ${arguments_.join(' ')}`)
  }
}
