import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import { AppError } from './error.middleware';

export const validate = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Run all validations
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const extractedErrors: { [key: string]: string }[] = [];
    errors.array().map((err: any) =>
      extractedErrors.push({ [err.param]: err.msg })
    );

    return next(
      new AppError(
        JSON.stringify({
          message: 'Validation failed',
          errors: extractedErrors,
        }),
        400
      )
    );
  };
};

