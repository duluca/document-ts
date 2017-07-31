'use strict';
import { Document, connect } from '../dist/index'

const MongoInMemory = require('mongo-in-memory')

describe('Document', function() {

  var mongoServerInstance
  const port = 28000

  beforeEach(done => {
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

  it('should open a connection with a dummy database name', done => {
    let uri = mongoServerInstance.getMongouri("testDb")
    connect(uri).then(() => {
      done()
    })
  })

})