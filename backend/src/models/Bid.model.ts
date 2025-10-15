import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IBid extends Document {
  auctionId: Types.ObjectId;
  bidderId: Types.ObjectId;
  amount: number;
  isAutoBid: boolean;
  maxAutoBidAmount?: number;
  isPrivateRoomBid: boolean;
  bidTime: Date;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bidSchema = new Schema<IBid>(
  {
    auctionId: {
      type: Schema.Types.ObjectId,
      ref: 'Auction',
      required: true,
      index: true,
    },
    bidderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    isAutoBid: {
      type: Boolean,
      default: false,
    },
    maxAutoBidAmount: {
      type: Number,
      min: 0,
    },
    isPrivateRoomBid: {
      type: Boolean,
      default: false,
    },
    bidTime: {
      type: Date,
      default: Date.now,
      index: true,
    },
    ipAddress: String,
    userAgent: String,
  },
  {
    timestamps: true,
  }
);

// Compound Indexes
bidSchema.index({ auctionId: 1, amount: -1 });
bidSchema.index({ auctionId: 1, bidderId: 1 });
bidSchema.index({ bidderId: 1, bidTime: -1 });

const Bid: Model<IBid> = mongoose.model<IBid>('Bid', bidSchema);

export default Bid;

