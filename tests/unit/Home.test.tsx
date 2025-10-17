import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Home } from '../../src/renderer/Home';

describe('Home Component', () => {
  it('renders the main title', () => {
    render(
      <BrowserRouter>
        <Home />
      </BrowserRouter>
    );

    expect(screen.getByText('Bloom Desktop')).toBeInTheDocument();
  });

  it('renders the description', () => {
    render(
      <BrowserRouter>
        <Home />
      </BrowserRouter>
    );

    expect(
      screen.getByText(/Electron-React application for cylinder scanning/i)
    ).toBeInTheDocument();
  });

  it('renders the under construction section', () => {
    render(
      <BrowserRouter>
        <Home />
      </BrowserRouter>
    );

    expect(screen.getByText('Under Construction')).toBeInTheDocument();
    expect(
      screen.getByText(/This application is being migrated/i)
    ).toBeInTheDocument();
  });

  it('renders the architecture section', () => {
    render(
      <BrowserRouter>
        <Home />
      </BrowserRouter>
    );

    expect(screen.getByText('Architecture')).toBeInTheDocument();
    expect(
      screen.getByText(/Frontend: Electron \+ React/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Backend: Python/i)).toBeInTheDocument();
  });

  it('renders the status section', () => {
    render(
      <BrowserRouter>
        <Home />
      </BrowserRouter>
    );

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('[OK] Application shell')).toBeInTheDocument();
    expect(screen.getByText('[OK] Navigation')).toBeInTheDocument();
    expect(screen.getByText('[TODO] Hardware integration')).toBeInTheDocument();
  });
});
