/**
 * Tests for the partial-row check in GraviMetadataUpload.
 *
 * Fully-empty trailing rows are normal Excel padding and must be skipped
 * silently. Rows with *some* required cells filled and others empty are
 * almost always user typos — the upload surfaces them as a validation error
 * with their Excel row numbers instead of dropping them.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import * as XLSX from 'xlsx';
import { GraviMetadataUpload } from '../../../src/renderer/components/GraviMetadataUpload';

const mockCreateWithSections = vi.fn();

beforeAll(() => {
  Object.defineProperty(window, 'electron', {
    value: {
      database: {
        graviPlateAccessions: {
          createWithSections: mockCreateWithSections,
        },
      },
    },
    writable: true,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateWithSections.mockResolvedValue({
    success: true,
    data: { id: 'test-id' },
  });
});

const HEADERS = [
  'plate_id',
  'plate_section_id',
  'plant_qr',
  'accession',
  'medium',
  'transplant_date',
];

function buildExcelFile(data: string[][]): File {
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buffer], 'metadata.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function uploadAndMap(file: File) {
  const user = userEvent.setup();
  render(<GraviMetadataUpload onUploadComplete={vi.fn()} />);

  await user.upload(screen.getByTestId('file-input'), file);

  await waitFor(() => {
    expect(screen.getByTestId('mapping-plateId')).toBeInTheDocument();
  });

  await user.selectOptions(screen.getByTestId('mapping-plateId'), 'plate_id');
  await user.selectOptions(
    screen.getByTestId('mapping-sectionId'),
    'plate_section_id'
  );
  await user.selectOptions(screen.getByTestId('mapping-plantQr'), 'plant_qr');
  await user.selectOptions(
    screen.getByTestId('mapping-accession'),
    'accession'
  );
  await user.selectOptions(screen.getByTestId('mapping-medium'), 'medium');
  await user.selectOptions(
    screen.getByTestId('mapping-transplantDate'),
    'transplant_date'
  );

  await waitFor(() => {
    expect(screen.getByTestId('upload-button')).not.toBeDisabled();
  });

  await user.click(screen.getByTestId('upload-button'));
  return user;
}

describe('GraviMetadataUpload — partial row check', () => {
  it('uploads cleanly when every row is fully filled and a trailing blank row pads the sheet', async () => {
    const file = buildExcelFile([
      HEADERS,
      ['P001', 'S1', 'QR-1', 'Ara-1', 'MS', '2025-06-15'],
      ['P002', 'S1', 'QR-2', 'Ara-1', 'MS', '2025-06-15'],
      ['', '', '', '', '', ''], // trailing Excel padding — should be skipped silently
    ]);

    await uploadAndMap(file);

    await waitFor(() => {
      expect(mockCreateWithSections).toHaveBeenCalledTimes(1);
    });
    // Only the two real rows should reach the DB call — the blank trailing row is dropped silently
    const [, plates] = mockCreateWithSections.mock.calls[0];
    expect(plates).toHaveLength(2);
  });

  it('flags a partial row with its Excel row number and blocks the upload', async () => {
    const file = buildExcelFile([
      HEADERS,
      ['P001', 'S1', 'QR-1', 'Ara-1', 'MS', '2025-06-15'], // row 2 — complete
      ['P002', 'S1', '', 'Ara-1', 'MS', '2025-06-15'], // row 3 — missing plant_qr
      ['P003', 'S1', 'QR-3', 'Ara-1', 'MS', '2025-06-15'], // row 4 — complete
    ]);

    await uploadAndMap(file);

    await waitFor(() => {
      expect(screen.getByText(/Row\(s\)\s*3/)).toBeInTheDocument();
    });
    expect(screen.getByText(/some required cells filled/i)).toBeInTheDocument();
    expect(mockCreateWithSections).not.toHaveBeenCalled();
  });

  it('flags multiple partial rows with all their Excel row numbers', async () => {
    const file = buildExcelFile([
      HEADERS,
      ['P001', 'S1', 'QR-1', 'Ara-1', 'MS', '2025-06-15'], // row 2 — complete
      ['P002', '', 'QR-2', 'Ara-1', 'MS', '2025-06-15'], // row 3 — missing section
      ['P003', 'S1', 'QR-3', '', 'MS', '2025-06-15'], // row 4 — missing accession
      ['P004', 'S1', 'QR-4', 'Ara-1', 'MS', ''], // row 5 — missing date
    ]);

    await uploadAndMap(file);

    await waitFor(() => {
      expect(screen.getByText(/Row\(s\)\s*3,\s*4,\s*5/)).toBeInTheDocument();
    });
    expect(mockCreateWithSections).not.toHaveBeenCalled();
  });

  it('flags a row with only customNote filled (not silently dropped)', async () => {
    const file = buildExcelFile([
      [...HEADERS, 'custom_note'],
      ['P001', 'S1', 'QR-1', 'Ara-1', 'MS', '2025-06-15', 'ok'], // row 2 — complete
      ['', '', '', '', '', '', 'forgotten note'], // row 3 — only note set
    ]);

    const user = userEvent.setup();
    render(<GraviMetadataUpload onUploadComplete={vi.fn()} />);

    await user.upload(screen.getByTestId('file-input'), file);
    await waitFor(() => {
      expect(screen.getByTestId('mapping-plateId')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('mapping-plateId'), 'plate_id');
    await user.selectOptions(
      screen.getByTestId('mapping-sectionId'),
      'plate_section_id'
    );
    await user.selectOptions(screen.getByTestId('mapping-plantQr'), 'plant_qr');
    await user.selectOptions(
      screen.getByTestId('mapping-accession'),
      'accession'
    );
    await user.selectOptions(screen.getByTestId('mapping-medium'), 'medium');
    await user.selectOptions(
      screen.getByTestId('mapping-transplantDate'),
      'transplant_date'
    );
    await user.selectOptions(
      screen.getByTestId('mapping-customNote'),
      'custom_note'
    );

    await user.click(screen.getByTestId('upload-button'));

    await waitFor(() => {
      expect(screen.getByText(/Row\(s\)\s*3/)).toBeInTheDocument();
    });
    expect(mockCreateWithSections).not.toHaveBeenCalled();
  });
});
