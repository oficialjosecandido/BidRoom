import { Injectable } from '@angular/core';
import { environment } from '@environments/environment';

@Injectable({
  providedIn: 'root'
})
export class Logger {
  
  private isProduction = environment.production;

  log(message: any, ...optionalParams: any[]): void {
    if (!this.isProduction) {
      console.log(message, ...optionalParams);
    }
  }

  error(message: any, ...optionalParams: any[]): void {
    if (!this.isProduction) {
      console.error(message, ...optionalParams);
    }
    // In production, send to logging service
    this.sendToLoggingService('error', message, optionalParams);
  }

  warn(message: any, ...optionalParams: any[]): void {
    if (!this.isProduction) {
      console.warn(message, ...optionalParams);
    }
    // In production, send to logging service
    this.sendToLoggingService('warn', message, optionalParams);
  }

  info(message: any, ...optionalParams: any[]): void {
    if (!this.isProduction) {
      console.info(message, ...optionalParams);
    }
    // In production, send to logging service
    this.sendToLoggingService('info', message, optionalParams);
  }

  private sendToLoggingService(level: string, message: any, params: any[]): void {
    if (this.isProduction) {
      // Send to your logging service (e.g., Sentry, LogRocket, etc.)
      // This is a placeholder for production logging
      try {
        // Example: Send to external logging service
        // loggingService.log(level, message, params);
      } catch (error) {
        // Fail silently to avoid infinite loops
      }
    }
  }
}
