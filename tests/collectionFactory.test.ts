/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, test, beforeEach, afterEach } from '@jest/globals'

import { IUser, User, UserCollection } from './user'

const expectedPassword = '$2a$10$pJsAxlvrV2hK9QWvdObYAOcvKrkI.VNyYtG01eYvJ2UYt8Keb2/6q'

const newUser = {
  firstName: 'Doguhan',
  lastName: 'Uluca',
  email: 'duluca@gmail.com',
  role: 'author',
} as IUser

function getExpectedUser() {
  const userInstance = new User(newUser)
  Object.assign(userInstance, {
    password: expectedPassword,
  })
  return userInstance
}

describe('CollectionFactory', () => {
  beforeEach(async () => {})

  afterEach(async () => {})

  test('should hydrate object', async () => {
    const expectedUser = getExpectedUser()

    const actualUser = UserCollection.hydrateObject(
      Object.assign(newUser, {
        password: expectedPassword,
      })
    )

    expect(actualUser).toBeDefined()
    expect(actualUser).toEqual(expectedUser)
  })

  test('should not serialize private property password', async () => {
    const actualUser = UserCollection.hydrateObject(
      Object.assign(newUser, {
        password: expectedPassword,
      })
    )

    expect((actualUser.toJSON() as any).password).toBeUndefined()
  })

  test('should serialize calculate property fullname', async () => {
    const expectedFullName = 'Doguhan Uluca'

    const actualUser = UserCollection.hydrateObject(newUser)

    expect((actualUser.toJSON() as any).fullName).toBe(expectedFullName)
  })
})
