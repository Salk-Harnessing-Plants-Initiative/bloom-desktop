/**
 * Session Store
 *
 * In-memory storage for session state that persists across page navigation
 * within a scanning session. State resets when the app restarts.
 *
 * Fields that persist:
 * - phenotyperId: Selected phenotyper UUID
 * - experimentId: Selected experiment UUID
 * - waveNumber: Current wave number
 * - plantAgeDays: Plant age in days
 * - accessionName: Accession name (auto-populated from barcode lookup)
 *
 * Fields that do NOT persist (change per scan):
 * - plantQrCode: Unique per plant, managed in component state
 */

/**
 * Session state interface - all fields are nullable
 * (null means not set / cleared)
 */
export interface SessionState {
  phenotyperId: string | null;
  experimentId: string | null;
  waveNumber: number | null;
  plantAgeDays: number | null;
  accessionName: string | null;
}

/**
 * Default/initial session state - all null
 */
const initialState: SessionState = {
  phenotyperId: null,
  experimentId: null,
  waveNumber: null,
  plantAgeDays: null,
  accessionName: null,
};

/**
 * In-memory session state
 * Private - accessed only through exported functions
 */
let sessionState: SessionState = { ...initialState };

/**
 * Get current session state
 *
 * Returns a copy of the current state to prevent external mutation.
 */
export function getSessionState(): SessionState {
  return { ...sessionState };
}

/**
 * Update session state
 *
 * Merges provided fields with existing state. Only specified fields
 * are updated; others remain unchanged.
 *
 * @param updates - Partial session state to merge
 */
export function setSessionState(updates: Partial<SessionState>): void {
  sessionState = {
    ...sessionState,
    ...updates,
  };
}

/**
 * Reset session state to initial values
 *
 * All fields are set to null. Called on app restart or when
 * user explicitly clears session.
 */
export function resetSessionState(): void {
  sessionState = { ...initialState };
}
