import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from '../../src/renderer/Layout';

describe('Layout Component', () => {
  it('renders the app title in sidebar', () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByText('Bloom Desktop')).toBeInTheDocument();
    expect(screen.getByText('Cylinder Scanner')).toBeInTheDocument();
  });

  it('renders the Home navigation link', () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    );

    const homeLink = screen.getByRole('link', { name: /home/i });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('renders the outlet for child routes', () => {
    const { container } = render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    );

    // The Outlet component should be rendered (as a div in the main content area)
    const mainContent = container.querySelector('.flex-1.overflow-auto');
    expect(mainContent).toBeInTheDocument();
  });
});
