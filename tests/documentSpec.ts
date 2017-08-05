'use strict';
import { Document, connect } from '../dist/index'
import { User, UserCollection } from './user'

const MongoInMemory = require('mongo-in-memory')

describe('Document', function() {

  var mongoServerInstance
  const port = 28000

  beforeEach(done => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000
    mongoServerInstance = new MongoInMemory(port)
    mongoServerInstance.start((error, config) => {
      done()
    })
  })

  afterEach(done => {
    mongoServerInstance.stop((error) => {
      done()
    })
  })

  it('should open a connection with a dummy database name', async done => {
    let uri = mongoServerInstance.getMongouri("testDb")
    await connect(uri)
    done()
  })

  it('should store a user', async done => {
    let uri = mongoServerInstance.getMongouri("testDb")
    await connect(uri)

    let expectedException = null
    let actualException = null

    try {
      let user = new User()
      await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)
    done()
  })

  it('should find a user', async done => {
    let uri = mongoServerInstance.getMongouri("testDb")
    await connect(uri)

    var expectedFirstName = 'Doguhan'

    let user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    let foundUser = await UserCollection.findOne({'lastName': 'Uluca'})


    expect(expectedFirstName).toEqual(foundUser.firstName)
    done()
  })

  it('should find a user with fullName', async done => {
    let uri = mongoServerInstance.getMongouri("testDb")
    await connect(uri)

    var expectedFullName = 'Doguhan Uluca'

    let user = new User()
    await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
    let foundUser = await UserCollection.findOne({'lastName': 'Uluca'})

    expect(expectedFullName).toEqual(foundUser.fullName)
    done()
  })
})