export interface IEarning {
  _id: string;
  order: string;
  buyer: string;
  creator: string;
  software: string;
  amount: number;
  platformFee: number;
  creatorEarning: number;
  createdAt: Date;
}
