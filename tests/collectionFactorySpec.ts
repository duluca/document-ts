'use strict'

import { IUser, User, UserCollection } from './user'

describe('CollectionFactory', function() {
  beforeEach(async () => {})

  afterEach(async () => {})

  it('should hydrate object', async () => {
    const newUser = {
      firstName: 'Doguhan',
      lastName: 'Uluca',
      email: 'duluca@gmail.com',
      role: 'author',
    } as IUser

    const expectedUser = new User(newUser)
    const expectedPassword =
      '$2a$10$pJsAxlvrV2hK9QWvdObYAOcvKrkI.VNyYtG01eYvJ2UYt8Keb2/6q'
    Object.assign(expectedUser, {
      password: expectedPassword,
    })

    const actualUser = UserCollection.hydrateObject(
      Object.assign(newUser, {
        password: expectedPassword,
      })
    )

    expect(actualUser).toBeDefined()
    expect(actualUser).toEqual(expectedUser)
    expect(actualUser.fullName).toBe('Doguhan Uluca')
  })
})
