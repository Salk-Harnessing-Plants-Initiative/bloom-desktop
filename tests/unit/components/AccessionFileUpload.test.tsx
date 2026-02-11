/**
 * Unit Tests: AccessionFileUpload Component
 *
 * Tests the Excel file upload component's state management, validation,
 * and rendering logic in isolation from the Electron environment.
 *
 * Uses Vitest with React Testing Library and mocked IPC calls.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import * as XLSX from 'xlsx';
import { AccessionFileUpload } from '../../../src/renderer/components/AccessionFileUpload';

// Mock the electron API
const mockCreateWithMappings = vi.fn();

beforeAll(() => {
  // Mock window.electron for all tests
  Object.defineProperty(window, 'electron', {
    value: {
      database: {
        accessions: {
          createWithMappings: mockCreateWithMappings,
        },
      },
    },
    writable: true,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mockCreateWithMappings.mockResolvedValue({
    success: true,
    data: { id: 'test-id', name: 'test.xlsx', mappingCount: 5 },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper to create a mock Excel file
function createMockExcelFile(
  name: string,
  data: string[][],
  sheetName = 'Sheet1'
): File {
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Helper to create multi-sheet Excel file
function createMultiSheetExcelFile(
  name: string,
  sheets: { name: string; data: string[][] }[]
): File {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name: sheetName, data }) => {
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('AccessionFileUpload', () => {
  describe('Initial Render', () => {
    it('should render upload zone', () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      expect(screen.getByTestId('excel-upload-zone')).toBeInTheDocument();
    });

    it('should show upload instructions', () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      // Component shows "Drag and drop or click to select"
      expect(screen.getByText(/Drag and drop/i)).toBeInTheDocument();
    });

    it('should not show column selectors initially', () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      expect(screen.queryByTestId('plant-id-selector')).not.toBeInTheDocument();
      expect(screen.queryByTestId('accession-selector')).not.toBeInTheDocument();
    });

    it('should not show preview table initially', () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      expect(screen.queryByTestId('preview-table')).not.toBeInTheDocument();
    });
  });

  describe('File Upload', () => {
    it('should accept xlsx files', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('test.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      // Should show column selectors after file upload
      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });
    });

    it('should display file name after upload', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('my-plants.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText('my-plants.xlsx')).toBeInTheDocument();
      });
    });
  });

  describe('Sheet Selection', () => {
    it('should show sheet selector for multi-sheet files', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMultiSheetExcelFile('multi.xlsx', [
        {
          name: 'Sheet1',
          data: [
            ['A', 'B'],
            ['1', '2'],
          ],
        },
        {
          name: 'Sheet2',
          data: [
            ['C', 'D'],
            ['3', '4'],
          ],
        },
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('sheet-selector')).toBeInTheDocument();
      });
    });

    it('should not show sheet selector for single-sheet files', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('single.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('sheet-selector')).not.toBeInTheDocument();
    });

    it('should update columns when sheet changes', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMultiSheetExcelFile('multi.xlsx', [
        {
          name: 'Plants',
          data: [
            ['PlantID', 'Geno'],
            ['P1', 'G1'],
          ],
        },
        {
          name: 'Samples',
          data: [
            ['SampleCode', 'AccNo'],
            ['S1', 'A1'],
          ],
        },
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('sheet-selector')).toBeInTheDocument();
      });

      // First sheet columns should be visible in preview table header
      const previewTable = screen.getByTestId('preview-table');
      expect(previewTable).toHaveTextContent('PlantID');

      // Change sheet
      const sheetSelector = screen.getByTestId('sheet-selector');
      await userEvent.selectOptions(sheetSelector, 'Samples');

      // New columns should appear
      await waitFor(() => {
        expect(previewTable).toHaveTextContent('SampleCode');
      });
    });
  });

  describe('Column Mapping', () => {
    it('should populate dropdowns with column headers', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('test.xlsx', [
        ['PlantBarcode', 'GenotypeID', 'Notes'],
        ['P1', 'G1', 'N1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });

      const plantSelector = screen.getByTestId('plant-id-selector');
      const options = plantSelector.querySelectorAll('option');

      // Should have placeholder + 3 columns
      expect(options.length).toBeGreaterThanOrEqual(3);
    });

    it('should reset column selections when sheet changes', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMultiSheetExcelFile('multi.xlsx', [
        {
          name: 'Sheet1',
          data: [
            ['A', 'B'],
            ['1', '2'],
          ],
        },
        {
          name: 'Sheet2',
          data: [
            ['C', 'D'],
            ['3', '4'],
          ],
        },
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });

      // Select a column
      const plantSelector = screen.getByTestId('plant-id-selector');
      await userEvent.selectOptions(plantSelector, 'A');

      // Change sheet
      const sheetSelector = screen.getByTestId('sheet-selector');
      await userEvent.selectOptions(sheetSelector, 'Sheet2');

      // Column selection should be reset
      await waitFor(() => {
        const updatedSelector = screen.getByTestId('plant-id-selector');
        expect(updatedSelector).toHaveValue('');
      });
    });
  });

  describe('Upload Button State', () => {
    it('should disable upload button when no columns selected', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('test.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('upload-button')).toBeInTheDocument();
      });

      expect(screen.getByTestId('upload-button')).toBeDisabled();
    });

    it('should disable upload button when only one column selected', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('test.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });

      // Select only Plant ID
      const plantSelector = screen.getByTestId('plant-id-selector');
      await userEvent.selectOptions(plantSelector, 'Plant');

      expect(screen.getByTestId('upload-button')).toBeDisabled();
    });

    it('should enable upload button when both columns selected', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('test.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });

      // Select both columns
      await userEvent.selectOptions(
        screen.getByTestId('plant-id-selector'),
        'Plant'
      );
      await userEvent.selectOptions(
        screen.getByTestId('accession-selector'),
        'Genotype'
      );

      expect(screen.getByTestId('upload-button')).toBeEnabled();
    });
  });

  describe('Preview Table', () => {
    it('should display preview table after file upload', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('test.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
        ['P2', 'G2'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('preview-table')).toBeInTheDocument();
      });

      // Data should be visible
      expect(screen.getByText('P1')).toBeInTheDocument();
      expect(screen.getByText('G1')).toBeInTheDocument();
    });

    it('should limit preview to 20 rows', async () => {
      const data: string[][] = [['Plant', 'Genotype']];
      for (let i = 1; i <= 30; i++) {
        data.push([`P${i}`, `G${i}`]);
      }

      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('large.xlsx', data);
      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('preview-table')).toBeInTheDocument();
      });

      // First rows should be visible
      expect(screen.getByText('P1')).toBeInTheDocument();

      // Row 25 should NOT be visible (preview limited to 20)
      expect(screen.queryByText('P25')).not.toBeInTheDocument();
    });
  });

  describe('Upload Submission', () => {
    it('should call createWithMappings on upload', async () => {
      const onUploadComplete = vi.fn();
      render(<AccessionFileUpload onUploadComplete={onUploadComplete} />);

      const file = createMockExcelFile('test.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
        ['P2', 'G2'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });

      // Select columns
      await userEvent.selectOptions(
        screen.getByTestId('plant-id-selector'),
        'Plant'
      );
      await userEvent.selectOptions(
        screen.getByTestId('accession-selector'),
        'Genotype'
      );

      // Click upload
      await userEvent.click(screen.getByTestId('upload-button'));

      await waitFor(() => {
        expect(mockCreateWithMappings).toHaveBeenCalled();
      });

      // Should pass correct data
      const [accessionData, mappings] = mockCreateWithMappings.mock.calls[0];
      expect(accessionData.name).toBe('test.xlsx');
      expect(mappings.length).toBe(2);
      expect(mappings[0].plant_barcode).toBe('P1');
      expect(mappings[0].accession_name).toBe('G1');
    });

    // Skip: Testing setTimeout behavior requires fake timers which conflict with async file operations
    it.skip('should call onUploadComplete after successful upload', async () => {
      // This is tested in E2E tests which can handle the real delay
    });

    it('should show success message after upload', async () => {
      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('test.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });

      await userEvent.selectOptions(
        screen.getByTestId('plant-id-selector'),
        'Plant'
      );
      await userEvent.selectOptions(
        screen.getByTestId('accession-selector'),
        'Genotype'
      );

      await userEvent.click(screen.getByTestId('upload-button'));

      await waitFor(() => {
        expect(screen.getByText(/done|success/i)).toBeInTheDocument();
      });
    });

    // Skip: Testing setTimeout behavior requires fake timers which conflict with async file operations
    it.skip('should reset form after successful upload', async () => {
      // This is tested in E2E tests which can handle the real delay
    });
  });

  describe('Error Handling', () => {
    it('should show error message on upload failure', async () => {
      mockCreateWithMappings.mockResolvedValueOnce({
        success: false,
        error: 'Database error',
      });

      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('test.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });

      await userEvent.selectOptions(
        screen.getByTestId('plant-id-selector'),
        'Plant'
      );
      await userEvent.selectOptions(
        screen.getByTestId('accession-selector'),
        'Genotype'
      );

      await userEvent.click(screen.getByTestId('upload-button'));

      await waitFor(() => {
        expect(screen.getByText(/error|failed/i)).toBeInTheDocument();
      });
    });

    it('should preserve form state on error', async () => {
      mockCreateWithMappings.mockResolvedValueOnce({
        success: false,
        error: 'Database error',
      });

      render(<AccessionFileUpload onUploadComplete={vi.fn()} />);

      const file = createMockExcelFile('test.xlsx', [
        ['Plant', 'Genotype'],
        ['P1', 'G1'],
      ]);

      const input = screen.getByTestId('file-input');
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      });

      await userEvent.selectOptions(
        screen.getByTestId('plant-id-selector'),
        'Plant'
      );
      await userEvent.selectOptions(
        screen.getByTestId('accession-selector'),
        'Genotype'
      );

      await userEvent.click(screen.getByTestId('upload-button'));

      await waitFor(() => {
        expect(screen.getByText(/error|failed/i)).toBeInTheDocument();
      });

      // Form should still be visible for retry
      expect(screen.getByTestId('plant-id-selector')).toBeInTheDocument();
      expect(screen.getByTestId('preview-table')).toBeInTheDocument();
    });
  });
});
