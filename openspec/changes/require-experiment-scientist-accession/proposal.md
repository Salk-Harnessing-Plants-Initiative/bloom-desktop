## Why

In the pilot, experiment creation requires a scientist and accession file. In bloom-desktop, both fields are optional, allowing experiments to be created without linked scientist or accession data. This breaks feature parity and can lead to incomplete data and missing accession lookups during scanning. See #103.

## What Changes

- Make Scientist field required in ExperimentForm Zod schema and UI
- Make Accession File field required in ExperimentForm Zod schema and UI
- Update label text to remove "(optional)" indicators
- Add validation error messages for empty scientist/accession selection
- Align with pilot behavior: all four fields (name, species, scientist, accession) must be filled

## Impact

- Affected specs: `ui-management-pages` (Create Experiment requirement)
- Affected code: `src/renderer/components/ExperimentForm.tsx`
- No database schema changes (fields remain nullable at DB level to preserve existing data and schema alignment with pilot)
- Existing experiments without scientist/accession remain valid in the database; only new creation is gated

## Design Decisions

### No Database Schema Change

The Prisma schema keeps `scientist_id String?` and `accession_id String?` as nullable. Rationale:
1. **Pilot alignment**: The pilot schema also uses nullable fields with UI-level enforcement
2. **Backward compatibility**: Existing experiments without scientist/accession remain queryable
3. **Attach-after-create flow**: The "Attach Accession" feature on the Experiments page still works for legacy data
4. **No migration needed**: Avoids data loss risk for existing experiments