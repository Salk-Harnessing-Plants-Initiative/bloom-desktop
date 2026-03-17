## ADDED Requirements

### Requirement: Typed Image Status

The system SHALL define an `ImageStatus` TypeScript union type constraining image status values to `'pending'`, `'uploading'`, `'uploaded'`, and `'failed'`.

#### Scenario: Valid status values accepted

- **WHEN** a status value of `'pending'`, `'uploading'`, `'uploaded'`, or `'failed'` is assigned to a variable of type `ImageStatus`
- **THEN** the TypeScript compiler SHALL accept the assignment without error

#### Scenario: Invalid status values rejected at compile time

- **WHEN** a status value not in the set (`'pending'`, `'uploading'`, `'uploaded'`, `'failed'`) is assigned to a variable of type `ImageStatus`
- **THEN** the TypeScript compiler SHALL emit a type error

#### Scenario: Scanner image creation uses typed status

- **WHEN** `scanner-process.ts` creates image records with `status: 'pending'`
- **THEN** the status literal SHALL be checked against the `ImageStatus` type at compile time

#### Scenario: Upload status transitions use valid status values

- **WHEN** `image-uploader.ts` updates image status to `'uploading'`, `'uploaded'`, or `'failed'`
- **THEN** each status literal used for an upload status transition SHALL be assigned through an `ImageStatus`-typed variable, checked at compile time
