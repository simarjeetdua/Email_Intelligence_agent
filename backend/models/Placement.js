
import mongoose from "mongoose";

const placementSchema = new mongoose.Schema(
  {
    emailId: {
      type: String,
      required: true,
      unique: true,
    },

    company: String,
    role: String,

    opportunityType: {
      type: String,
      enum: ["placement", "internship", "job"],
      default: "placement",
    },

    package: String,
    location: String,

    eligibility: {
      minimumCGPA: String,
      allowedBacklogs: String,
      branches: [String],
      additionalRequirements: [String],
    },

    deadline: Date,
    deadlineText: String,

    collegeSubmissionDeadline: Date,
    collegeSubmissionDeadlineText: String,

    applicationUrl: String,
    universityConfirmationUrl: String,

    // Keep for compatibility with existing records.
    registrationUrl: String,

    summary: String,
    confidence: Number,

    status: {
      type: String,
      enum: ["active", "expired", "unknown"],
      default: "unknown",
    },

    notificationSent: {
      type: Boolean,
      default: false,
    },

    notificationSentAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model("Placement", placementSchema);
