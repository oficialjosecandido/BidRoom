import { Request, Response, NextFunction } from 'express';
import DOMPurify from 'isomorphic-dompurify';

// Sanitize HTML content in request body
export const sanitizeHtml = (req: Request, _res: Response, next: NextFunction) => {
  const sanitizeObject = (obj: any): any => {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return DOMPurify.sanitize(obj, { 
        ALLOWED_TAGS: [], // Remove all HTML tags
        ALLOWED_ATTR: [] // Remove all attributes
      });
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }

    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = sanitizeObject(obj[key]);
        }
      }
      return sanitized;
    }

    return obj;
  };

  // Sanitize body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize params
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
};

// Sanitize specific fields that should allow limited HTML
export const sanitizeRichText = (allowedTags: string[] = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li']) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const sanitizeRichObject = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return obj;
      }

      if (typeof obj === 'string') {
        return DOMPurify.sanitize(obj, { 
          ALLOWED_TAGS: allowedTags,
          ALLOWED_ATTR: ['class', 'id']
        });
      }

      if (Array.isArray(obj)) {
        return obj.map(sanitizeRichObject);
      }

      if (typeof obj === 'object') {
        const sanitized: any = {};
        for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
            sanitized[key] = sanitizeRichObject(obj[key]);
          }
        }
        return sanitized;
      }

      return obj;
    };

    if (req.body) {
      req.body = sanitizeRichObject(req.body);
    }

    next();
  };
};
