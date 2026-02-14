/**
 * Unit Tests: Session Store
 *
 * Tests the in-memory session store for persisting metadata
 * across page navigation within a scanning session.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSessionState,
  setSessionState,
  resetSessionState,
  type SessionState,
} from '../../src/main/session-store';

describe('SessionStore', () => {
  beforeEach(() => {
    // Reset state before each test
    resetSessionState();
  });

  describe('Initial State', () => {
    it('should return null for all fields initially', () => {
      const state = getSessionState();

      expect(state.phenotyperId).toBeNull();
      expect(state.experimentId).toBeNull();
      expect(state.waveNumber).toBeNull();
      expect(state.plantAgeDays).toBeNull();
      expect(state.accessionName).toBeNull();
    });
  });

  describe('setSessionState', () => {
    it('should update phenotyperId', () => {
      setSessionState({ phenotyperId: 'phenotyper-uuid-123' });

      const state = getSessionState();
      expect(state.phenotyperId).toBe('phenotyper-uuid-123');
      // Other fields should remain null
      expect(state.experimentId).toBeNull();
    });

    it('should update experimentId', () => {
      setSessionState({ experimentId: 'experiment-uuid-456' });

      const state = getSessionState();
      expect(state.experimentId).toBe('experiment-uuid-456');
    });

    it('should update waveNumber', () => {
      setSessionState({ waveNumber: 3 });

      const state = getSessionState();
      expect(state.waveNumber).toBe(3);
    });

    it('should update plantAgeDays', () => {
      setSessionState({ plantAgeDays: 14 });

      const state = getSessionState();
      expect(state.plantAgeDays).toBe(14);
    });

    it('should update accessionName', () => {
      setSessionState({ accessionName: 'Col-0' });

      const state = getSessionState();
      expect(state.accessionName).toBe('Col-0');
    });

    it('should update multiple fields at once', () => {
      setSessionState({
        phenotyperId: 'pheno-1',
        experimentId: 'exp-1',
        waveNumber: 2,
        plantAgeDays: 21,
        accessionName: 'Ler-0',
      });

      const state = getSessionState();
      expect(state.phenotyperId).toBe('pheno-1');
      expect(state.experimentId).toBe('exp-1');
      expect(state.waveNumber).toBe(2);
      expect(state.plantAgeDays).toBe(21);
      expect(state.accessionName).toBe('Ler-0');
    });

    it('should preserve existing fields when updating others', () => {
      setSessionState({ phenotyperId: 'pheno-1', waveNumber: 1 });
      setSessionState({ experimentId: 'exp-1' });

      const state = getSessionState();
      expect(state.phenotyperId).toBe('pheno-1');
      expect(state.experimentId).toBe('exp-1');
      expect(state.waveNumber).toBe(1);
    });

    it('should allow setting fields to null', () => {
      setSessionState({ phenotyperId: 'pheno-1', accessionName: 'Col-0' });
      setSessionState({ accessionName: null });

      const state = getSessionState();
      expect(state.phenotyperId).toBe('pheno-1');
      expect(state.accessionName).toBeNull();
    });
  });

  describe('resetSessionState', () => {
    it('should reset all fields to null', () => {
      // Set some values first
      setSessionState({
        phenotyperId: 'pheno-1',
        experimentId: 'exp-1',
        waveNumber: 2,
        plantAgeDays: 14,
        accessionName: 'Col-0',
      });

      // Reset
      resetSessionState();

      // Verify all are null
      const state = getSessionState();
      expect(state.phenotyperId).toBeNull();
      expect(state.experimentId).toBeNull();
      expect(state.waveNumber).toBeNull();
      expect(state.plantAgeDays).toBeNull();
      expect(state.accessionName).toBeNull();
    });
  });

  describe('Value Persistence', () => {
    it('should persist values across multiple getSessionState calls', () => {
      setSessionState({ phenotyperId: 'persistent-pheno' });

      // Multiple reads should return same value
      expect(getSessionState().phenotyperId).toBe('persistent-pheno');
      expect(getSessionState().phenotyperId).toBe('persistent-pheno');
      expect(getSessionState().phenotyperId).toBe('persistent-pheno');
    });

    it('should not share state between tests due to beforeEach reset', () => {
      // This test verifies isolation - state from previous test should not leak
      const state = getSessionState();
      expect(state.phenotyperId).toBeNull();
    });
  });

  describe('Type Safety', () => {
    it('should return a complete SessionState object', () => {
      const state = getSessionState();

      // Type guard - verify all expected properties exist
      const expectedKeys: (keyof SessionState)[] = [
        'phenotyperId',
        'experimentId',
        'waveNumber',
        'plantAgeDays',
        'accessionName',
      ];

      for (const key of expectedKeys) {
        expect(key in state).toBe(true);
      }
    });
  });
});
