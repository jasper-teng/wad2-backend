const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_TTL = process.env.JWT_TTL || '365d';

// Normalize strings for queries
const norm = (s) => (s || '').trim();

/**
 * @desc    Register a new user
 * @route   POST /users/signup
 */
exports.signup = async (req, res) => {
    try {
        const { email, handle, password } = req.body;

        if (!email || !handle || !password) {
            return res.status(400).json({ message: 'Email, handle, and password are required' });
        }

        // Check if user already exists (case-insensitive)
        const existingUser = await User.findOne({
            $or: [{ email: norm(email).toLowerCase() }, { handle: norm(handle) }]
        }).collation({ locale: 'en', strength: 2 }); // strength: 2 for case-insensitivity

        if (existingUser) {
            return res.status(409).json({ message: 'Email or handle already in use' });
        }

        // Create new user instance (password will be hashed by the pre-save hook)
        const user = new User({
            email: norm(email),
            handle: norm(handle),
            passwordHash: password, // Pass the plain password to be hashed by the model
        });

        await user.save();

        // Create JWT
        const token = jwt.sign({ userId: user._id, handle: user.handle }, JWT_SECRET, { expiresIn: JWT_TTL });

        res.status(201).json({
            user: { id: user._id, email: user.email, handle: user.handle },
            token
        });

    } catch (error) {
        res.status(500).json({ message: 'Server error during signup', error: error.message });
    }
};

/**
 * @desc    Authenticate user & get token
 * @route   POST /users/signin
 */
exports.signin = async (req, res) => {
    try {
        const { emailOrHandle, password } = req.body;
        if (!emailOrHandle || !password) {
            return res.status(400).json({ message: 'Email/handle and password are required' });
        }

        // Find user by email or handle (case-insensitive)
        const user = await User.findOne({
            $or: [{ email: norm(emailOrHandle).toLowerCase() }, { handle: norm(emailOrHandle) }]
        }).collation({ locale: 'en', strength: 2 });

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Use the model's method to compare passwords
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        // Update last login time
        user.lastLoginAt = new Date();
        await user.save();

        // Create JWT
        const token = jwt.sign({ userId: user._id, handle: user.handle }, JWT_SECRET, { expiresIn: JWT_TTL });

        res.status(200).json({
            user: { id: user._id, email: user.email, handle: user.handle, },
            token
        });

    } catch (error) {
        res.status(500).json({ message: 'Server error during signin', error: error.message });
    }
};

/**
 * @desc    Get current user profile
 * @route   GET /users/me
 * @access  Private
 */
exports.getMe = async (req, res) => {
    try {
        // req.userId is attached by the jwtauth middleware
        const user = await User.findById(req.userId).select('-passwordHash'); // Exclude password hash

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ user });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};