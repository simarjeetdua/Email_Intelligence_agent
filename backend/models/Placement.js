
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

    // Primary student registration deadline
    deadline: Date,

    // Preserve the original deadline text
    deadlineText: String,

    // Company application portal
    applicationUrl: String,

    // University confirmation form
    universityConfirmationUrl: String,

    // Backward compatibility
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
