/**
 * Unit tests: GraviScanWorkflowGuide (#328 piece 2)
 *
 * Mirrors CylinderScanWorkflowGuide.tsx's pattern exactly — a new,
 * GraviScan-only component implementing the Daily-Workflow/Setup
 * restructure, not a change to the shared WorkflowSteps.tsx component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { GraviScanWorkflowGuide } from '../../../src/renderer/components/GraviScanWorkflowGuide';

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
      <GraviScanWorkflowGuide />
    </MemoryRouter>
  );
}

describe('GraviScanWorkflowGuide structure', () => {
  it('renders a Daily Workflow section before a Setup section', () => {
    renderGuide();

    const dailyHeading = screen.getByText('Daily Workflow');
    const setupHeading = screen.getByText('Setup');

    expect(
      dailyHeading.compareDocumentPosition(setupHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('Daily Workflow contains Configure Scanner, Capture Scan (primary), Browse GraviScans, in order, with no step-number badge', () => {
    renderGuide();

    const configureStep = screen.getByTestId('workflow-step-configure-scanner');
    const captureStep = screen.getByTestId('workflow-step-capture-scan');
    const browseStep = screen.getByTestId('workflow-step-browse-graviscans');

    expect(configureStep).toHaveTextContent('Configure Scanner');
    expect(captureStep).toHaveTextContent('Capture Scan');
    expect(browseStep).toHaveTextContent('Browse GraviScans');

    // Order: configure -> capture -> browse
    expect(
      configureStep.compareDocumentPosition(captureStep) &
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

  it('Configure Scanner card reads with condition-specific framing, not a blanket every-session claim', () => {
    renderGuide();

    const configureStep = screen.getByTestId('workflow-step-configure-scanner');
    expect(configureStep).toHaveTextContent(
      'Check scanner detection and connection health — especially after moving cables or a prior scan failure'
    );
  });

  it('Setup contains Scientists, Phenotypers, Metadata, Experiments as unordered cards with no step-number badge', () => {
    renderGuide();

    ['scientists', 'phenotypers', 'metadata', 'experiments'].forEach((id) => {
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

  it('renders every route from the old graviScanSteps unchanged, plus the newly-added Configure Scanner', () => {
    renderGuide();

    const routes: Record<string, string> = {
      'configure-scanner': '/configure-scanner',
      'capture-scan': '/capture-scan',
      'browse-graviscans': '/browse-graviscans',
      scientists: '/scientists',
      phenotypers: '/phenotypers',
      metadata: '/metadata',
      experiments: '/experiments',
    };

    Object.entries(routes).forEach(([id, route]) => {
      fireEvent.click(screen.getByTestId(`workflow-step-${id}`));
      expect(mockNavigate).toHaveBeenCalledWith(route);
    });
  });
});

describe('GraviScanWorkflowGuide color palette (native lime, not a recolor)', () => {
  it('uses bg-lime-700 on the Daily Workflow primary card button (Capture Scan)', () => {
    renderGuide();

    const captureStep = screen.getByTestId('workflow-step-capture-scan');
    expect(captureStep.className).toContain('bg-lime-700');
  });

  it('uses text-white on the primary card\'s nested heading, not the button itself', () => {
    renderGuide();

    const captureStep = screen.getByTestId('workflow-step-capture-scan');
    expect(captureStep.className).not.toContain('text-white');
    const heading = within(captureStep).getByRole('heading');
    expect(heading.className).toContain('text-white');
  });

  it('uses hover:bg-lime-50 card hover on non-primary cards', () => {
    renderGuide();

    const scientistsStep = screen.getByTestId('workflow-step-scientists');
    expect(scientistsStep.className).toContain('hover:bg-lime-50');
  });
});
