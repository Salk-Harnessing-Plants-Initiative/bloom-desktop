# UI Management Pages - Accession-Experiment Relationships

## Changes

This change adds visual indicators to show which experiments have accessions attached, improving UX and matching pilot functionality.

### ExperimentChooser Component Updates

**Affected Component:** `src/renderer/components/ExperimentChooser.tsx`

#### Updated Interface

```typescript
interface Accession {
  id: string;
  name: string;
}

interface Experiment {
  id: string;
  name: string;
  species: string;
  accession?: Accession | null; // Added
}
```

#### Visual Indicator

- Experiments with accessions display: `✓ {experiment.name}`
- Experiments without accessions display: `{experiment.name}`
- Checkmark provides immediate visual feedback in dropdown

### Accessions Page Updates

**Affected Component:** `src/renderer/components/AccessionList.tsx`

#### Updated Interface

```typescript
interface Experiment {
  name: string;
}

interface Accession {
  id: string;
  name: string;
  createdAt: Date | string;
  experiments?: Experiment[]; // Added
}
```

#### Linked Experiments Section

When an accession is expanded, displays:

```
Linked Experiments:
• Experiment Name 1
• Experiment Name 2
```

Or if no experiments are linked:

```
Linked Experiments:
No experiments linked
```

**Styling:**

- White background (`bg-white`)
- Border with rounded corners (`border rounded`)
- Padding (`p-2`)
- Bold header (`font-semibold`)
- Bulleted list for experiment names
- Italic gray text for empty state (`italic text-gray-400`)

### Database Handler Updates

**Affected File:** `src/main/database-handlers.ts`

#### Updated Query

```typescript
ipcMain.handle('db:accessions:list', async (): Promise<DatabaseResponse> => {
  const accessions = await db.accessions.findMany({
    include: {
      experiments: {
        select: {
          name: true, // Only fetch experiment name
        },
      },
    },
    orderBy: { name: 'asc' },
  });
  return { success: true, data: accessions };
});
```

## Pilot Parity

This implementation matches the bloom-desktop-pilot's pattern exactly:

- Same expandable section structure
- Same visual styling (white box, borders, padding)
- Same bulleted list format for linked experiments
- Same empty state messaging

## Rationale

Users need to see which experiments have accessions to understand:

- When barcode validation will be available
- Which accessions are actively being used
- Which accessions are orphaned (not linked to any experiment)

This bidirectional relationship display improves discoverability and data management.
