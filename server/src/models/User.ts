import mongoose, { Schema } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, sparse: true, unique: true },
    name: { type: String, default: "" },
    about: { type: String, default: "" },
    avatarUrl: { type: String, default: null },
    privacy: {
      lastSeen: { type: String, enum: ["everyone", "contacts", "nobody"], default: "everyone" },
      profilePhoto: { type: String, enum: ["everyone", "contacts", "nobody"], default: "everyone" },
      about: { type: String, enum: ["everyone", "contacts", "nobody"], default: "everyone" },
      readReceipts: { type: Boolean, default: true }
    }
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
