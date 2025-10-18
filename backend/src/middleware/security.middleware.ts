import { Request, Response, NextFunction } from 'express';

// Prevent parameter pollution
export const preventParameterPollution = (req: Request, _res: Response, next: NextFunction) => {
  // Remove duplicate query parameters
  const query: any = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      query[key] = value[0]; // Take only the first value
    } else {
      query[key] = value;
    }
  }
  req.query = query;
  
  next();
};

// Add security headers
export const addSecurityHeaders = (_req: Request, res: Response, next: NextFunction) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // XSS Protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove X-Powered-By header
  res.removeHeader('X-Powered-By');
  
  next();
};

// Validate request size
export const validateRequestSize = (maxSize: number = 10 * 1024 * 1024) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.get('content-length') || '0');
    
    if (contentLength > maxSize) {
      return res.status(413).json({
        success: false,
        message: 'Request entity too large',
      });
    }
    
    return next();
  };
};

// IP whitelist middleware (for admin endpoints)
export const ipWhitelist = (allowedIPs: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    
    if (!allowedIPs.includes(clientIP || '')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied from this IP address',
      });
    }
    
    return next();
  };
};

// Request timeout middleware
export const requestTimeout = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    req.setTimeout(timeoutMs, () => {
      res.status(408).json({
        success: false,
        message: 'Request timeout',
      });
    });
    
    next();
  };
};
