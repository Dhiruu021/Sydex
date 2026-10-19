import mongoose, { Schema } from "mongoose";

const conversationSchema = new Schema(
  {
    kind: { type: String, enum: ["direct", "group"], required: true },
    title: { type: String, trim: true, maxlength: 80, default: null },
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    directKey: { type: String, unique: true, sparse: true },
    lastMessageText: { type: String, default: "" },
    lastMessageId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    lastMessageSenderId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    lastMessageAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, lastMessageAt: -1 });

export const Conversation = mongoose.model("Conversation", conversationSchema);
