import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type AuctionFormat = 'highest_bid' | 'best_offer';
export type AuctionStatus = 'draft' | 'active' | 'ended' | 'sold' | 'cancelled' | 'private_room';
export type AuctionDuration = '2h' | '24h' | '3d' | '7d';

export interface IAuction extends Document {
  sellerId: Types.ObjectId;
  
  // Basic Info
  title: string;
  description: string;
  category: string;
  tags: string[];
  
  // Images & Media
  images: Array<{
    url: string;
    alt: string;
    isPrimary: boolean;
    order: number;
  }>;
  
  // Auction Settings
  format: AuctionFormat;
  duration: AuctionDuration;
  startingBid: number;
  buyNowPrice?: number;
  reservePrice?: number;
  hasReservePrice: boolean;
  minBidIncrement: number;
  
  // Private Room Settings
  allowPrivateRoom: boolean;
  privateRoomCommission: number;
  standardCommission: number;
  
  // Status & Timing
  status: AuctionStatus;
  startTime: Date;
  endTime: Date;
  actualEndTime?: Date;
  
  // Current State
  currentBid: number;
  totalBids: number;
  uniqueBidders: number;
  viewCount: number;
  watcherCount: number;
  
  // Verification
  isVerified: boolean;
  verificationBadge?: {
    type: 'value' | 'physical' | 'both';
    verifiedAt: Date;
    verifiedBy: Types.ObjectId;
  };
  
  // Promotion
  isPromoted: boolean;
  promotionExpiresAt?: Date;
  
  // Private Room State
  privateRoomStarted: boolean;
  privateRoomStartedAt?: Date;
  privateRoomParticipants: Types.ObjectId[];
  privateRoomLastBidAt?: Date;
  
  // Winner & Transaction
  winnerId?: Types.ObjectId;
  winningBid?: number;
  soldAt?: Date;
  
  // Seller commitment
  sellerCommitmentRenewedAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const auctionSchema = new Schema<IAuction>(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    category: {
      type: String,
      required: true,
      index: true,
    },
    tags: [{ type: String, trim: true }],
    images: [
      {
        url: { type: String, required: true },
        alt: String,
        isPrimary: { type: Boolean, default: false },
        order: { type: Number, default: 0 },
      },
    ],
    format: {
      type: String,
      enum: ['highest_bid', 'best_offer'],
      required: true,
      default: 'highest_bid',
    },
    duration: {
      type: String,
      enum: ['2h', '24h', '3d', '7d'],
      required: true,
    },
    startingBid: {
      type: Number,
      required: true,
      min: 0,
    },
    buyNowPrice: {
      type: Number,
      min: 0,
    },
    reservePrice: {
      type: Number,
      min: 0,
    },
    hasReservePrice: {
      type: Boolean,
      default: false,
    },
    minBidIncrement: {
      type: Number,
      default: 1.0,
      min: 0.01,
    },
    allowPrivateRoom: {
      type: Boolean,
      default: false,
    },
    privateRoomCommission: {
      type: Number,
      default: 2.0,
    },
    standardCommission: {
      type: Number,
      default: 0.5,
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'ended', 'sold', 'cancelled', 'private_room'],
      default: 'draft',
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
      required: true,
      index: true,
    },
    actualEndTime: Date,
    currentBid: {
      type: Number,
      default: 0,
      index: true,
    },
    totalBids: {
      type: Number,
      default: 0,
    },
    uniqueBidders: {
      type: Number,
      default: 0,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    watcherCount: {
      type: Number,
      default: 0,
    },
    isVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    verificationBadge: {
      type: {
        type: String,
        enum: ['value', 'physical', 'both'],
      },
      verifiedAt: Date,
      verifiedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    },
    isPromoted: {
      type: Boolean,
      default: false,
      index: true,
    },
    promotionExpiresAt: Date,
    privateRoomStarted: {
      type: Boolean,
      default: false,
    },
    privateRoomStartedAt: Date,
    privateRoomParticipants: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    privateRoomLastBidAt: Date,
    winnerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    winningBid: Number,
    soldAt: Date,
    sellerCommitmentRenewedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Compound Indexes
auctionSchema.index({ status: 1, endTime: 1 });
auctionSchema.index({ status: 1, isPromoted: -1, endTime: 1 });
auctionSchema.index({ status: 1, category: 1, endTime: 1 });
auctionSchema.index({ status: 1, isVerified: -1, endTime: 1 });
auctionSchema.index({ sellerId: 1, status: 1 });

// Virtuals
auctionSchema.virtual('timeRemaining').get(function () {
  if (this.status !== 'active' && this.status !== 'private_room') return 0;
  return Math.max(0, this.endTime.getTime() - Date.now());
});

auctionSchema.virtual('hasMetReserve').get(function () {
  if (!this.hasReservePrice || !this.reservePrice) return true;
  return this.currentBid >= this.reservePrice;
});

auctionSchema.virtual('bids', {
  ref: 'Bid',
  localField: '_id',
  foreignField: 'auctionId',
});

// Methods
auctionSchema.methods.canStartPrivateRoom = function (): boolean {
  return (
    this.allowPrivateRoom &&
    this.status === 'ended' &&
    this.uniqueBidders >= 15 &&
    !this.privateRoomStarted
  );
};

auctionSchema.methods.getCommissionRate = function (): number {
  return this.allowPrivateRoom ? this.privateRoomCommission : this.standardCommission;
};

auctionSchema.methods.isEndingSoon = function (thresholdMinutes: number = 60): boolean {
  if (this.status !== 'active') return false;
  const minutesRemaining = this.timeRemaining / (1000 * 60);
  return minutesRemaining <= thresholdMinutes;
};

const Auction: Model<IAuction> = mongoose.model<IAuction>('Auction', auctionSchema);

export default Auction;

