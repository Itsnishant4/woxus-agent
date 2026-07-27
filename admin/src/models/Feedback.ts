import mongoose, { Schema, Document } from "mongoose";

export interface IFeedback extends Document {
  rating: number;
  text?: string;
  hardwareId?: string;
  createdAt: Date;
}

const FeedbackSchema = new Schema<IFeedback>(
  {
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String },
    hardwareId: { type: String },
  },
  { timestamps: true }
);

export const Feedback = mongoose.models.Feedback || mongoose.model<IFeedback>("Feedback", FeedbackSchema);
