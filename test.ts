import * as document from './index'

async function start() {
  await document.connect('mongodb://localhost:27017/minimal-mean')
  console.log('Connected to database asyncly...')
}

start()