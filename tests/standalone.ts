/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { ObjectId } from 'mongodb'
import { connect } from '../src/index'
import { User, UserCollection } from './user'

import { spawn } from 'child_process'
import process from 'process'

import assert from 'node:assert'

function cmd(...command: string[]) {
  const p = spawn(command[0], command.slice(1))
  return new Promise((resolveFunc) => {
    p.stdout.on('data', (x) => {
      process.stdout.write(x.toString())
    })
    p.stderr.on('data', (x) => {
      process.stderr.write(x.toString())
    })
    p.on('exit', (code) => {
      resolveFunc(code)
    })
  })
}
async function setup() {
  console.log('Setting up test db...')
  await cmd('docker', 'rm', '-f', 'minimal-mongo')

  await cmd(
    'docker',
    'run',
    '--env-file',
    '.env',
    '--name',
    'minimal-mongo',
    '-d',
    '-p',
    '27017:27017',
    'duluca/minimal-mongo'
  )

  return
}

async function testFindOne() {
  const user = new User()
  await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
  const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })
  console.log(`(Name) Expected: Doguhan, Actual: ${foundUser.firstName}`)
  assert.strictEqual(foundUser.firstName, 'Doguhan')
  await user.delete()
}

async function testPagination() {
  const expectedRecordCount = 20

  try {
    let user: User
    for (let i = 0; i < expectedRecordCount; i++) {
      user = new User()
      await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
    }
  } catch (ex) {
    console.error(ex)
  }

  const aggregateQueryGetter = () => UserCollection.userSearchQuery('')

  const results = await UserCollection.findWithPagination<{
    _id: ObjectId
    email: string
  }>({ skip: 10, limit: 10 }, aggregateQueryGetter)

  console.log(`(Data) Excepted: 10, Actual: ${results.data.length}`)
  assert.strictEqual(results.data.length, 10)
  console.log(`(Total) Expected: 20, Actual: ${results.total}`)
  assert.strictEqual(results.total, 20)
}

async function testSearch() {
  let user: User
  try {
    user = new User()
    await user.create('Ali', 'Smith', 'efg@gmail.com', 'user')
    user = new User()
    await user.create('Veli', 'Tepeli', 'veli@gmail.com', 'user')
    user = new User()
    await user.create('Justin', 'Thunderclaps', 'thunderdome@hotmail.com', 'user')
    user = new User()
    await user.create('Tim', 'John', 'jt23@hotmail.com', 'user')
    user = new User()
    await user.create('Obladi', 'Oblada', 'apple@smith.com', 'user')
    user = new User()
    await user.create('Smith', 'Jones', 'jones.smith@icloud.com', 'user')
  } catch (ex) {
    console.error(ex)
  }

  const results = await UserCollection.findWithPagination<{
    _id: ObjectId
    email: string
    fullName: string
  }>({
    filter: 'smith jones',
    projectionKeyOrList: ['email', 'fullName', '_id', 'firstName', 'lastName'],
  })

  console.log(`(Name) Expected: Smith Jones, Actual: ${results.data[0].fullName}`)
  assert.strictEqual(results.data[0].fullName, 'Smith Jones')
  console.log(`(Data) Excepted: 1, Actual: ${results.data.length}`)
  assert.strictEqual(results.data.length, 1)
  console.log(`(Total) Expected: 1, Actual: ${results.total}`)
  assert.strictEqual(results.total, 1)
}

async function runTests() {
  await connect('mongodb://john.smith:g00fy@localhost:27017/acme')
  console.log('Connected to db.')
  console.log(`Users found: ${await UserCollection.getTotal()}`)

  await UserCollection.createIndexes()

  await testFindOne()
  await testPagination()
  await testSearch()

  return
}

async function start() {
  await setup()
  await runTests()
  process.exit(0)
}

start()
