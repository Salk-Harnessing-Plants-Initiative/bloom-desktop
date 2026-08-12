# GraviScan Metadata Spreadsheet Schema

`GraviMetadataUpload.tsx` accepts an Excel spreadsheet (`.xlsx`/`.xls`, up
to 15MB) and lets the operator map its columns to the fields below before
import. Column order and header names in the source spreadsheet don't
matter — mapping is done interactively at upload time.

## Required columns

| Field           | Description                                                              |
| --------------- | ------------------------------------------------------------------------ |
| Plate ID        | Identifier for the physical plate (e.g. `P1`, `P2`)                      |
| Section ID      | Identifier for a section within the plate                                |
| Plant QR        | QR code value printed on/near the plant, used for scan-time verification |
| Accession       | Plant accession/genotype for this section                                |
| Medium          | Growth medium used for this section                                      |
| Transplant Date | Date the plant was transplanted (Excel date or `YYYY-MM-DD`)             |

## Optional columns

| Field       | Description                     |
| ----------- | ------------------------------- |
| Custom Note | Free-text note for this section |

## Import behavior

- Rows are grouped by Plate ID into a plate → sections structure before
  being sent to `database.graviPlateAccessions.createWithSections`.
- A row with some but not all required cells filled is flagged as a
  validation error and blocks the whole import — it is not silently
  dropped.
- A sheet with zero data rows is rejected before any import is attempted.
