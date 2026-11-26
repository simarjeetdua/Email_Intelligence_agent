
import { z } from "zod";

export const placementSchema = z.object({
  isOpportunity: z.boolean(),

  opportunityType: z.enum([
    "placement",
    "internship",
    "job",
    "other",
  ]),

  confidence: z.number().min(0).max(1),

  company: z.string().nullable(),
  role: z.string().nullable(),
  package: z.string().nullable(),
  location: z.string().nullable(),

  minimumCGPA: z.string().nullable(),
  allowedBacklogs: z.string().nullable(),

  branches: z.array(z.string()),

  additionalRequirements: z.string().nullable(),

  deadline: z.string().nullable(),

  registrationUrl: z.string().nullable(),

  summary: z.string(),

  reason: z.string(),
});
