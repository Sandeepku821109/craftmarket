import { Schema, model, Document, Types } from "mongoose";

export type UserRole = "creator" | "buyer" | "admin";

export interface IUser extends Document {
  name: string;
  email: string;
  mobile: string;
  role: UserRole;
  isVerified: boolean;
  avatar?: string;
  uploadedSoftware: Types.ObjectId[];
  purchasedSoftware: Types.ObjectId[];
  totalEarnings: number;
  refreshToken?: string;
  createdAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    mobile: { type: String, required: true, unique: true },
    role: { type: String, enum: ["creator", "buyer", "admin"], default: "buyer" },
    isVerified: { type: Boolean, default: false },
    avatar: { type: String },
    uploadedSoftware: [{ type: Schema.Types.ObjectId, ref: "Software" }],
    purchasedSoftware: [{ type: Schema.Types.ObjectId, ref: "Software" }],
    totalEarnings: { type: Number, default: 0 },
    refreshToken: { type: String, select: false },
  },
  { timestamps: true }
);

export const UserModel = model<IUser>("User", userSchema);