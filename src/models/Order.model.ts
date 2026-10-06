import { Schema, model, Document, Types } from "mongoose";

export interface IOrder extends Document {
  buyer: Types.ObjectId;
  software: Types.ObjectId;
  creator: Types.ObjectId;
  amount: number;
  platformFee: number;
  creatorEarning: number;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  status: "created" | "paid" | "failed";
  paidAt?: Date;
  accessExpiresAt?: Date;
  createdAt: Date;
}

const orderSchema = new Schema<IOrder>(
  {
    buyer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    software: { type: Schema.Types.ObjectId, ref: "Software", required: true },
    creator: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    platformFee: { type: Number, required: true },
    creatorEarning: { type: Number, required: true },
    razorpayOrderId: { type: String, required: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    status: { type: String, enum: ["created", "paid", "failed"], default: "created" },
    paidAt: { type: Date },
    accessExpiresAt: { type: Date },
  },
  { timestamps: true }
);

export const OrderModel = model<IOrder>("Order", orderSchema);