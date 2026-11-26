
import mongoose from "mongoose";

const monitorStateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      unique: true,
      required: true,
    },

    lastCheckedAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  "MonitorState",
  monitorStateSchema
);
