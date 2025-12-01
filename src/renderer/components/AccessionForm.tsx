import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';

const accessionSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be less than 255 characters')
    .transform((val) => val.trim()), // Trim whitespace
});

type AccessionFormData = z.infer<typeof accessionSchema>;

interface AccessionFormProps {
  onSuccess: () => void;
}

export function AccessionForm({ onSuccess }: AccessionFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<AccessionFormData>({
    resolver: zodResolver(accessionSchema),
  });

  const onSubmit = async (data: AccessionFormData) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await window.electron.database.accessions.create({
        name: data.name,
      });

      if (!result.success) {
        setSubmitError(result.error || 'Failed to create accession');
        return;
      }

      // Success - reset form and notify parent
      reset();
      onSuccess();
    } catch (error) {
      console.error('Error creating accession:', error);
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {submitError && (
        <div className="rounded-md bg-red-50 p-3 border border-red-200">
          <p className="text-sm text-red-800">{submitError}</p>
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-xs font-bold mb-1">
          Name
        </label>
        <input
          id="name"
          type="text"
          {...register('name')}
          className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[300px] border border-gray-300"
          disabled={isSubmitting}
          placeholder="e.g., Arabidopsis Col-0"
        />
        {errors.name && (
          <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="px-4 py-2 rounded-md bg-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Creating...' : 'Add Accession'}
      </button>
    </form>
  );
}
