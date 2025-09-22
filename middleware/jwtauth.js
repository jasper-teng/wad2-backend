const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

const jwtauth = (req, res, next) => {
    // 1. Get the Authorization header
    const authHeader = req.header('Authorization');

    // 2. Check for the header and the 'Bearer ' prefix
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'No token or invalid format, authorization denied' });
    }

    try {
        // 3. Extract the token from the "Bearer <token>" string
        const token = authHeader.substring(7);

        // 4. Verify the token
        const decoded = jwt.verify(token, JWT_SECRET);

        // 5. Use the CORRECT key ("userId") and attach it to the request
        req.userId = decoded.userId;

        next(); // Proceed to the protected route
    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};

module.exports = jwtauth;