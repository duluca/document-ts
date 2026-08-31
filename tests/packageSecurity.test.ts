import { afterAll, beforeAll, describe, expect, test } from '@jest/globals'

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('published package query security', () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const workspace = mkdtempSync(join(tmpdir(), 'document-ts-package-test-'))
  const installDirectory = join(workspace, 'consumer')
  const repositoryRoot = resolve(__dirname, '..')
  const npmEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    npm_config_cache: join(workspace, 'npm-cache'),
  }
  delete npmEnvironment.NODE_V8_COVERAGE

  beforeAll(() => {
    mkdirSync(installDirectory)
    writeFileSync(
      join(installDirectory, 'package.json'),
      JSON.stringify({ name: 'document-ts-package-consumer', private: true })
    )

    const packOutput = execFileSync(
      npm,
      ['pack', '--ignore-scripts', '--json', '--pack-destination', workspace],
      { cwd: repositoryRoot, encoding: 'utf8', env: npmEnvironment }
    )
    const packageName = (JSON.parse(packOutput) as Array<{ filename: string }>)[0]
      ?.filename
    if (!packageName) {
      throw new Error('npm pack did not return a package filename')
    }

    execFileSync(
      npm,
      [
        'install',
        '--ignore-scripts',
        '--legacy-peer-deps',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        join(workspace, packageName),
      ],
      { cwd: installDirectory, stdio: 'pipe', env: npmEnvironment }
    )
  }, 30_000)

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  test('installed tarball treats search literally and enforces published limits', () => {
    const script = String.raw`
      const {
        CollectionFactory,
        Document,
        DocumentException,
        MAX_SEARCH_TEXT_LENGTH,
        MAX_SEARCH_TOKENS,
      } = require('document-ts')

      class PackageDocument extends Document {
        constructor(data) { super('records', data) }
        fillData(data) { if (data) Object.assign(this, data) }
        getCalculatedPropertiesToInclude() { return [] }
        getPropertiesToExclude() { return [] }
      }
      class PackageCollection extends CollectionFactory {
        constructor() { super('records', PackageDocument, ['name']) }
      }

      const collection = new PackageCollection()
      const literal = collection.buildTokenizedQueryObject('.*', ['name']).$or[0].name
      if (!literal.test('.*') || literal.test('unrelated')) process.exit(2)
      if (Object.keys(collection.buildTokenizedQueryObject('  ', ['name'])).length !== 0) process.exit(3)
      if (MAX_SEARCH_TEXT_LENGTH !== 256 || MAX_SEARCH_TOKENS !== 16) process.exit(4)

      collection.buildTokenizedQueryObject('a'.repeat(MAX_SEARCH_TEXT_LENGTH), ['name'])
      collection.buildTokenizedQueryObject(Array(MAX_SEARCH_TOKENS).fill('a').join(' '), ['name'])

      for (const value of [
        'a'.repeat(MAX_SEARCH_TEXT_LENGTH + 1),
        Array(MAX_SEARCH_TOKENS + 1).fill('a').join(' '),
      ]) {
        let rejected = false
        try {
          collection.buildTokenizedQueryObject(value, ['name'])
        } catch (error) {
          rejected = error instanceof DocumentException
        }
        if (!rejected) process.exit(5)
      }
    `

    expect(() =>
      execFileSync(process.execPath, ['-e', script], {
        cwd: installDirectory,
        env: {
          ...process.env,
          NODE_PATH: join(repositoryRoot, 'node_modules'),
        },
        stdio: 'pipe',
      })
    ).not.toThrow()
  })
})
