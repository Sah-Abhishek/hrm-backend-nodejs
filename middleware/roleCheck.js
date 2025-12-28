const { UserRole } = require('../models/schemas');

/**
 * Middleware to check if user has required role(s)
 * @param {string[]} allowedRoles - Array of allowed roles
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        detail: 'Not authenticated'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        detail: 'Not enough permissions'
      });
    }

    next();
  };
};

/**
 * Check if user is admin
 */
const requireAdmin = requireRole([UserRole.ADMIN]);

/**
 * Check if user is admin or manager
 */
const requireAdminOrManager = requireRole([UserRole.ADMIN, UserRole.MANAGER]);

/**
 * Middleware to validate request body against Joi schema
 * @param {object} schema - Joi validation schema
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { 
      abortEarly: false,
      stripUnknown: true 
    });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(422).json({
        detail: 'Validation failed',
        errors
      });
    }
    
    req.validatedBody = value;
    next();
  };
};

module.exports = {
  requireRole,
  requireAdmin,
  requireAdminOrManager,
  validate
};
