import mongoose, { Schema, Document } from "mongoose";

export interface ISetting extends Document {
  key: string;
  value: string;
  description?: string;
  updatedAt: Date;
}

const SettingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
    description: { type: String },
  },
  { timestamps: true }
);

export const Setting = mongoose.models.Setting || mongoose.model<ISetting>("Setting", SettingSchema);
