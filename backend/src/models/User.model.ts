import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  azureAdB2CId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  phoneNumber?: string;
  avatar?: string;
  
  // Reputation
  reputationScore: number;
  totalRatingsAsSeller: number;
  totalRatingsAsBuyer: number;
  
  // Payment & Authorization
  stripeCustomerId?: string;
  paymentMethods: Array<{
    id: string;
    type: string;
    last4: string;
    brand: string;
    isDefault: boolean;
  }>;
  preAuthStatus: {
    isAuthorized: boolean;
    authorizedAt?: Date;
    expiresAt?: Date;
    amount: number;
    stripePaymentIntentId?: string;
  };
  
  // KYC & Verification
  kycStatus: 'not_started' | 'pending' | 'verified' | 'rejected';
  verificationLevel: 'basic' | 'advanced' | 'premium';
  
  // Statistics
  stats: {
    totalItemsSold: number;
    totalItemsBought: number;
    totalValueSold: number;
    totalValueBought: number;
    totalBidsPlaced: number;
    totalAuctionsWon: number;
  };
  
  // Notifications preferences
  notificationPreferences: {
    email: boolean;
    push: boolean;
    outbid: boolean;
    auctionEnding: boolean;
    messages: boolean;
    disputes: boolean;
  };
  
  // Account status
  isActive: boolean;
  isSuspended: boolean;
  suspensionReason?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    azureAdB2CId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
    },
    avatar: {
      type: String,
    },
    reputationScore: {
      type: Number,
      default: 5.0,
      min: 0,
      max: 5.0,
    },
    totalRatingsAsSeller: {
      type: Number,
      default: 0,
    },
    totalRatingsAsBuyer: {
      type: Number,
      default: 0,
    },
    stripeCustomerId: String,
    paymentMethods: [
      {
        id: String,
        type: String,
        last4: String,
        brand: String,
        isDefault: Boolean,
      },
    ],
    preAuthStatus: {
      isAuthorized: {
        type: Boolean,
        default: false,
      },
      authorizedAt: Date,
      expiresAt: Date,
      amount: {
        type: Number,
        default: 0,
      },
      stripePaymentIntentId: String,
    },
    kycStatus: {
      type: String,
      enum: ['not_started', 'pending', 'verified', 'rejected'],
      default: 'not_started',
    },
    verificationLevel: {
      type: String,
      enum: ['basic', 'advanced', 'premium'],
      default: 'basic',
    },
    stats: {
      totalItemsSold: { type: Number, default: 0 },
      totalItemsBought: { type: Number, default: 0 },
      totalValueSold: { type: Number, default: 0 },
      totalValueBought: { type: Number, default: 0 },
      totalBidsPlaced: { type: Number, default: 0 },
      totalAuctionsWon: { type: Number, default: 0 },
    },
    notificationPreferences: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      outbid: { type: Boolean, default: true },
      auctionEnding: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
      disputes: { type: Boolean, default: true },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isSuspended: {
      type: Boolean,
      default: false,
    },
    suspensionReason: String,
  },
  {
    timestamps: true,
  }
);

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ azureAdB2CId: 1 });
userSchema.index({ reputationScore: -1 });
userSchema.index({ 'preAuthStatus.isAuthorized': 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Methods
userSchema.methods.canBid = function (): boolean {
  if (!this.isActive || this.isSuspended) return false;
  if (!this.preAuthStatus.isAuthorized) return false;
  if (this.preAuthStatus.expiresAt && this.preAuthStatus.expiresAt < new Date()) return false;
  return true;
};

userSchema.methods.updateReputationScore = function (newRating: number, asSellerOrBuyer: 'seller' | 'buyer'): void {
  if (asSellerOrBuyer === 'seller') {
    const totalRatings = this.totalRatingsAsSeller + 1;
    this.reputationScore = ((this.reputationScore * this.totalRatingsAsSeller) + newRating) / totalRatings;
    this.totalRatingsAsSeller = totalRatings;
  } else {
    const totalRatings = this.totalRatingsAsBuyer + 1;
    this.reputationScore = ((this.reputationScore * this.totalRatingsAsBuyer) + newRating) / totalRatings;
    this.totalRatingsAsBuyer = totalRatings;
  }
};

const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);

export default User;

