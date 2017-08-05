import { Document, connect } from '../dist/index'
import { User, UserCollection } from './user'

import { ObjectID } from 'mongodb'

async function doWork() {
  await connect('mongodb://localhost:27017/test')
  console.log('Connected to db.')
  let user = new User()
  await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
  let foundUser = await UserCollection.findOne({'lastName': 'Uluca'})
  console.log(foundUser.firstName)
}

doWork()