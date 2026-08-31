/**
 * Unit tests: CylinderScanWorkflowGuide (Tier 4, #175)
 *
 * A new, CylinderScan-only component implementing the Daily-Workflow/Setup
 * restructure — NOT a change to the shared WorkflowSteps.tsx component,
 * which continues to render GraviScan's flat numbered list unchanged (see
 * design.md's "Deferred Scope").
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { CylinderScanWorkflowGuide } from '../../../src/renderer/components/CylinderScanWorkflowGuide';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderGuide() {
  return render(
    <MemoryRouter>
      <CylinderScanWorkflowGuide />
    </MemoryRouter>
  );
}

describe('CylinderScanWorkflowGuide structure', () => {
  it('renders a Daily Workflow section before a Setup section', () => {
    renderGuide();

    const dailyHeading = screen.getByText('Daily Workflow');
    const setupHeading = screen.getByText('Setup');

    expect(
      dailyHeading.compareDocumentPosition(setupHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('Daily Workflow contains Camera Settings, Capture Scan (primary), Browse Scans, in order, with no step-number badge', () => {
    renderGuide();

    const cameraStep = screen.getByTestId('workflow-step-camera-settings');
    const captureStep = screen.getByTestId('workflow-step-capture-scan');
    const browseStep = screen.getByTestId('workflow-step-browse-scans');

    expect(cameraStep).toHaveTextContent('Camera Settings');
    expect(captureStep).toHaveTextContent('Capture Scan');
    expect(browseStep).toHaveTextContent('Browse Scans');

    // Order: camera -> capture -> browse
    expect(
      cameraStep.compareDocumentPosition(captureStep) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      captureStep.compareDocumentPosition(browseStep) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // No numeric step badge anywhere
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('Setup contains Scientists, Phenotypers, Accessions, Experiments as unordered cards with no step-number badge', () => {
    renderGuide();

    ['scientists', 'phenotypers', 'accessions', 'experiments'].forEach((id) => {
      expect(screen.getByTestId(`workflow-step-${id}`)).toBeInTheDocument();
    });
  });

  it('uses workflow-step-${id} slug testids and navigates to the correct route on click', () => {
    renderGuide();

    fireEvent.click(screen.getByTestId('workflow-step-scientists'));
    expect(mockNavigate).toHaveBeenCalledWith('/scientists');

    fireEvent.click(screen.getByTestId('workflow-step-capture-scan'));
    expect(mockNavigate).toHaveBeenCalledWith('/capture-scan');
  });

  it('renders every route from cylinderScanSteps unchanged', () => {
    renderGuide();

    const routes: Record<string, string> = {
      'camera-settings': '/camera-settings',
      'capture-scan': '/capture-scan',
      'browse-scans': '/browse-scans',
      scientists: '/scientists',
      phenotypers: '/phenotypers',
      accessions: '/accessions',
      experiments: '/experiments',
    };

    Object.entries(routes).forEach(([id, route]) => {
      fireEvent.click(screen.getByTestId(`workflow-step-${id}`));
      expect(mockNavigate).toHaveBeenCalledWith(route);
    });
  });
});

describe('CylinderScanWorkflowGuide color palette (native lime, not a recolor)', () => {
  it('uses bg-lime-700 on the Daily Workflow primary card (Capture Scan)', () => {
    renderGuide();

    const captureStep = screen.getByTestId('workflow-step-capture-scan');
    expect(captureStep.className).toContain('bg-lime-700');
  });

  it('uses hover:bg-lime-50 card hover on non-primary cards', () => {
    renderGuide();

    const scientistsStep = screen.getByTestId('workflow-step-scientists');
    expect(scientistsStep.className).toContain('hover:bg-lime-50');
  });
});
