import { describe, it, expect } from 'vitest';
import {
  cylinderScanSteps,
  graviScanSteps,
} from '../../../src/renderer/components/WorkflowSteps';

describe('WorkflowSteps data', () => {
  it("graviScanSteps' Metadata step routes to /metadata, not /experiments", () => {
    const metadataStep = graviScanSteps.find((s) => s.title === 'Metadata');
    expect(metadataStep?.route).toBe('/metadata');
  });

  it("graviScanSteps' Browse Scans step routes to /browse-graviscans, not /browse-scans", () => {
    const browseStep = graviScanSteps.find((s) => s.title === 'Browse Scans');
    expect(browseStep?.route).toBe('/browse-graviscans');
  });

  it('cylinderScanSteps is unchanged', () => {
    const browseStep = cylinderScanSteps.find(
      (s) => s.title === 'Browse Scans'
    );
    expect(browseStep?.route).toBe('/browse-scans');
    const experimentsStep = cylinderScanSteps.find(
      (s) => s.title === 'Experiments'
    );
    expect(experimentsStep?.route).toBe('/experiments');
  });
});
