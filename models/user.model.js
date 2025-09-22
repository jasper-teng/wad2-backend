const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true,
        match: [/\S+@\S+\.\S+/, 'is invalid'] // Basic email format validation
    },
    handle: {
        type: String,
        required: [true, 'Handle is required'],
        unique: true,
        trim: true,
    },
    passwordHash: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastLoginAt: {
        type: Date,
        default: null
    }
    // You can add prefs and stats here later if needed
    // prefs: { type: Map, of: String },
    // stats: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 } }
}, {
    timestamps: true // Adds createdAt and updatedAt fields automatically
});

// Mongoose pre-save hook to hash password before saving a new user
userSchema.pre('save', async function(next) {
    // Only hash the password if it has been modified (or is new)
    if (!this.isModified('passwordHash')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
        next();
    } catch (err) {
        next(err);
    }
});

// Instance method to compare a candidate password with the user's hashed password
userSchema.methods.comparePassword = function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Create a text index for searching and use case-insensitive collation
userSchema.index({ email: 'text', handle: 'text' }, {
    collation: { locale: 'en', strength: 2 }
});

module.exports = mongoose.model('User', userSchema);