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

const experimentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
  species: z.string().min(1, 'Species is required'),
  scientist_id: z.string().optional(),
  accession_id: z.string().optional(),
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
  } = useForm<ExperimentFormData>({
    resolver: zodResolver(experimentSchema),
    defaultValues: {
      species: SPECIES_LIST[0],
      scientist_id: '',
      accession_id: '',
    },
  });

  const onSubmit = async (data: ExperimentFormData) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Build the create data, only including optional fields if selected
      const createData: {
        name: string;
        species: string;
        scientist?: { connect: { id: string } };
        accession?: { connect: { id: string } };
      } = {
        name: data.name.trim(),
        species: data.species,
      };

      if (data.scientist_id) {
        createData.scientist = { connect: { id: data.scientist_id } };
      }

      if (data.accession_id) {
        createData.accession = { connect: { id: data.accession_id } };
      }

      const result =
        await window.electron.database.experiments.create(createData);

      if (!result.success) {
        setSubmitError(result.error || 'Failed to create experiment');
        return;
      }

      // Success - reset form and notify parent
      reset({
        name: '',
        species: SPECIES_LIST[0],
        scientist_id: '',
        accession_id: '',
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
          Scientist (optional)
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
      </div>

      <div className="mb-4">
        <label
          htmlFor="accession-select"
          className="block text-xs font-bold mb-1"
        >
          Accession File (optional)
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
      </div>

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
