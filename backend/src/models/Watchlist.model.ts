import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IWatchlist extends Document {
  userId: Types.ObjectId;
  auctionId: Types.ObjectId;
  addedAt: Date;
  notifyOnBid: boolean;
  notifyBeforeEnd: boolean;
  notifyBeforeEndMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

const watchlistSchema = new Schema<IWatchlist>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    auctionId: {
      type: Schema.Types.ObjectId,
      ref: 'Auction',
      required: true,
      index: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    notifyOnBid: {
      type: Boolean,
      default: true,
    },
    notifyBeforeEnd: {
      type: Boolean,
      default: true,
    },
    notifyBeforeEndMinutes: {
      type: Number,
      default: 30,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure a user can only watch an auction once
watchlistSchema.index({ userId: 1, auctionId: 1 }, { unique: true });

const Watchlist: Model<IWatchlist> = mongoose.model<IWatchlist>('Watchlist', watchlistSchema);

export default Watchlist;

