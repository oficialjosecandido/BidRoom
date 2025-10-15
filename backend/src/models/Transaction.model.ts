import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type TransactionStatus = 
  | 'pending' 
  | 'payment_processing' 
  | 'paid' 
  | 'escrow' 
  | 'released' 
  | 'disputed' 
  | 'refunded' 
  | 'cancelled';

export interface ITransaction extends Document {
  auctionId: Types.ObjectId;
  sellerId: Types.ObjectId;
  buyerId: Types.ObjectId;
  
  // Amounts
  itemPrice: number;
  commissionAmount: number;
  commissionRate: number;
  totalAmount: number;
  sellerPayout: number;
  
  // Payment Details
  status: TransactionStatus;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  paymentMethod?: string;
  
  // Escrow & Release
  escrowHeldAt?: Date;
  escrowReleasedAt?: Date;
  escrowReleaseReason?: string;
  
  // Payout to seller
  payoutStatus: 'pending' | 'processing' | 'paid' | 'failed';
  payoutId?: string;
  paidToSellerAt?: Date;
  
  // Dispute
  disputeId?: Types.ObjectId;
  
  // Refund
  refundAmount?: number;
  refundedAt?: Date;
  refundReason?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    auctionId: {
      type: Schema.Types.ObjectId,
      ref: 'Auction',
      required: true,
      unique: true,
      index: true,
    },
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    buyerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    itemPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    sellerPayout: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'payment_processing', 'paid', 'escrow', 'released', 'disputed', 'refunded', 'cancelled'],
      default: 'pending',
      index: true,
    },
    stripePaymentIntentId: String,
    stripeChargeId: String,
    paymentMethod: String,
    escrowHeldAt: Date,
    escrowReleasedAt: Date,
    escrowReleaseReason: String,
    payoutStatus: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed'],
      default: 'pending',
    },
    payoutId: String,
    paidToSellerAt: Date,
    disputeId: {
      type: Schema.Types.ObjectId,
      ref: 'Dispute',
    },
    refundAmount: Number,
    refundedAt: Date,
    refundReason: String,
  },
  {
    timestamps: true,
  }
);

// Indexes
transactionSchema.index({ sellerId: 1, status: 1 });
transactionSchema.index({ buyerId: 1, status: 1 });
transactionSchema.index({ status: 1, createdAt: -1 });

const Transaction: Model<ITransaction> = mongoose.model<ITransaction>('Transaction', transactionSchema);

export default Transaction;

