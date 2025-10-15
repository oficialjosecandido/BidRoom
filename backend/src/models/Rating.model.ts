import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IRating extends Document {
  transactionId: Types.ObjectId;
  auctionId: Types.ObjectId;
  reviewerId: Types.ObjectId;
  revieweeId: Types.ObjectId;
  reviewerRole: 'buyer' | 'seller';
  
  // Rating
  rating: number; // 1-5 stars
  
  // Review
  review?: string;
  
  // Detailed ratings (optional)
  communication?: number;
  accuracy?: number;
  shipping?: number;
  
  // Response from reviewee
  response?: string;
  respondedAt?: Date;
  
  // Status
  isPublic: boolean;
  isFlagged: boolean;
  flagReason?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const ratingSchema = new Schema<IRating>(
  {
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
      index: true,
    },
    auctionId: {
      type: Schema.Types.ObjectId,
      ref: 'Auction',
      required: true,
    },
    reviewerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    revieweeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reviewerRole: {
      type: String,
      enum: ['buyer', 'seller'],
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    review: {
      type: String,
      maxlength: 1000,
    },
    communication: {
      type: Number,
      min: 1,
      max: 5,
    },
    accuracy: {
      type: Number,
      min: 1,
      max: 5,
    },
    shipping: {
      type: Number,
      min: 1,
      max: 5,
    },
    response: {
      type: String,
      maxlength: 500,
    },
    respondedAt: Date,
    isPublic: {
      type: Boolean,
      default: true,
    },
    isFlagged: {
      type: Boolean,
      default: false,
    },
    flagReason: String,
  },
  {
    timestamps: true,
  }
);

// Ensure one rating per transaction per user
ratingSchema.index({ transactionId: 1, reviewerId: 1 }, { unique: true });
ratingSchema.index({ revieweeId: 1, createdAt: -1 });

const Rating: Model<IRating> = mongoose.model<IRating>('Rating', ratingSchema);

export default Rating;

