import { connect } from '../src/index'
import { User, UserCollection } from './user'

async function doWork() {
  await connect('mongodb://localhost:27017/test')
  console.log('Connected to db.')
  const user = new User()
  await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
  const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })
  console.log(foundUser.firstName)
}

doWork()
