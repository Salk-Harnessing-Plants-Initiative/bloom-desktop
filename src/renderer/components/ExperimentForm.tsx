import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';

/**
 * Hardcoded species list (from pilot fix/addnewspecies branch, deduplicated and sorted)
 * TODO: In the future, this should sync from bloom server
 */
export const SPECIES_LIST = [
  'Alfalfa',
  'Amaranth',
  'Arabidopsis',
  'Canola',
  'Lotus',
  'Maize',
  'Medicago',
  'Pennycress',
  'Rice',
  'Sorghum',
  'Soybean',
  'Spinach',
  'Sugar_Beet',
  'Tomato',
  'Wheat',
] as const;

/**
 * Experiment types available in the system
 */
export const EXPERIMENT_TYPES = [
  {
    value: 'cylinder',
    label: 'Cylinder Scan',
    description: 'Rotational imaging with camera',
  },
  {
    value: 'graviscan',
    label: 'GraviScan',
    description: 'Flatbed scanner imaging',
  },
] as const;

export type ExperimentType = (typeof EXPERIMENT_TYPES)[number]['value'];

const experimentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(255, 'Name is too long'),
  species: z.string().min(1, 'Species is required'),
  experiment_type: z.enum(['cylinder', 'graviscan']),
  scientist_id: z.string().min(1, 'Scientist is required'),
  accession_id: z.string().min(1, 'Accession is required'),
  // GraviScan-only: which wave does the chosen metadata file belong to.
  // Defaults to 0 (first wave) but the operator can pick anything when
  // seeding a wave directly (e.g. importing corrected wave-5 metadata
  // into a freshly created experiment).
  wave_number: z.coerce
    .number()
    .int('Wave number must be a whole number')
    .min(0, 'Wave number cannot be negative'),
});

type ExperimentFormData = z.infer<typeof experimentSchema>;

interface Scientist {
  id: string;
  name: string;
  email: string;
}

interface Accession {
  id: string;
  name: string;
}

interface ExperimentFormProps {
  scientists: Scientist[];
  accessions: Accession[];
  onSuccess: () => void;
}

