import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../../src/renderer/App';

describe('App Component', () => {
  it('renders the application without crashing', () => {
    render(<App />);
    // App should render the Layout which contains sidebar
    expect(screen.getByText('Cylinder Scanner')).toBeInTheDocument();
  });

  it('renders the Layout component with sidebar', () => {
    render(<App />);
    // Check that the sidebar is present (from Layout)
    expect(screen.getByText('Cylinder Scanner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toBeInTheDocument();
  });

  it('renders the Home page at the root route', () => {
    render(<App />);
    // Home component should be rendered at index route
    expect(
      screen.getByText(/Electron-React application for cylinder scanning/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Under Construction')).toBeInTheDocument();
  });

  it('sets up routing correctly', () => {
    const { container } = render(<App />);
    // Verify the app structure with both Layout and Home rendered
    expect(container.querySelector('.flex.h-screen')).toBeTruthy();
    expect(screen.getByText('Architecture')).toBeInTheDocument();
  });
});
