/**
 * The Experiments page's species list: it comes from Bloom, its last option opens
 * Bloom's Species page, and Refresh list fetches it again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { ExperimentForm } from '../../../src/renderer/components/ExperimentForm';
import { ADD_IN_BLOOM } from '../../../src/renderer/components/SpeciesSelect';

let list: ReturnType<typeof vi.fn>;
let refresh: ReturnType<typeof vi.fn>;
let openAddPage: ReturnType<typeof vi.fn>;
const create = vi.fn();

beforeEach(() => {
  list = vi.fn().mockResolvedValue({
    species: ['Arabidopsis', 'Rice', 'Sorghum'],
    source: 'bloom',
    updatedAt: '2026-10-24T10:00:00.000Z',
  });
  refresh = vi.fn();
  openAddPage = vi.fn().mockResolvedValue({ success: true });
  create
    .mockReset()
    .mockResolvedValue({ success: true, data: { id: 'exp-1' } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron.species = { list, refresh, openAddPage };
  win.electron.database.experiments = { create, linkGraviMetadata: vi.fn() };
});

function mount() {
  return render(
    <ExperimentForm
      scientists={[
        { id: 'sci-1', name: 'Dr. Jane Smith', email: 'jane@example.com' },
      ]}
      accessions={[{ id: 'acc-1', name: 'Accession File A' }]}
      onSuccess={vi.fn()}
    />
  );
}

const select = () => screen.getByLabelText('Species') as HTMLSelectElement;
const options = () => Array.from(select().options).map((o) => o.textContent);

describe('SpeciesSelect', () => {
  it("lists Bloom's species, then the option to add one in Bloom, and picks the first", async () => {
    mount();
    await waitFor(() => expect(select().value).toBe('Arabidopsis'));
    expect(options()).toEqual([
      'Arabidopsis',
      'Rice',
      'Sorghum',
      'Need a new species? Add it in Bloom…',
    ]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("opens Bloom's Species page from the last option, keeping the species chosen before", async () => {
    mount();
    await waitFor(() => expect(select().value).toBe('Arabidopsis'));
    fireEvent.change(select(), { target: { value: 'Rice' } });
    fireEvent.change(select(), { target: { value: ADD_IN_BLOOM } });

    expect(openAddPage).toHaveBeenCalledTimes(1);
    expect(select().value).toBe('Rice');
    expect(
      await screen.findByText(
        "Bloom's Species page is open in your browser. Add the species there, then click Refresh list."
      )
    ).toBeInTheDocument();
  });

  it('says so when Bloom cannot be opened', async () => {
    openAddPage.mockResolvedValue({
      success: false,
      error: "Bloom's address isn't set up on this computer.",
    });
    mount();
    await waitFor(() => expect(select().value).toBe('Arabidopsis'));
    fireEvent.change(select(), { target: { value: ADD_IN_BLOOM } });
    expect(
      await screen.findByText(
        "Couldn't open Bloom: Bloom's address isn't set up on this computer."
      )
    ).toBeInTheDocument();
  });

  it('fetches the list again on Refresh list, with a newly added species', async () => {
    refresh.mockResolvedValue({
      list: {
        species: ['Arabidopsis', 'Pennycress', 'Rice', 'Sorghum'],
        source: 'bloom',
        updatedAt: 'now',
      },
    });
    mount();
    await waitFor(() => expect(select().value).toBe('Arabidopsis'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(options()).toContain('Pennycress');
    expect(
      screen.getByText('Updated from Bloom: 4 species.')
    ).toBeInTheDocument();
  });

  it("keeps the list it had and says why when Bloom can't be reached", async () => {
    refresh.mockResolvedValue({
      list: {
        species: ['Arabidopsis', 'Rice', 'Sorghum'],
        source: 'saved',
        updatedAt: 'then',
      },
      error: 'getaddrinfo ENOTFOUND',
    });
    mount();
    await waitFor(() => expect(select().value).toBe('Arabidopsis'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
    });
    expect(
      screen.getByText(
        "Couldn't reach Bloom, so the list may be out of date. (getaddrinfo ENOTFOUND)"
      )
    ).toBeInTheDocument();
    expect(options()).toHaveLength(4);
  });

  it("says when it's showing the built-in list, before Bloom has been reached", async () => {
    list.mockResolvedValue({
      species: ['Alfalfa', 'Rice'],
      source: 'built-in',
      updatedAt: null,
    });
    mount();
    expect(await screen.findByTestId('species-built-in')).toHaveTextContent(
      "Couldn't get the list from Bloom yet, so the built-in list is shown."
    );
  });

  it('creates the experiment with the species chosen from the list', async () => {
    mount();
    await waitFor(() => expect(select().value).toBe('Arabidopsis'));
    fireEvent.change(select(), { target: { value: 'Sorghum' } });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Sorghum_GWAS' },
    });
    fireEvent.change(screen.getByLabelText('Scientist'), {
      target: { value: 'sci-1' },
    });
    fireEvent.change(screen.getByLabelText('Accession File'), {
      target: { value: 'acc-1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create/i }));
    });
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      name: 'Sorghum_GWAS',
      species: 'Sorghum',
    });
  });
});
