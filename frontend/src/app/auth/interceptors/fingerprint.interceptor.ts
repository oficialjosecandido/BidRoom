import { HttpInterceptorFn } from '@angular/common/http';
import { getDeviceFingerprint } from '../../shared/utils/device-fingerprint';

/**
 * Attaches the device fingerprint header to all API requests.
 * Used by the backend for multi-account and shill-bid detection.
 */
export const fingerprintInterceptor: HttpInterceptorFn = (req, next) => {
  const fp = getDeviceFingerprint();
  if (!fp) return next(req);

  return next(req.clone({
    setHeaders: { 'X-Device-Fingerprint': fp }
  }));
};
