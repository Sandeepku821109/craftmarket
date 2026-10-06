import { Document, Schema, Types, model } from "mongoose";

export interface IEarning extends Document {
  order: Types.ObjectId;
  buyer: Types.ObjectId;
  creator: Types.ObjectId;
  software: Types.ObjectId;
  amount: number;
  platformFee: number;
  creatorEarning: number;
  createdAt: Date;
}

const earningSchema = new Schema<IEarning>(
  {
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true },
    buyer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    creator: { type: Schema.Types.ObjectId, ref: "User", required: true },
    software: { type: Schema.Types.ObjectId, ref: "Software", required: true },
    amount: { type: Number, required: true, min: 0 },
    platformFee: { type: Number, required: true, min: 0 },
    creatorEarning: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

earningSchema.index({ creator: 1, createdAt: -1 });

export const EarningModel = model<IEarning>("Earning", earningSchema);
