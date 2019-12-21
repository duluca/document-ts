import * as bcrypt from 'bcryptjs'
import { AggregationCursor, ObjectID } from 'mongodb'
import { v4 as uuid } from 'uuid'

import { CollectionFactory, Document, IDocument } from '../src/index'
import { Color, IColor } from './color'

export interface IUser extends IDocument {
  email?: string
  firstName?: string
  lastName?: string
  role?: string
  colors: IColor[]
}

export class User extends Document<IUser> implements IUser {
  constructor(user?: Partial<IUser>) {
    super(User.collectionName, user)
  }

  public get fullName(): string {
    return `${this.firstName} ${this.lastName}`
  }
  static collectionName = 'users'
  private password: string
  public email: string
  public firstName: string
  public lastName: string
  public role: string
  public colors: Color[]

  fillData(data?: Partial<IUser>) {
    if (data) {
      Object.assign(this, data)

      if (this.colors) {
        this.colors = this.hydrateInterfaceArray(Color, Color.Build, this.colors)
      }
    }
  }

  getCalculatedPropertiesToInclude(): string[] {
    return ['fullName']
  }

  getPropertiesToExclude(): string[] {
    return ['password']
  }

  async create(
    firstName: string,
    lastName: string,
    email: string,
    role: string,
    password?: string,
    colors?: IColor[]
  ) {
    this.firstName = firstName
    this.lastName = lastName
    this.email = email
    this.role = role

    if (!password) {
      password = uuid()
    }

    this.password = await this.setPassword(password)

    if (colors) {
      this.colors = this.hydrateInterfaceArray(Color, Color.Build, colors)
    }

    await this.save()
  }

  async resetPassword(newPassword: string) {
    this.password = await this.setPassword(newPassword)
    await this.save()
  }

  private setPassword(newPassword: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      bcrypt.genSalt(10, (err, salt) => {
        if (err) {
          return reject(err)
        }
        bcrypt.hash(newPassword, salt, (hashError, hash) => {
          if (hashError) {
            return reject(hashError)
          }
          resolve(hash)
        })
      })
    })
  }

  comparePassword(password: string): Promise<boolean> {
    const user = this
    return new Promise((resolve, reject) => {
      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err) {
          return reject(err)
        }
        resolve(isMatch)
      })
    })
  }

  hasSameId(id: ObjectID): boolean {
    return this._id.toHexString() === id.toHexString()
  }

  toJSON() {
    // drop a breakpoint here or console.log(this)
    return super.toJSON()
  }

  toBSON() {
    return super.toBSON()
  }
}

class UserCollectionFactory extends CollectionFactory<User> {
  constructor(docType: typeof User) {
    super(User.collectionName, docType, ['firstName', 'lastName', 'email'])
  }

  async createIndexes() {
    await this.collection().createIndexes([
      {
        key: {
          email: 1,
        },
        unique: true,
      },
      {
        key: {
          firstName: 'text',
          lastName: 'text',
          email: 'text',
        },
        weights: {
          lastName: 4,
          firstName: 2,
          email: 1,
        },
        name: 'TextIndex',
      },
    ])
  }

  // This is a contrived example for demonstration purposes
  // It is possible to execute far more sophisticated and
  // high performance queries using Aggregation in MongoDB
  // Documentation: https://docs.mongodb.com/manual/aggregation/
  userSearchQuery(
    searchText: string
  ): AggregationCursor<{ _id: ObjectID; email: string }> {
    const aggregateQuery = [
      {
        $match: {
          $text: { $search: searchText },
        },
      },
      {
        $project: {
          email: 1,
        },
      },
    ]

    if (searchText === undefined || searchText === '') {
      delete (aggregateQuery[0] as any).$match.$text
    }

    return this.collection().aggregate(aggregateQuery)
  }
}

export let UserCollection = new UserCollectionFactory(User)
