# Migrating from 6.x to 7.0

## Handle save failures as rejections

In 6.x, a failed `save()` could write the native driver error to the console and
resolve `false`. Callers that ignored the boolean could continue as though the
write succeeded. In 7.0, every failed insert or update rejects with a typed error:

```ts
try {
  await user.save()
} catch (error) {
  if (error instanceof DocumentException) {
    switch (error.code) {
      case 'DOCUMENT_DUPLICATE_KEY':
        // Ask the user for a different unique value.
        break
      case 'DOCUMENT_CONFLICT':
        // Reload and deliberately reapply the intended change.
        break
      default:
        // Treat the operation as failed.
        break
    }
  }
  throw error
}
```

Public messages and `JSON.stringify(error)` are sanitized. The original driver
error is available to trusted server-side diagnostics as the non-enumerable
`error.cause`; never return that cause to an untrusted client.

## Move model assignment to applyData

The base constructor no longer accepts data. This ensures derived class field
initializers finish before hydration and puts public hydration behind validation.

```ts
class User extends Document<IUser> implements IUser {
  constructor(data?: Partial<IUser>) {
    super('users')
    if (data) {
      this.fillData(data)
    }
  }

  protected applyData(data?: Partial<IUser>): void {
    if (data) {
      Object.assign(this, data)
    }
  }
}
```

Do not override `fillData()`. It rejects the entire payload before assignment when
the payload contains `_id`, `collectionName`, prototype keys, framework methods,
accessors, symbols, or function-valued members. `CollectionFactory` uses a
module-private path to hydrate a valid MongoDB `ObjectId`; there is no public
`hydrateObject()` escape hatch. Hydrating a projection that excludes `_id` now
rejects, so set `rawOutput: true` only when trusted code intentionally requests
such a projection and accepts responsibility for disclosure control.

## Treat identity as read-only

Application input can no longer set `_id` or `collectionName`. Construct new
documents without `_id`; load existing documents through `CollectionFactory`.
Calling `delete()` without a factory-hydrated or insert-generated `ObjectId`
rejects with `DocumentIdentifierException`.

## Resolve optimistic-concurrency conflicts

Every successful model update advances an internal revision. A stale model rejects
with `DocumentConflictException` without changing the database. Reload the current
record and deliberately reapply only the intended domain change. Do not blindly
retry a stale model because doing so can restore revoked roles, tokens, or other
security state.

`CollectionFactory.findOneAndUpdate()` now advances the same internal revision.
Pass a MongoDB `UpdateFilter` containing update operators; replacement-style
objects are no longer accepted. The reserved `__documentTsVersion` path cannot be
set, incremented, unset, or renamed by application code. Use
`returnDocument: 'after'` when you intend to edit and save the returned model;
MongoDB's default pre-update result is intentionally stale after the atomic update.
