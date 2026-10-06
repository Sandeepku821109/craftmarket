import { Schema, model, Document } from "mongoose";

export interface IContactSubmission extends Document {
  name: string;
  phone: string;
  email: string;
  subject: string;
  query: string;
  status: "new" | "in-progress" | "resolved";
  createdAt: Date;
}

const contactSubmissionSchema = new Schema<IContactSubmission>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 25 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    subject: { type: String, required: true, enum: [
      "General question",
      "Buying a product",
      "Selling on Craftmarket",
      "Report a problem",
      "Something else",
    ] },
    query: { type: String, required: true, trim: true, minlength: 10, maxlength: 5000 },
    status: { type: String, enum: ["new", "in-progress", "resolved"], default: "new", required: true },
  },
  { timestamps: true }
);

contactSubmissionSchema.index({ createdAt: -1 });

export const ContactSubmissionModel = model<IContactSubmission>(
  "ContactSubmission",
  contactSubmissionSchema
);
