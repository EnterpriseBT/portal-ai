-- Add 'revalidation' to the job_type enum
ALTER TYPE "job_type" ADD VALUE IF NOT EXISTS 'revalidation';
