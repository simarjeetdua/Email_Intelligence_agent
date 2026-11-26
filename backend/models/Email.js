
import mongoose from "mongoose";

const emailSchema = new mongoose.Schema(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
    },

    threadId: String,
    sender: String,
    subject: String,
    receivedAt: Date,

    snippet: String,
    summary: String,

    category: {
      type: String,
      enum: [
        "placement",
        "internship",
        "interview",
        "college",
        "job",
        "personal",
        "other",
      ],
      default: "other",
    },

    status: {
      type: String,
      enum: [
        "processing",
        "processed",
        "not_placement",
        "failed",
      ],
      default: "processing",
    },

    confidence: {
      type: Number,
      default: 0,
    },

    error: String,
  },
  { timestamps: true }
);

export default mongoose.model("Email", emailSchema);
