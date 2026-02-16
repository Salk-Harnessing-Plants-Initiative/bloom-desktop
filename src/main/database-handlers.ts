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
 * Log database operation for testing/debugging (dev mode only)
 * Format: [DB:OPERATION] Model: details
 */
function logDatabaseOperation(
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE',
  model: string,
  details: string
) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DB:${operation}] ${model}: ${details}`);
  }
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
        logDatabaseOperation(
          'CREATE',
          'Experiment',
          `id=${experiment.id} name="${experiment.name}"`
        );
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

  ipcMain.handle(
    'db:experiments:attachAccession',
    async (
      _event,
      experimentId: string,
      accessionId: string
    ): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.update({
          where: { id: experimentId },
          data: { accession_id: accessionId },
          include: { accession: true },
        });
        logDatabaseOperation(
          'UPDATE',
          'Experiment',
          `id=${experimentId} attached accession=${accessionId}`
        );
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to attach accession to experiment:', error);
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
        logDatabaseOperation(
          'CREATE',
          'Phenotyper',
          `id=${phenotyper.id} name="${phenotyper.name}"`
        );
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
        logDatabaseOperation(
          'CREATE',
          'Scientist',
          `id=${scientist.id} email="${scientist.email}"`
        );
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
        include: {
          experiments: {
            select: {
              name: true,
            },
          },
        },
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
        logDatabaseOperation(
          'CREATE',
          'Accession',
          `id=${accession.id} name="${accession.name}"`
        );
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

  ipcMain.handle(
    'db:accessions:createWithMappings',
    async (
      _event,
      accessionData: { name: string },
      mappings: { plant_barcode: string; accession_name?: string }[]
    ): Promise<DatabaseResponse> => {
      try {
        // Create accession with plant mappings in atomic transaction
        const result = await db.$transaction(async (tx) => {
          const accession = await tx.accessions.create({
            data: { name: accessionData.name },
          });

          // Process mappings in batches of 100
          const batchSize = 100;
          let totalCreated = 0;

          for (let i = 0; i < mappings.length; i += batchSize) {
            const batch = mappings.slice(i, i + batchSize);
            await tx.plantAccessionMappings.createMany({
              data: batch.map((m) => ({
                accession_file_id: accession.id,
                plant_barcode: m.plant_barcode,
                accession_name: m.accession_name ?? null,
              })),
            });
            totalCreated += batch.length;
          }

          return { accession, mappingCount: totalCreated };
        });

        logDatabaseOperation(
          'CREATE',
          'Accession with Mappings',
          `id=${result.accession.id} name="${result.accession.name}" mappings=${result.mappingCount}`
        );

        return {
          success: true,
          data: {
            ...result.accession,
            mappingCount: result.mappingCount,
          },
        };
      } catch (error) {
        console.error('[DB] Failed to create accession with mappings:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:getMappings',
    async (_event, accessionId: string): Promise<DatabaseResponse> => {
      try {
        const mappings = await db.plantAccessionMappings.findMany({
          where: { accession_file_id: accessionId },
          orderBy: { plant_barcode: 'asc' },
        });
        return { success: true, data: mappings };
      } catch (error) {
        console.error('[DB] Failed to get accession mappings:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:update',
    async (
      _event,
      id: string,
      data: { name: string }
    ): Promise<DatabaseResponse> => {
      try {
        if (!data.name || data.name.trim() === '') {
          return {
            success: false,
            error: 'Name cannot be empty',
          };
        }

        const accession = await db.accessions.update({
          where: { id },
          data: { name: data.name.trim() },
        });

        logDatabaseOperation(
          'UPDATE',
          'Accession',
          `id=${accession.id} name="${accession.name}"`
        );

        return { success: true, data: accession };
      } catch (error) {
        console.error('[DB] Failed to update accession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:delete',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        // Delete in transaction (cascade will handle plant mappings)
        const result = await db.$transaction(async (tx) => {
          // First delete all plant mappings
          await tx.plantAccessionMappings.deleteMany({
            where: { accession_file_id: id },
          });

          // Then delete the accession
          const accession = await tx.accessions.delete({
            where: { id },
          });

          return accession;
        });

        logDatabaseOperation('DELETE', 'Accession', `id=${id}`);

        return { success: true, data: result };
      } catch (error) {
        console.error('[DB] Failed to delete accession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:updateMapping',
    async (
      _event,
      mappingId: string,
      data: { accession_name: string }
    ): Promise<DatabaseResponse> => {
      try {
        if (!data.accession_name || data.accession_name.trim() === '') {
          return {
            success: false,
            error: 'Accession name cannot be empty',
          };
        }

        const mapping = await db.plantAccessionMappings.update({
          where: { id: mappingId },
          data: { accession_name: data.accession_name.trim() },
        });

        logDatabaseOperation(
          'UPDATE',
          'PlantAccessionMapping',
          `id=${mappingId} accession_name="${data.accession_name}"`
        );

        return { success: true, data: mapping };
      } catch (error) {
        console.error('[DB] Failed to update mapping:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:getPlantBarcodes',
    async (
      _event,
      accessionId: string
    ): Promise<DatabaseResponse<string[]>> => {
      try {
        const mappings = await db.plantAccessionMappings.findMany({
          where: { accession_file_id: accessionId },
          select: { plant_barcode: true },
        });

        const barcodes = mappings.map((m) => m.plant_barcode);
        return { success: true, data: barcodes };
      } catch (error) {
        console.error('[DB] Failed to get plant barcodes:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:getAccessionNameByBarcode',
    async (
      _event,
      plantBarcode: string,
      experimentId: string
    ): Promise<DatabaseResponse<string | null>> => {
      try {
        // First get the experiment to find its accession
        const experiment = await db.experiment.findUnique({
          where: { id: experimentId },
          select: { accession_id: true },
        });

        if (!experiment?.accession_id) {
          return { success: true, data: null };
        }

        // Find the mapping for this barcode in the experiment's accession
        const mapping = await db.plantAccessionMappings.findFirst({
          where: {
            accession_file_id: experiment.accession_id,
            plant_barcode: plantBarcode,
          },
          select: { accession_name: true },
        });

        return { success: true, data: mapping?.accession_name || null };
      } catch (error) {
        console.error('[DB] Failed to get accession name by barcode:', error);
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
        logDatabaseOperation(
          'CREATE',
          'Scan',
          `id=${scan.id} plant="${scan.plant_id}"`
        );
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
            images: { select: { id: true, status: true } }, // Just id/status, not full image data
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

  ipcMain.handle(
    'db:scans:getMostRecentScanDate',
    async (
      _event,
      plantId: string,
      experimentId: string
    ): Promise<DatabaseResponse<string | null>> => {
      try {
        const scan = await db.scan.findFirst({
          where: {
            plant_id: plantId,
            experiment_id: experimentId,
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
          select: { capture_date: true },
        });

        return {
          success: true,
          data: scan?.capture_date?.toISOString() || null,
        };
      } catch (error) {
        console.error('[DB] Failed to get most recent scan date:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:scans:getRecent',
    async (
      _event,
      options?: { limit?: number; experimentId?: string }
    ): Promise<DatabaseResponse> => {
      try {
        const limit = options?.limit ?? 10;

        // Calculate today's date range
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Build where clause
        const where: {
          capture_date: { gte: Date; lt: Date };
          deleted: boolean;
          experiment_id?: string;
        } = {
          capture_date: {
            gte: today,
            lt: tomorrow,
          },
          deleted: false,
        };

        // Optional experiment filter
        if (options?.experimentId) {
          where.experiment_id = options.experimentId;
        }

        const scans = await db.scan.findMany({
          where,
          orderBy: { capture_date: 'desc' },
          take: limit,
          include: {
            experiment: {
              select: { name: true },
            },
          },
        });

        logDatabaseOperation(
          'READ',
          'Scan',
          `getRecent count=${scans.length} limit=${limit}`
        );

        return { success: true, data: scans };
      } catch (error) {
        console.error('[DB] Failed to get recent scans:', error);
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
