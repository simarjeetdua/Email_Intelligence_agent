
import { z } from "zod";

export const placementSchema = z.object({
  isOpportunity: z.boolean(),

  opportunityType: z.enum([
    "placement",
    "internship",
    "job",
    "other",
  ]),

  company: z.string().nullable(),
  role: z.string().nullable(),
  package: z.string().nullable(),
  location: z.string().nullable(),

  minimumCGPA: z.string().nullable(),
  allowedBacklogs: z.string().nullable(),
  branches: z.array(z.string()),

  additionalRequirements: z.array(z.string()),

  // Primary student application deadline.
  // Use ISO 8601 format, e.g. 2026-05-12T22:00:00+05:30.
  deadline: z.string().nullable(),
  deadlineText: z.string().nullable(),

  // Separate deadline for college/TPO submission, if present.
  collegeSubmissionDeadline: z.string().nullable(),
  collegeSubmissionDeadlineText: z.string().nullable(),

  // Separate application links.
  applicationUrl: z.string().nullable(),
  universityConfirmationUrl: z.string().nullable(),

  // Backward compatibility with older analysis.
  registrationUrl: z.string().nullable(),

  summary: z.string(),
  confidence: z.number().min(0).max(1),
});
