import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'closed' | 'escalated';
export type DisputeReason = 
  | 'item_not_received' 
  | 'item_not_as_described' 
  | 'damaged_item' 
  | 'payment_issue' 
  | 'seller_not_responding'
  | 'buyer_not_paying'
  | 'other';

export interface IDispute extends Document {
  transactionId: Types.ObjectId;
  auctionId: Types.ObjectId;
  
  // Parties
  raisedBy: Types.ObjectId;
  raisedAgainst: Types.ObjectId;
  
  // Dispute Details
  reason: DisputeReason;
  description: string;
  evidence: Array<{
    type: 'image' | 'document' | 'message';
    url: string;
    uploadedAt: Date;
  }>;
  
  // Status & Resolution
  status: DisputeStatus;
  resolvedBy?: Types.ObjectId;
  resolution?: string;
  resolutionNote?: string;
  resolvedAt?: Date;
  
  // Communication
  messages: Array<{
    senderId: Types.ObjectId;
    message: string;
    timestamp: Date;
  }>;
  
  // Outcome
  refundAmount?: number;
  partialRefund?: boolean;
  
  createdAt: Date;
  updatedAt: Date;
}

const disputeSchema = new Schema<IDispute>(
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
      index: true,
    },
    raisedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    raisedAgainst: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      enum: [
        'item_not_received',
        'item_not_as_described',
        'damaged_item',
        'payment_issue',
        'seller_not_responding',
        'buyer_not_paying',
        'other',
      ],
      required: true,
    },
    description: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    evidence: [
      {
        type: {
          type: String,
          enum: ['image', 'document', 'message'],
        },
        url: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    status: {
      type: String,
      enum: ['open', 'under_review', 'resolved', 'closed', 'escalated'],
      default: 'open',
      index: true,
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    resolution: String,
    resolutionNote: String,
    resolvedAt: Date,
    messages: [
      {
        senderId: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        message: {
          type: String,
          required: true,
          maxlength: 1000,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    refundAmount: Number,
    partialRefund: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
disputeSchema.index({ raisedBy: 1, status: 1 });
disputeSchema.index({ raisedAgainst: 1, status: 1 });
disputeSchema.index({ status: 1, createdAt: -1 });

const Dispute: Model<IDispute> = mongoose.model<IDispute>('Dispute', disputeSchema);

export default Dispute;

