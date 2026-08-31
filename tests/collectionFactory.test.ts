/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, test, beforeEach, afterEach } from '@jest/globals'

import * as publicApi from '../src/index'
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

  test('does not expose or reveal a trusted hydration hook', () => {
    type HydrationIsPrivate = 'hydrateObject' extends keyof typeof UserCollection
      ? never
      : true
    const hydrationIsPrivate: HydrationIsPrivate = true
    const factoryPropertyNames: string[] = []
    const factorySymbols: symbol[] = []
    const modelSymbols: symbol[] = []
    let prototype: object | null = UserCollection

    while (prototype) {
      factoryPropertyNames.push(...Object.getOwnPropertyNames(prototype))
      factorySymbols.push(...Object.getOwnPropertySymbols(prototype))
      prototype = Reflect.getPrototypeOf(prototype)
    }
    prototype = User.prototype
    while (prototype) {
      modelSymbols.push(...Object.getOwnPropertySymbols(prototype))
      prototype = Reflect.getPrototypeOf(prototype)
    }

    expect(hydrationIsPrivate).toBe(true)
    expect(factoryPropertyNames).not.toContain('hydrateObject')
    expect(factoryPropertyNames).not.toContain('trustedHydration')
    expect(factorySymbols).toEqual([])
    expect(modelSymbols).toEqual([])
    expect(Reflect.get(UserCollection, 'hydrateObject')).toBeUndefined()
    expect(Reflect.get(publicApi, 'trustedHydration')).toBeUndefined()
  })

  test('should not serialize private property password', () => {
    const actualUser = getExpectedUser()

    expect((actualUser.toJSON() as any).password).toBeUndefined()
  })

  test('should serialize calculate property fullname', () => {
    const expectedFullName = 'Doguhan Uluca'
    const actualUser = new User(newUser)

    expect((actualUser.toJSON() as any).fullName).toBe(expectedFullName)
  })
})
