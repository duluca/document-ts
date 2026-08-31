# Changelog

## 7.0.0

### Breaking changes

- `Document.save()` now rejects with a typed `DocumentException` when a database
  write fails. It no longer logs the native error and resolves `false`.
- Model constructors call `super(collectionName)` and then the validated public
  `fillData()` method. Model data assignment moves from overriding `fillData()` to
  implementing the protected `applyData()` hook.
- `_id` and `collectionName` are read-only framework identity. Only
  `CollectionFactory` can hydrate a database `_id`.
- Existing-document saves use optimistic concurrency and can reject with
  `DocumentConflictException` when the stored document changed after hydration.
- `CollectionFactory.findOneAndUpdate()` accepts update-operator documents only,
  advances the optimistic-concurrency revision, and returns a deliberately stale
  model unless `returnDocument: 'after'` is requested.
- Database-result hydration is module-private. The public `hydrateObject()` escape
  hatch is removed, and hydrated projections must retain `_id`.

### Security and correctness

- Sanitize duplicate-key and unclassified database errors while retaining a
  non-enumerable native `cause` for trusted diagnostics.
- Reject reserved and prototype-sensitive hydration fields before applying any
  data.
- Reject update and delete operations without a valid `ObjectId`.
- Preserve empty, nested, plain-object, and BSON-native array values during
  serialization.
