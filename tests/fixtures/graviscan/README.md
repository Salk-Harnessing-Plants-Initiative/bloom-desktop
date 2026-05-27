# GraviScan fixtures

## accessions-sample.xlsx

Canonical sample accessions file for the GraviScan "Upload Accessions" flow. Used as the linked example in the [Bloom Desktop — GraviScan operator manual](../../docs/superpowers/specs/2026-05-26-graviscan-user-manual-design.md).

**Columns** (header row required; header names below are the spec-canonical snake_case form, but the in-app column-mapping UI lets operators map any header to the right field):

| Column | Type | Required | Example |
|---|---|---|---|
| `plate_id` | string | yes | `PLATE_001` |
| `plate_section_id` | string | yes | `S1` |
| `plant_qr` | string | yes | `PLANT-001-A` |
| `accession` | string | yes | `Col-0` |
| `transplant_date` | date | yes | `2025-06-15` |
| `medium` | string | yes | `1/2 MS` |
| `custom_note` | string | no | `replant` |

The sample covers 3 plates × 4 sections = 12 rows, with 3 different accessions (Col-0, Ler-0, Cvi-0) demonstrating the "one accession per plate" rule.

**Source:** copied from `/home/graviscan/Desktop/test-metadata-sample.xlsx` on the production rig 2026-05-26, during the PR #237 rig validation brainstorm. The same file is uploaded to the team Box folder; the operator manual links the Box URL.

**Code reference:** see `src/renderer/components/GraviMetadataUpload.tsx` (validates + parses) and `src/renderer/utils/graviMetadataValidation.ts` (validation rules).
