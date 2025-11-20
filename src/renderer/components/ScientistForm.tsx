import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';

const scientistSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
  email: z.string().email('Must be a valid email address'),
});

type ScientistFormData = z.infer<typeof scientistSchema>;

interface ScientistFormProps {
  onSuccess: () => void;
}

export function ScientistForm({ onSuccess }: ScientistFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ScientistFormData>({
    resolver: zodResolver(scientistSchema),
  });

  const onSubmit = async (data: ScientistFormData) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Data is validated by Zod schema before reaching here, so fields are guaranteed to be present
      const result = await window.electron.database.scientists.create({
        name: data.name,
        email: data.email,
      });

      if (!result.success) {
        // Check if it's a duplicate email error
        const errorMessage = result.error || 'Failed to create scientist';
        if (
          errorMessage.includes('UNIQUE constraint') ||
          errorMessage.includes('unique')
        ) {
          setSubmitError('A scientist with this email already exists');
        } else {
          setSubmitError(errorMessage);
        }
        return;
      }

      // Success - reset form and notify parent
      reset();
      onSuccess();
    } catch (error) {
      console.error('Error creating scientist:', error);
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
          className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[200px] border border-gray-300"
          disabled={isSubmitting}
        />
        {errors.name && (
          <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="email" className="block text-xs font-bold mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          {...register('email')}
          className="p-2 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[200px] border border-gray-300"
          disabled={isSubmitting}
        />
        {errors.email && (
          <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="px-4 py-2 rounded-md bg-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Adding...' : 'Add new scientist'}
      </button>
    </form>
  );
}
