import mongoose, { Schema } from "mongoose";

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    refreshTokenHash: { type: String, required: true, select: false },
    deviceName: { type: String, required: true, maxlength: 120 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    lastActiveAt: { type: Date, required: true }
  },
  { timestamps: true }
);

export const Session = mongoose.model("Session", sessionSchema);
