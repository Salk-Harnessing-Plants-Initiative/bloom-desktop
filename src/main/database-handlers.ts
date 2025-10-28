/**
 * Database IPC Handlers
 *
 * Provides IPC handlers for database operations, exposing CRUD operations
 * for all models to the renderer process.
 */

import { ipcMain } from 'electron';
import { getDatabase } from './database';
import type { Prisma } from '@prisma/client';

/**
 * Standard response format for database operations
 */
interface DatabaseResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Register all database IPC handlers
 *
 * Handlers follow naming convention: db:{model}:{action}
 * All handlers return DatabaseResponse for consistent error handling
 */
export function registerDatabaseHandlers() {
  const db = getDatabase();

  // ============================================
  // Experiments
  // ============================================

  ipcMain.handle('db:experiments:list', async (): Promise<DatabaseResponse> => {
    try {
      const experiments = await db.experiment.findMany({
        include: {
          scientist: true,
          accession: true,
        },
        orderBy: { name: 'asc' },
      });
      return { success: true, data: experiments };
    } catch (error) {
      console.error('[DB] Failed to list experiments:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:experiments:create',
    async (
      _event,
      data: Prisma.ExperimentCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.create({ data });
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to create experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:experiments:get',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.findUnique({
          where: { id },
          include: {
            scientist: true,
            accession: true,
            scans: {
              orderBy: { capture_date: 'desc' },
              take: 10, // Limit to recent 10 scans
            },
          },
        });
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to get experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:experiments:update',
    async (
      _event,
      id: string,
      data: Prisma.ExperimentUpdateInput
    ): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.update({
          where: { id },
          data,
        });
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to update experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:experiments:delete',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        await db.experiment.delete({ where: { id } });
        return { success: true };
      } catch (error) {
        console.error('[DB] Failed to delete experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Phenotypers
  // ============================================

  ipcMain.handle('db:phenotypers:list', async (): Promise<DatabaseResponse> => {
    try {
      const phenotypers = await db.phenotyper.findMany({
        orderBy: { name: 'asc' },
      });
      return { success: true, data: phenotypers };
    } catch (error) {
      console.error('[DB] Failed to list phenotypers:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:phenotypers:create',
    async (
      _event,
      data: Prisma.PhenotyperCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const phenotyper = await db.phenotyper.create({ data });
        return { success: true, data: phenotyper };
      } catch (error) {
        console.error('[DB] Failed to create phenotyper:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Scientists
  // ============================================

  ipcMain.handle('db:scientists:list', async (): Promise<DatabaseResponse> => {
    try {
      const scientists = await db.scientist.findMany({
        orderBy: { name: 'asc' },
      });
      return { success: true, data: scientists };
    } catch (error) {
      console.error('[DB] Failed to list scientists:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:scientists:create',
    async (
      _event,
      data: Prisma.ScientistCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const scientist = await db.scientist.create({ data });
        return { success: true, data: scientist };
      } catch (error) {
        console.error('[DB] Failed to create scientist:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Accessions
  // ============================================

  ipcMain.handle('db:accessions:list', async (): Promise<DatabaseResponse> => {
    try {
      const accessions = await db.accessions.findMany({
        orderBy: { name: 'asc' },
      });
      return { success: true, data: accessions };
    } catch (error) {
      console.error('[DB] Failed to list accessions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:accessions:create',
    async (
      _event,
      data: Prisma.AccessionsCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const accession = await db.accessions.create({ data });
        return { success: true, data: accession };
      } catch (error) {
        console.error('[DB] Failed to create accession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Scans
  // ============================================

  ipcMain.handle(
    'db:scans:create',
    async (_event, data: Prisma.ScanCreateInput): Promise<DatabaseResponse> => {
      try {
        const scan = await db.scan.create({ data });
        return { success: true, data: scan };
      } catch (error) {
        console.error('[DB] Failed to create scan:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:scans:list',
    async (
      _event,
      filters?: {
        experiment_id?: string;
        phenotyper_id?: string;
        plant_id?: string;
      }
    ): Promise<DatabaseResponse> => {
      try {
        const scans = await db.scan.findMany({
          where: filters,
          include: {
            experiment: true,
            phenotyper: true,
            images: { select: { id: true, status: true } }, // Just count/status, not full image data
          },
          orderBy: { capture_date: 'desc' },
        });
        return { success: true, data: scans };
      } catch (error) {
        console.error('[DB] Failed to list scans:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:scans:get',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        const scan = await db.scan.findUnique({
          where: { id },
          include: {
            experiment: true,
            phenotyper: true,
            images: {
              orderBy: { frame_number: 'asc' },
            },
          },
        });
        return { success: true, data: scan };
      } catch (error) {
        console.error('[DB] Failed to get scan:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Images
  // ============================================

  ipcMain.handle(
    'db:images:create',
    async (
      _event,
      data: Prisma.ImageCreateManyInput[]
    ): Promise<DatabaseResponse> => {
      try {
        // Use createMany for bulk insert (more efficient)
        const result = await db.image.createMany({ data });
        return { success: true, data: result };
      } catch (error) {
        console.error('[DB] Failed to create images:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  console.log('[DB] Registered all database IPC handlers');
}
