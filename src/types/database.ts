/**
 * Database Type Definitions
 *
 * Re-exports Prisma types for use in renderer process and provides
 * additional type utilities for database operations.
 */

import type {
  Experiment,
  Scan,
  Phenotyper,
  Scientist,
  Accessions,
  Image,
  PlantAccessionMappings,
  Prisma,
} from '@prisma/client';

// ============================================
// Re-export base Prisma types
// ============================================

export type {
  Experiment,
  Scan,
  Phenotyper,
  Scientist,
  Accessions,
  Image,
  PlantAccessionMappings,
  Prisma,
};

// ============================================
// Types with relations (for queries that include related data)
// ============================================

/**
 * Experiment with related scientist and accession
 */
export type ExperimentWithRelations = Prisma.ExperimentGetPayload<{
  include: {
    scientist: true;
    accession: true;
    scans: true;
  };
}>;

/**
 * Scan with related experiment, phenotyper, and images
 */
export type ScanWithRelations = Prisma.ScanGetPayload<{
  include: {
    experiment: true;
    phenotyper: true;
    images: true;
  };
}>;

/**
 * Scan with minimal image data (for list views)
 */
export type ScanWithImageSummary = Prisma.ScanGetPayload<{
  include: {
    experiment: true;
    phenotyper: true;
    images: {
      select: {
        id: true;
        status: true;
      };
    };
  };
}>;

/**
 * Plant accession mapping with accession details
 */
export type PlantAccessionMappingWithAccession =
  Prisma.PlantAccessionMappingsGetPayload<{
    include: {
      accession: true;
    };
  }>;

// ============================================
// Database Response Types
// ============================================

/**
 * Standard response format for all database operations
 */
export interface DatabaseResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================
// Filter Types
// ============================================

/**
 * Filters for scanning queries
 */
export interface ScanFilters {
  experiment_id?: string;
  phenotyper_id?: string;
  plant_id?: string;
}

// ============================================
// Create Input Types (for IPC)
// ============================================

/**
 * Data required to create a new experiment
 */
export type ExperimentCreateData = Prisma.ExperimentCreateInput;

/**
 * Data required to create a new scan
 */
export type ScanCreateData = Prisma.ScanCreateInput;

/**
 * Data required to create a new phenotyper
 */
export type PhenotyperCreateData = Prisma.PhenotyperCreateInput;

/**
 * Data required to create a new scientist
 */
export type ScientistCreateData = Prisma.ScientistCreateInput;

/**
 * Data required to create a new accession
 */
export type AccessionCreateData = Prisma.AccessionsCreateInput;

/**
 * Data required to create new images (bulk)
 */
export type ImageCreateData = Prisma.ImageCreateManyInput;

// ============================================
// Update Input Types
// ============================================

/**
 * Data for updating an experiment
 */
export type ExperimentUpdateData = Prisma.ExperimentUpdateInput;
