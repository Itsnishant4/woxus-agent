import mongoose, { Schema, Document } from "mongoose";

export interface IBugReport extends Document {
  title: string;
  description?: string;
  image?: string; // base64 data URL, < 2 MB
  hardwareId?: string;
  appVersion?: string;
  createdAt: Date;
}

const BugReportSchema = new Schema<IBugReport>(
  {
    title: { type: String, required: true },
    description: { type: String },
    image: { type: String },
    hardwareId: { type: String },
    appVersion: { type: String },
  },
  { timestamps: true }
);

export const BugReport =
  mongoose.models.BugReport || mongoose.model<IBugReport>("BugReport", BugReportSchema);