export function ExperimentForm({
  scientists,
  accessions,
  onSuccess,
}: ExperimentFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<ExperimentFormData>({
    resolver: zodResolver(experimentSchema),
    defaultValues: {
      species: SPECIES_LIST[0],
      experiment_type: APP_MODE === 'graviscan' ? 'graviscan' : 'cylinder',
      scientist_id: '',
      accession_id: '',
      wave_number: 0,
    },
  });

  const selectedExperimentType = watch('experiment_type');
  const isGraviscan = selectedExperimentType === 'graviscan';

  const onSubmit = async (data: ExperimentFormData) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // GraviScan: metadata links via GraviExperimentWaveMetadata at wave 0
      // CylinderScan: metadata links via Experiment.accession_id (legacy path)
      const isGraviscanSubmit = data.experiment_type === 'graviscan';
      const createData = {
        name: data.name.trim(),
        species: data.species,
        experiment_type: data.experiment_type,
        scientist: { connect: { id: data.scientist_id } },
        ...(isGraviscanSubmit
          ? {}
          : { accession: { connect: { id: data.accession_id } } }),
      };

      const result =
        await window.electron.database.experiments.create(createData);

      if (!result.success || !result.data) {
        setSubmitError(result.error || 'Failed to create experiment');
        return;
      }

      // GraviScan: link the chosen metadata file to the wave the operator
      // picked. Defaults to 0 if untouched (first wave of a new experiment).
      if (isGraviscanSubmit) {
        const linkResult =
          await window.electron.database.experiments.linkGraviMetadata(
            result.data.id,
            data.wave_number,
            data.accession_id
          );
        if (!linkResult.success) {
          setSubmitError(
            `Experiment created but metadata link failed: ${linkResult.error}`
          );
          return;
        }
      }

      // Success - reset form and notify parent
      reset({
        name: '',
        species: SPECIES_LIST[0],
        experiment_type: APP_MODE === 'graviscan' ? 'graviscan' : 'cylinder',
        scientist_id: '',
        accession_id: '',
        wave_number: 0,
      });
      onSuccess();
    } catch (error) {
      console.error('Error creating experiment:', error);
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="border rounded text-lg p-4 w-96"
      noValidate
    >
      {submitError && (
        <div className="rounded-md bg-red-50 p-3 border border-red-200 mb-4">
          <p className="text-sm text-red-800">{submitError}</p>
        </div>
      )}

      <div className="mb-4">
        <label
          htmlFor="experiment-name"
          className="block text-xs font-bold mb-1"
        >
          Name
        </label>
        <input
          id="experiment-name"
          type="text"
          {...register('name')}
          className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[200px] border border-gray-300"
          disabled={isSubmitting}
        />
        {errors.name && (
          <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
        )}
      </div>

      {APP_MODE === 'full' && (
        <div className="mb-4">
          <label
            htmlFor="experiment-type-select"
            className="block text-xs font-bold mb-1"
          >
            Experiment Type
          </label>
          <select
            id="experiment-type-select"
            {...register('experiment_type')}
            className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[200px] border border-gray-300"
            disabled={isSubmitting}
          >
            {EXPERIMENT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          {errors.experiment_type && (
            <p className="mt-1 text-xs text-red-600">
              {errors.experiment_type.message}
            </p>
          )}
        </div>
      )}

      <div className="mb-4">
        <label
          htmlFor="species-select"
          className="block text-xs font-bold mb-1"
        >
          Species
        </label>
        <select
          id="species-select"
          {...register('species')}
          className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none w-[200px] border border-gray-300"
          disabled={isSubmitting}
        >
          {SPECIES_LIST.map((species) => (
            <option key={species} value={species}>
              {species}
            </option>
          ))}
        </select>
        {errors.species && (
          <p className="mt-1 text-xs text-red-600">{errors.species.message}</p>
        )}
      </div>

      <div className="mb-4">
        <label
          htmlFor="scientist-select"
          className="block text-xs font-bold mb-1"
        >
          Scientist
        </label>
        <select
          id="scientist-select"
          {...register('scientist_id')}
          className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none w-[200px] border border-gray-300"
          disabled={isSubmitting}
        >
          <option value="">-- Select a scientist --</option>
          {scientists.map((scientist) => (
            <option key={scientist.id} value={scientist.id}>
              {scientist.name}
            </option>
          ))}
        </select>
        {errors.scientist_id && (
          <p className="mt-1 text-xs text-red-600">
            {errors.scientist_id.message}
          </p>
        )}
      </div>

      <div className="mb-4">
        <label
          htmlFor="accession-select"
          className="block text-xs font-bold mb-1"
        >
          {isGraviscan ? 'Metadata File' : 'Accession File'}
        </label>
        <select
          id="accession-select"
          {...register('accession_id')}
          className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none w-[200px] border border-gray-300"
          disabled={isSubmitting}
        >
          <option value="">-- Select an accession --</option>
          {accessions.map((accession) => (
            <option key={accession.id} value={accession.id}>
              {accession.name}
            </option>
          ))}
        </select>
        {errors.accession_id && (
          <p className="mt-1 text-xs text-red-600">
            {errors.accession_id.message}
          </p>
        )}
      </div>

      {isGraviscan && (
        <div className="mb-4">
          <label
            htmlFor="wave-number-input"
            className="block text-xs font-bold mb-1"
          >
            Link to wave
          </label>
          <input
            id="wave-number-input"
            type="number"
            min={0}
            step={1}
            {...register('wave_number')}
            className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[200px] border border-gray-300"
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-gray-500">
            Which wave does this metadata file belong to? Use 0 for the first
            wave of a new experiment.
          </p>
          {errors.wave_number && (
            <p className="mt-1 text-xs text-red-600">
              {errors.wave_number.message}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-center">
        <button
          type="submit"
          disabled={isSubmitting}
          className="create-experiment-button px-4 py-2 rounded-md bg-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  );
}
