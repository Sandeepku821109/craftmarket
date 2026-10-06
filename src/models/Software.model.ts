import { Schema, model, Document, Types } from "mongoose";

export type PlatformType = "frontend" | "backend" | "fullstack" | "mobile-app";
export type SoftwareStatus = "pending" | "approved" | "rejected";

export interface ISoftware extends Document {
  title: string;
  description: string;
  creator: Types.ObjectId;
  images: string[];       // min 2 required
  video: string;          // required, 1 demo video
  liveDemoUrl?: string;   // required for new listings
  pdfDocument?: string;   // optional pdf
  githubUsername: string;
  gitRepository: string;  // required
  languages: string[];    // tech stack used
  platformType: PlatformType;
  price: number;
  status: SoftwareStatus;
  totalSales: number;
  totalRevenue: number;
  createdAt: Date;
}

const softwareSchema = new Schema<ISoftware>(
  {
    title: { type: String, required: true, index: "text" },
    description: { type: String, required: true, index: "text" },
    creator: { type: Schema.Types.ObjectId, ref: "User", required: true },
    images: {
      type: [String],
      required: true,
      validate: {
        validator: (arr: string[]) => arr.length >= 2,
        message: "At least 2 images are required",
      },
    },
    video: { type: String, required: true },
    liveDemoUrl: {
      type: String,
      validate: {
        validator: (value: string | undefined) => value === undefined || value.startsWith("https://"),
        message: "Live demo URL must use HTTPS",
      },
    },
    pdfDocument: { type: String },
    githubUsername: { type: String, required: true, trim: true },
    gitRepository: { type: String, required: true },
    languages: { type: [String], required: true },
    platformType: {
      type: String,
      enum: ["frontend", "backend", "fullstack", "mobile-app"],
      required: true,
    },
    price: { type: Number, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    totalSales: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const SoftwareModel = model<ISoftware>("Software", softwareSchema);