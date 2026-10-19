import mongoose, { Schema } from "mongoose";

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, default: "", trim: true, maxlength: 4000 },
    imageData: { type: String, default: null, maxlength: 120000 },
    audioData: { type: String, default: null, maxlength: 1300000 },
    callStatus: { type: String, enum: ["completed", "missed", "declined", "cancelled"], default: null },
    callDurationSeconds: { type: Number, default: null, min: 0 }
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: 1, _id: 1 });

export const Message = mongoose.model("Message", messageSchema);
